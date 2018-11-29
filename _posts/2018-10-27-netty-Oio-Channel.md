---
title: Netty 之同步阻塞通道 
layout: posts
---

# Netty 之同步阻塞通道 

------

## AbstractOioChannel

AbstractOioChannel 中的 DefaultOioUnsafe 继承自 AbstractChannel#Unsafe，补充实现了 AbstractUnsafe#connect 方法。执行连接的具体逻辑还是需要 AbstractOioChannel 不同子类自己去实现 #doConnect 方法。

如果连接成功，往管道中发送 channel `激活`事件。

{% highlight java linenos %}
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
{% endhighlight %}

不同的类型的 channel 会注册到不同类型的工作线程。这里 Oio 类 channel 的工作线程需要是 ThreadPerChannelEventLoop 类型或其子类型。

方法 #isCompatible 用来判断给定的 EventLoop 是否为当前 channel 可用的。

{% highlight java linenos %}
protected boolean isCompatible(EventLoop loop) {
    return loop instanceof ThreadPerChannelEventLoop;
}
{% endhighlight %}

字段 readPending 指示有无`读操作`在等待处理。如果为 true 说明`读操作`已发起，但还没有真正执行；false 说明没有发起`读操作`，或者`读操作`正在执行/已完成。

方法 #clearReadPending 设置当前没有`读操作`在等待执行。

{% highlight java linenos %}
// 有无 读操作 在等待处理
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
   
{% highlight java linenos %}
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

{% highlight java linenos %}
AbstractChannel 
    <- AbstractOioChannel 
    <- AbstractOioMessageChannel 
    <- OioServerSocketChannel
{% endhighlight %}

### AbstractOioMessageChannel

AbstractOioMessageChannel 服务器 channel 的基类，它主要实现了上面提到的 #doRead 方法。

1. 检查是否有`读操作`等待中，没有则返回；
2. 通过检查则取消`读操作`等待状态，准备开始数据读取；
3. 循环调用 #doReadMessages 方法，读取数据，知道读取条件不满足： allocHandle#continueReading 返回 false 或者读不到数据；
4. 对 readBuf 中读取到的数据，依次在通道中发送 ChannelRead 事件；
5. 清空 readBuf；
6. 往通道中发送 readComplete 事件；
7. 如果数据读取过程中有异常：IO 类异常，则标记 channel 为 closed；其他异常，往通道中发送 ExceptionCaught 事件；
8. 如果 channel 标记为 closed，且 channel 为打开状态，则执行关闭 channel操作；
9. 如果有`读操作`在等待、channel 被设置成自动读取、或者本次没读到数据，但 通道为`激活`状态，则再次发起`读操作`。

{% highlight java linenos %}
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

### OioServerSocketChannel

OioServerSocketChannel 是同步阻塞 IO 的服务端实现，它接受新的客户端连接，并为它们创建 OioSocketChannel。

{% highlight java linenos %}
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

{% highlight java linenos %}
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

下面的几个方法都是直接操作底层的 java socket。very easy。其他的几个客户端通道类的方法，直接抛出异常 UnsupportedOperationException。

{% highlight java linenos %}
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

{% highlight java linenos %}
AbstractChannel 
    <- AbstractOioChannel 
    <- AbstractOioByteChannel 
    <- OioByteStreamChannel 
    <- OioSocketChannel
{% endhighlight %}

### AbstractOioByteChannel

字面上看，这个类是传输`字节类`的通道基类。实现了 AbstractOioChannel#doRead 和 AbstractChannel#doWrite 。

AbstractOioChannel#doRead 的执行流程：

1. 检查输入流是否已关，或者是否有 `读操作`等待中，没有则返回；
2. 通过检查则取消`读操作`等待状态，准备开始数据读取；
3. 分配数据读取缓存 byteBuf；
4. 调用子类实现 `#doReadBytes` 读取数据到 byteBuf 并记录读取的字节数到 allocHandle ；
5. 检查是否读取到数据，是否通道已关闭，是：执行清理工作，跳出数据读取主循环；否：标记读取到数据 （readData = true）；
6. 检查是否还有入站数据，没有则跳出主循环；
7. 如果缓存 byteBuf 已写满， 尝试调整 byteBuf 的大小到 maxCapacity，否则 allocHandle 中读取的记录数加 1，*往管道中发送 ChannelRead 事件*，重新分配缓存 byteBuf；
8. 如果 allocHandle#continueReading 为 true，跳转到第 4 步；
9. 如果 byteBuf 中有数据可读，往管道中发送*通道数据入站*事件，清理 byteBuf；
10. 如果本次读取到过数据，往管道中发送*通道读取已完成*事件；
11. 如果第 5 步中检测到通道入站已关闭，但通道本身*没有*关闭，根据 channel 配置，要么关闭入站流，往管道中发送*入站流关闭*事件，要么关闭通道，最后往管道中发送 *入站流关闭且读取已完成*事件；
12. 如果有`读操作`在等待、channel 被设置成自动读取、或者本次没读到数据，但 通道为`激活`状态，则再次发起`读操作`。


{% highlight java linenos %}
protected void doRead() {
    final ChannelConfig config = config();
    if (isInputShutdown() || !readPending) {
        return;
    }

    readPending = false;

    final ChannelPipeline pipeline = pipeline();
    final ByteBufAllocator allocator = config.getAllocator();
    final RecvByteBufAllocator.Handle allocHandle = unsafe().recvBufAllocHandle();
    allocHandle.reset(config);

    ByteBuf byteBuf = null;
    boolean close = false;
    boolean readData = false;
    try {
        byteBuf = allocHandle.allocate(allocator);
        do {
            allocHandle.lastBytesRead(doReadBytes(byteBuf));
            if (allocHandle.lastBytesRead() <= 0) {
                if (!byteBuf.isReadable()) {
                    byteBuf.release();
                    byteBuf = null;
                    close = allocHandle.lastBytesRead() < 0;
                    if (close) {
                        readPending = false;
                    }
                }
                break;
            } else {
                readData = true;
            }

            // 还有多少入站数据可以读，具体子类实现
            final int available = available();
            if (available <= 0) {
                break;
            }

            if (!byteBuf.isWritable()) {
                final int capacity = byteBuf.capacity();
                final int maxCapacity = byteBuf.maxCapacity();
                if (capacity == maxCapacity) {
                    allocHandle.incMessagesRead(1);
                    readPending = false;
                    pipeline.fireChannelRead(byteBuf);
                    byteBuf = allocHandle.allocate(allocator);
                } else {
                    // 类似扩容？
                    final int writerIndex = byteBuf.writerIndex();
                    if (writerIndex + available > maxCapacity) {
                        byteBuf.capacity(maxCapacity);
                    } else {
                        byteBuf.ensureWritable(available);
                    }
                }
            }
        } while (allocHandle.continueReading());

        if (byteBuf != null) {
            if (byteBuf.isReadable()) {
                readPending = false;
                pipeline.fireChannelRead(byteBuf);
            } else {
                byteBuf.release();
            }
            byteBuf = null;
        }

        if (readData) {
            allocHandle.readComplete();
            pipeline.fireChannelReadComplete();
        }

        if (close) {
            closeOnRead(pipeline);
        }
    } catch (Throwable t) {
        handleReadException(pipeline, byteBuf, t, close, allocHandle);
    } finally {
        if (readPending || config.isAutoRead() || !readData && isActive()) {
            read();
        }
    }
}

private void closeOnRead(ChannelPipeline pipeline) {
    if (isOpen()) {
        if (Boolean.TRUE.equals(config().getOption(ChannelOption.ALLOW_HALF_CLOSURE))) {
            shutdownInput();
            pipeline.fireUserEventTriggered(ChannelInputShutdownEvent.INSTANCE);
        } else {
            unsafe().close(unsafe().voidPromise());
        }
        pipeline.fireUserEventTriggered(ChannelInputShutdownReadComplete.INSTANCE);
    }
}

private void handleReadException(ChannelPipeline pipeline, ByteBuf byteBuf, 
        Throwable cause, boolean close, RecvByteBufAllocator.Handle allocHandle) {
    if (byteBuf != null) {
        if (byteBuf.isReadable()) {
            readPending = false;
            pipeline.fireChannelRead(byteBuf);
        } else {
            byteBuf.release();
        }
    }
    allocHandle.readComplete();
    pipeline.fireChannelReadComplete();
    pipeline.fireExceptionCaught(cause);
    if (close || cause instanceof IOException) {
        closeOnRead(pipeline);
    }
}
{% endhighlight %}

AbstractChannel#doWrite 的执行流程：

1. 从出站缓冲区中获取数据 msg；
2. 如果 msg 为空，返回；
3. 如果 msg 类型为 ByteBuf，循环调用子类实现 #doWriteBytes 方法，直到 msg 中的数据全部写出，期间会发出 msg 中数据写出的进度通知，从缓冲区移除 msg；
4. 如果 msg 类型为 FileRegion，调用子类实现 #doWriteFileRegion 方法，进度通知，从缓冲区移除 msg；
5. msg 其他类型不支持，直接从缓冲区移除；
6. 继续从第 1 步开始。

{% highlight java linenos %}
protected void doWrite(ChannelOutboundBuffer in) throws Exception {
    for (;;) {
        // 从出站缓冲区中获取数据 msg
        Object msg = in.current();
        if (msg == null) {
            // nothing left to write
            break;
        }
        if (msg instanceof ByteBuf) {
            ByteBuf buf = (ByteBuf) msg;
            int readableBytes = buf.readableBytes();
            while (readableBytes > 0) {
                doWriteBytes(buf);
                int newReadableBytes = buf.readableBytes();
                in.progress(readableBytes - newReadableBytes);
                readableBytes = newReadableBytes;
            }
            in.remove();
        } else if (msg instanceof FileRegion) {
            FileRegion region = (FileRegion) msg;
            long transferred = region.transferred();
            doWriteFileRegion(region);
            in.progress(region.transferred() - transferred);
            in.remove();
        } else {
            in.remove(new UnsupportedOperationException(
                    "unsupported message type: "
                     + StringUtil.simpleClassName(msg)));
        }
    }
}
{% endhighlight %}

### OioByteStreamChannel

OioByteStreamChannel 为`字节流通道`抽象基类。主要实现了上面 AbstractOioByteChannel 中的 #doReadBytes、#doWriteBytes、#doWriteFileRegion 和 #available方法。

既然是字节流通道，就需要输入和输出流，#activate 方法初始化了它们。

{% highlight java linenos %}
protected final void activate(InputStream is, OutputStream os) {
    if (this.is != null) {
        throw new IllegalStateException("input was set already");
    }
    if (this.os != null) {
        throw new IllegalStateException("output was set already");
    }
    if (is == null) {
        throw new NullPointerException("is");
    }
    if (os == null) {
        throw new NullPointerException("os");
    }
    this.is = is;
    this.os = os;
}
{% endhighlight %}

下面的方法 #doReadBytes 把数据从输入流写入缓存 buf 中。

{% highlight java linenos %}
protected int doReadBytes(ByteBuf buf) throws Exception {
    final RecvByteBufAllocator.Handle allocHandle = unsafe().recvBufAllocHandle();
    // 计算 buf 能写多少数据
    allocHandle.attemptedBytesRead(Math.max(1, Math.min(available(), buf.maxWritableBytes())));
    return buf.writeBytes(is, allocHandle.attemptedBytesRead());
}
{% endhighlight %}

下面的方法 #doWriteBytes 把数据从 buf 写如到输出流。

{% highlight java linenos %}
protected void doWriteBytes(ByteBuf buf) throws Exception {
    OutputStream os = this.os;
    if (os == null) {
        throw new NotYetConnectedException();
    }
    buf.readBytes(os, buf.readableBytes());
}
{% endhighlight %}

方法 #doWriteFileRegion 循环写出数据到输出流，直到写完。

{% highlight java linenos %}
protected void doWriteFileRegion(FileRegion region) throws Exception {
    OutputStream os = this.os;
    if (os == null) {
        throw new NotYetConnectedException();
    }
    if (outChannel == null) {
        outChannel = Channels.newChannel(os);
    }

    long written = 0;
    for (;;) {
        long localWritten = region.transferTo(outChannel, written);
        if (localWritten == -1) {
            checkEOF(region);
            return;
        }
        written += localWritten;

        // 是否写完
        if (written >= region.count()) {
            return;
        }
    }
}

private static void checkEOF(FileRegion region) throws IOException {
    if (region.transferred() < region.count()) {
        throw new EOFException("Expected to be able to write " 
                + region.count() + " bytes, " 
                + "but only wrote " + region.transferred());
    }
}
{% endhighlight %}

方法 #available 获取输入流还有多少数据。

{% highlight java linenos %}
protected int available() {
    try {
        return is.available();
    } catch (IOException ignored) {
        return 0;
    }
}
{% endhighlight %}

方法 # doClose 关闭输入和输出流。

{% highlight java linenos %}
protected void doClose() throws Exception {
    InputStream is = this.is;
    OutputStream os = this.os;
    this.is = CLOSED_IN;
    this.os = CLOSED_OUT;

    try {
        if (is != null) {
            is.close();
        }
    } finally {
        if (os != null) {
            os.close();
        }
    }
}
{% endhighlight %}

### OioSocketChannel

OioSocketChannel 的构造方法中，除了父类初始化逻辑，还初始化了底层 socket 并设置 socket 的超时时间为 1 秒。

如果是因服务端接受客户端连接而创建 OioSocketChannel 实例，此时 socket 是处于连接状态的，因此需要调用 #activate 初始化`输入输出流`。

如果是客户端主动创建 OioSocketChannel 实例，因为还没有连到服务端，此时还不能初始化`输入输出流`。在用户调用 Channel#connect 连接服务端时，最终会调用到 OioSocketChannel#doConnect 方法，连接服务端并初始化`输入输出流`。

{% highlight java linenos %}
public OioSocketChannel(Channel parent, Socket socket) {
    super(parent);
    this.socket = socket;
    config = new DefaultOioSocketChannelConfig(this, socket);

    boolean success = false;
    try {
        if (socket.isConnected()) {
            activate(socket.getInputStream(), socket.getOutputStream());
        }
        // socket 超时时间为 1 秒。
        socket.setSoTimeout(SO_TIMEOUT);
        success = true;
    } catch (Exception e) {
        throw new ChannelException("failed to initialize a socket", e);
    } finally {
        if (!success) {
            try {
                socket.close();
            } catch (IOException e) {
                logger.warn("Failed to close a socket.", e);
            }
        }
    }
}

protected void doConnect(SocketAddress remoteAddress,
        SocketAddress localAddress) throws Exception {
    if (localAddress != null) {
        SocketUtils.bind(socket, localAddress);
    }

    boolean success = false;
    try {
        SocketUtils.connect(socket, remoteAddress, config().getConnectTimeoutMillis());
        // 初始化输入输出流
        activate(socket.getInputStream(), socket.getOutputStream());
        success = true;
    } catch (SocketTimeoutException e) {
        ConnectTimeoutException cause = 
            new ConnectTimeoutException("connection timed out: " + remoteAddress);
        cause.setStackTrace(e.getStackTrace());
        throw cause;
    } finally {
        if (!success) {
            doClose();
        }
    }
}

protected final void activate(InputStream is, OutputStream os) {
    if (this.is != null) {
        throw new IllegalStateException("input was set already");
    }
    if (this.os != null) {
        throw new IllegalStateException("output was set already");
    }
    if (is == null) {
        throw new NullPointerException("is");
    }
    if (os == null) {
        throw new NullPointerException("os");
    }
    this.is = is;
    this.os = os;
}
{% endhighlight %}

下面的方法分别关闭`输入流`和`输出流`并设置 promise 结果。同样的，可能需要打包任务到`工作线程`异步调用。

{% highlight java linenos %}
public ChannelFuture shutdownInput(final ChannelPromise promise) {
    EventLoop loop = eventLoop();
    if (loop.inEventLoop()) {
        shutdownInput0(promise);
    } else {
        loop.execute(new Runnable() {
            @Override
            public void run() {
                shutdownInput0(promise);
            }
        });
    }
    return promise;
}

private void shutdownInput0(ChannelPromise promise) {
    try {
        socket.shutdownInput();
        promise.setSuccess();
    } catch (Throwable t) {
        promise.setFailure(t);
    }
}

public ChannelFuture shutdownOutput(final ChannelPromise promise) {
    EventLoop loop = eventLoop();
    if (loop.inEventLoop()) {
        shutdownOutput0(promise);
    } else {
        loop.execute(new Runnable() {
            @Override
            public void run() {
                shutdownOutput0(promise);
            }
        });
    }
    return promise;
}

private void shutdownOutput0(ChannelPromise promise) {
    try {
        shutdownOutput0();
        promise.setSuccess();
    } catch (Throwable t) {
        promise.setFailure(t);
    }
}

private void shutdownOutput0() throws IOException {
    socket.shutdownOutput();
}
{% endhighlight %}

下面的方法依次关闭`输出流`和`输入流`并设置 promise 结果。

{% highlight java linenos %}
public ChannelFuture shutdown(final ChannelPromise promise) {
    ChannelFuture shutdownOutputFuture = shutdownOutput();
    if (shutdownOutputFuture.isDone()) {
        shutdownOutputDone(shutdownOutputFuture, promise);
    } else {
        shutdownOutputFuture.addListener(new ChannelFutureListener() {
            @Override
            public void operationComplete(final ChannelFuture shutdownOutputFuture) throws Exception {
                shutdownOutputDone(shutdownOutputFuture, promise);
            }
        });
    }
    return promise;
}

private void shutdownOutputDone(final ChannelFuture shutdownOutputFuture, final ChannelPromise promise) {
    ChannelFuture shutdownInputFuture = shutdownInput();
    if (shutdownInputFuture.isDone()) {
        shutdownDone(shutdownOutputFuture, shutdownInputFuture, promise);
    } else {
        shutdownInputFuture.addListener(new ChannelFutureListener() {
            @Override
            public void operationComplete(ChannelFuture shutdownInputFuture) throws Exception {
                shutdownDone(shutdownOutputFuture, shutdownInputFuture, promise);
            }
        });
    }
}

private static void shutdownDone(ChannelFuture shutdownOutputFuture,
                                    ChannelFuture shutdownInputFuture,
                                    ChannelPromise promise) {
    Throwable shutdownOutputCause = shutdownOutputFuture.cause();
    Throwable shutdownInputCause = shutdownInputFuture.cause();
    if (shutdownOutputCause != null) {
        if (shutdownInputCause != null) {
            logger.debug("Exception suppressed because a previous exception occurred.",
                    shutdownInputCause);
        }
        promise.setFailure(shutdownOutputCause);
    } else if (shutdownInputCause != null) {
        promise.setFailure(shutdownInputCause);
    } else {
        promise.setSuccess();
    }
}
{% endhighlight %}

其他还有一些状态判断和 address 获取相关的方法，很简单，不赘述。