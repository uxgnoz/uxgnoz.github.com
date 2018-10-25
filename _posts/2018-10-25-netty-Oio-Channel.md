---
title: Netty 之同步阻塞通道
layout: posts
---

# Netty 之同步阻塞通道

------

## AbstractOioChannel

AbstractOioChannel 中实现了 OIO 的 Unsafe 类 DefaultOioUnsafe，补充实现了 AbstractUnsafe#connect 方法。执行连接的具体逻辑还是需要 AbstractOioChannel 不同子类自己去实现 #doConnect 方法。

如果连接成功，往管道中发送 channel `激活`事件。

{% highlight java %}
private final class DefaultOioUnsafe extends AbstractUnsafe {
    @Override
    public void connect(
            final SocketAddress remoteAddress,
            final SocketAddress localAddress, final ChannelPromise promise) {
        if (!promise.setUncancellable() || !ensureOpen(promise)) {
            return;
        }

        try {
            boolean wasActive = isActive();
            doConnect(remoteAddress, localAddress);

            // Get the state as trySuccess() may trigger an 
            // ChannelFutureListener that will close the Channel.
            // We still need to ensure we call fireChannelActive() in this case.
            boolean active = isActive();

            safeSetSuccess(promise);
            if (!wasActive && active) {
                pipeline().fireChannelActive();
            }
        } catch (Throwable t) {
            safeSetFailure(promise, annotateConnectException(t, remoteAddress));
            closeIfClosed();
        }
    }
}

private final Runnable readTask = new Runnable() {
    @Override
    public void run() {
        doRead();
    }
};
{% endhighlight %}

不同的类型的 channel 会注册到不同类型的工作线程。这里 OIO 类 channel 的工作线程需要是 ThreadPerChannelEventLoop 类型或其子类型。

方法 #isCompatible 用来判断给定的 EventLoop 是否为当前 channel 可用的。

{% highlight java %}
protected boolean isCompatible(EventLoop loop) {
    return loop instanceof ThreadPerChannelEventLoop;
}
{% endhighlight %}

字段 readPending 指示有无`读操作`在等待处理。如果为 true 说明读`取操作`已发起，但还没有真正执行；false 说明没有发起`读操作`，或者`读操作`正在执行/已完成。

方法 #clearReadPending 设置当前没有`读操作`在等待处理。

{% highlight java %}
boolean readPending;

private final Runnable clearReadPendingRunnable = new Runnable() {
    @Override
    public void run() {
        readPending = false;
    }
};

protected final void clearReadPending() {
    if (isRegistered()) {
        EventLoop eventLoop = eventLoop();
        if (eventLoop.inEventLoop()) {
            readPending = false;
        } else {
            eventLoop.execute(clearReadPendingRunnable);
        }
    } else {
        // Best effort if we are not registered yet clear readPending. 
        // This happens during channel initialization.
        readPending = false;
    }
}
{% endhighlight %}

在 AbstractChannel#AbstractUnsafe 的方法 #register0 中，如果是非首次注册，且 channel 设置了自动读取，那么会调用 AbstractChannel 子类的 #beginRead 方法。

AbstractOioChannel 中实现了 #beginRead。

1. 如果 readPending 为 true ，说明已发起过`读操作`，直接返回；
2. 否则，设置 readPending 为 true；
3. 在工作线程中调用子类实现 #doRead 异步发起`读操作`。
   
{% highlight java %}
protected void doBeginRead() throws Exception {
    if (readPending) {
        return;
    }

    readPending = true;
    eventLoop().execute(readTask);
}

protected abstract void doRead();

private final Runnable readTask = new Runnable() {
    @Override
    public void run() {
        doRead();
    }
};
{% endhighlight %}

------

## OioServerSocketChannel

OioServerSocketChannel 的继承树如下：

{% highlight java %}
AbstractChannel 
    <- AbstractOioChannel 
    <- AbstractOioMessageChannel 
    <- OioServerSocketChannel
{% endhighlight %}

AbstractOioMessageChannel 服务器 channel 的基类，它主要实现了上面提到的 #doRead 方法。

1. 检查是否有`读操作`等待中，没有则返回；
2. 通过检查则取消`读操作`等待状态，准备开始数据读取；
3. 循环调用 #doReadMessages 方法，读取数据，知道读取条件不满足： allocHandle#continueReading 返回 false 或者读不到数据；
4. 对 readBuf 中读取到的数据，依次在通道中发送 ChannelRead 事件；
5. 清空 readBuf；
6. 往通道中发送 readComplete 事件；
7. 如果数据读取过程中有异常：IO 类异常，则标记 channel 为 closed；其他异常，往通道中发送 ExceptionCaught 事件；
8. 如果 channel 标记为 closed，且 channel 为打开状态，则执行关闭 channel操作；
9. 如果有`读操作`在等待、channel 被设置成自动读取或者本次没读到数据，但 channel 为`激活`状态，则再次发起`读操作`。

{% highlight java %}
private final List<Object> readBuf = new ArrayList<Object>();
protected void doRead() {
    if (!readPending) {
        // We have to check readPending here because 
        // the Runnable to read could have been scheduled and later
        // during the same read loop readPending was set to false.
        return;
    }

    readPending = false;

    final ChannelConfig config = config();
    final ChannelPipeline pipeline = pipeline();
    final RecvByteBufAllocator.Handle allocHandle = unsafe().recvBufAllocHandle();
    allocHandle.reset(config);

    boolean closed = false;
    Throwable exception = null;
    try {
        do {
            // Perform a read.
            int localRead = doReadMessages(readBuf);
            if (localRead == 0) {
                break;
            }
            if (localRead < 0) {
                closed = true;
                break;
            }

            allocHandle.incMessagesRead(localRead);
        } while (allocHandle.continueReading());
    } catch (Throwable t) {
        exception = t;
    }

    boolean readData = false;
    int size = readBuf.size();
    if (size > 0) {
        readData = true;
        for (int i = 0; i < size; i++) {
            readPending = false;
            pipeline.fireChannelRead(readBuf.get(i));
        }
        readBuf.clear();
        allocHandle.readComplete();
        pipeline.fireChannelReadComplete();
    }

    if (exception != null) {
        if (exception instanceof IOException) {
            closed = true;
        }

        pipeline.fireExceptionCaught(exception);
    }

    if (closed) {
        if (isOpen()) {
            unsafe().close(unsafe().voidPromise());
        }
    } else if (readPending || config.isAutoRead() || !readData && isActive()) {
        // Reading 0 bytes could mean there is a SocketTimeout 
        // and no data was actually read, so we
        // should execute read() again because no data may have been read.
        read();
    }
}

/**
    * Read messages into the given array and return the amount which was read.
    */
protected abstract int doReadMessages(List<Object> msgs) throws Exception;
{% endhighlight %}

OioServerSocketChannel 是同步阻塞 IO 的服务端实现，它接受新的客户端连接，并为它们创建 OioSocketChannel。

{% highlight java %}
public OioServerSocketChannel(ServerSocket socket) {
    // 没有 parent
    super(null);
    if (socket == null) {
        throw new NullPointerException("socket");
    }

    boolean success = false;
    try {
        // 设置超时事件为 1 秒
        socket.setSoTimeout(SO_TIMEOUT);
        success = true;
    } catch (IOException e) {
        throw new ChannelException("Failed to set the server socket timeout.", e);
    } finally {
        if (!success) {
            try {
                socket.close();
            } catch (IOException e) {
            }
        }
    }
    this.socket = socket;
    config = new DefaultOioServerSocketChannelConfig(this, socket);
}
{% endhighlight %}

我们来看一下上面 AbstractOioMessageChannel 中需要子类实现的 #doReadMessages 方法。

在 OioServerSocketChannel#doReadMessages 中， 每次接受（读取）一个客户端连接并返回。

> 这里 #accept 的超时时间为 1 秒。

{% highlight java %}
protected int doReadMessages(List<Object> buf) throws Exception {
    if (socket.isClosed()) {
        return -1;
    }

    try {
        Socket s = socket.accept();
        try {
            buf.add(new OioSocketChannel(this, s));
            return 1;
        } catch (Throwable t) {
            try {
                s.close();
            } catch (Throwable t2) {
            }
        }
    } catch (SocketTimeoutException e) {
        // Expected
    }
    return 0;
}
{% endhighlight %}

下面的几个方法都是直接操作底层的 java socket。very easy。

{% highlight java %}
public boolean isOpen() {
    return !socket.isClosed();
}

public boolean isActive() {
    return isOpen() && socket.isBound();
}

protected void doBind(SocketAddress localAddress) throws Exception {
    socket.bind(localAddress, config.getBacklog());
}

protected void doClose() throws Exception {
    socket.close();
}
{% endhighlight %}




------

## OioSocketChannel


OioSocketChannel 的继承树如下：

{% highlight java %}
AbstractChannel 
    <- AbstractOioChannel 
    <- AbstractOioByteChannel 
    <- OioByteStreamChannel 
    <- OioSocketChannel
{% endhighlight %}

{% highlight java %}
{% endhighlight %}


{% highlight java %}
{% endhighlight %}