---
title: Netty 之多路复用通道 NioServerSocketChannel/NioSocketChannel
layout: posts
---

# Netty 之多路复用通道 NioServerSocketChannel/NioSocketChannel

------

## AbstractNioChannel

AbstractNioChannel 是所有基于 Selector 多路复用通道的抽象基类。下面是它的部分字段及构造方法。

构造方法中设置通道关联的低层 SelectableChannel 实例 ch 及其在 Selector 中关注的事件类型 readInterestOp。如果本通道是由服务端接受客户端连接而创建的，还需要设置通道的 parent 为服务端通道。

{% highlight java linenos %}
// 底层 java 通道
private final SelectableChannel ch;
// 关注的事件类型
protected final int readInterestOp;
volatile SelectionKey selectionKey;

// 是否有`读操作`在等待执行
boolean readPending;

protected AbstractNioChannel(Channel parent, SelectableChannel ch, int readInterestOp) {
    super(parent);
    this.ch = ch;
    this.readInterestOp = readInterestOp;
    try {
        // 设置 ch 为非阻塞模式
        ch.configureBlocking(false);
    } catch (IOException e) {
        try {
            ch.close();
        } catch (IOException e2) {
            if (logger.isWarnEnabled()) {
                logger.warn("Failed to close a partially initialized socket.", e2);
            }
        }

        throw new ChannelException("Failed to enter non-blocking mode.", e);
    }
}
{% endhighlight %}

方法 #clearReadPending 设置当前通道没有`读操作`在等待执行，也没有`关注的事件类型`。

{% highlight java linenos %}
private final Runnable clearReadPendingRunnable = new Runnable() {
    @Override
    public void run() {
        clearReadPending0();
    }
};

protected final void clearReadPending() {
    if (isRegistered()) {
        EventLoop eventLoop = eventLoop();
        if (eventLoop.inEventLoop()) {
            clearReadPending0();
        } else {
            eventLoop.execute(clearReadPendingRunnable);
        }
    } else {
        readPending = false;
    }
}

private void clearReadPending0() {
    readPending = false;
    // 调用 AbstractNioUnsafe#removeReadOp 从 key 中删除关注的事件类型
    ((AbstractNioUnsafe) unsafe()).removeReadOp();
}
{% endhighlight %}

方法 #doRegister 向工作线程中的 Selector 注册，但不设置`关注的事件类型`，同时把本通道实例作为附件添加到 selectionKey 中。

方法 #doDeregister 向工作线程中的 Selector 注销 selectionKey。

{% highlight java linenos %}
protected void doRegister() throws Exception {
    boolean selected = false;
    for (;;) {
        try {
            selectionKey = javaChannel().register(eventLoop().unwrappedSelector(), 0, this);
            return;
        } catch (CancelledKeyException e) {
            if (!selected) {
                // Force the Selector to select now 
                // as the "canceled" SelectionKey may still be cached and not removed 
                // because no Select.select(..) operation was called yet.
                eventLoop().selectNow();
                selected = true;
            } else {
                // We forced a select operation on the selector before 
                // but the SelectionKey is still cached for whatever reason. JDK bug ?
                throw e;
            }
        }
    }
}

protected void doDeregister() throws Exception {
    eventLoop().cancel(selectionKey());
}
{% endhighlight %}

下面实现了 AbstractChannel#doBeginRead，设置有`读操作`在等待执行，同时添加本通道`关注的事件类型`到 selectionKey 中。

{% highlight java linenos %}
protected void doBeginRead() throws Exception {
    // Channel.read() or ChannelHandlerContext.read() was called
    final SelectionKey selectionKey = this.selectionKey;
    if (!selectionKey.isValid()) {
        return;
    }

    readPending = true;

    final int interestOps = selectionKey.interestOps();
    if ((interestOps & readInterestOp) == 0) {
        selectionKey.interestOps(interestOps | readInterestOp);
    }
}
{% endhighlight %}

方法 #newDirectBuffer 在直接内存（off-heap）上拷贝一份 ByteBuf 并返回，而原来的 buf 被回收。

1. 如果本通道有 ByteBuf 缓存池，则在池上分配内存并返回；
2. 如果有线程本地 cache 中有直接缓存，则直接加以利用并返回；
3. 直接返回原来的 buf。

{% highlight java linenos %}
protected final ByteBuf newDirectBuffer(ByteBuf buf) {
    final int readableBytes = buf.readableBytes();
    if (readableBytes == 0) {
        ReferenceCountUtil.safeRelease(buf);
        return Unpooled.EMPTY_BUFFER;
    }

    final ByteBufAllocator alloc = alloc();
    // 如果本通道有 ByteBuf 缓冲池
    if (alloc.isDirectBufferPooled()) {
        // 池上分配缓存
        ByteBuf directBuf = alloc.directBuffer(readableBytes);
        // 数据拷贝
        directBuf.writeBytes(buf, buf.readerIndex(), readableBytes);
        // 资源释放
        ReferenceCountUtil.safeRelease(buf);
        return directBuf;
    }

    final ByteBuf directBuf = ByteBufUtil.threadLocalDirectBuffer();
    if (directBuf != null) {
        // 数据拷贝
        directBuf.writeBytes(buf, buf.readerIndex(), readableBytes);
        // 资源释放
        ReferenceCountUtil.safeRelease(buf);
        return directBuf;
    }

    // 在非缓存池上分配/回收内存，代价太高，放弃拷贝，直接返回原 buf
    return buf;
}
{% endhighlight %}

------

## AbstractNioChannel#AbstractNioUnsafe

AbstractNioUnsafe 继承了 AbstractChannel#AbstractUnsafe，同时实现了 AbstractNioChannel#NioUnsafe 接口。

{% highlight java linenos %}
public interface NioUnsafe extends Unsafe {
    /**
     * Return underlying {@link SelectableChannel}
     */
    SelectableChannel ch();

    /**
     * Finish connect
     */
    void finishConnect();

    /**
     * Read from underlying {@link SelectableChannel}
     */
    void read();

    // 强制数据刷出
    void forceFlush();
}
{% endhighlight %}

方法 #removeReadOp 从 selectionKey 中删除本通道的`关注事件类型`。

{% highlight java linenos %}
protected final void removeReadOp() {
    SelectionKey key = selectionKey();
    // 工作线程在注销通道的时候，可能会取消 key
    if (!key.isValid()) {
        return;
    }

    int interestOps = key.interestOps();
    if ((interestOps & readInterestOp) != 0) {
        // only remove readInterestOp if needed
        key.interestOps(interestOps & ~readInterestOp);
    }
}
{% endhighlight %}

作为客户端方法的 #connect，实现了向服务端*发起连接*的逻辑。

1. 设置 promise 不可撤销，确保通道处于 open 状态，否则返回；
2. 确保当前没有连接操作在同时执行，否则抛出 ConnectionPendingException；
3. 调用子类实现 #doConnect 执行通道具体*发起连接*的逻辑；
4. *连接发起成功*，往通道中发送 channel `激活`事件；
5. 连接失败，

{% highlight java linenos %}
public final void connect(
        final SocketAddress remoteAddress, 
        final SocketAddress localAddress, final ChannelPromise promise) {
    // 设置 promise 不可撤销，确保通道处于 open 状态
    if (!promise.setUncancellable() || !ensureOpen(promise)) {
        return;
    }

    try {
        if (connectPromise != null) {
            // Already a connect in process.
            throw new ConnectionPendingException();
        }

        boolean wasActive = isActive();
        if (doConnect(remoteAddress, localAddress)) {
            fulfillConnectPromise(promise, wasActive);
        } else {
            connectPromise = promise;
            requestedRemoteAddress = remoteAddress;

            // Schedule connect timeout.
            int connectTimeoutMillis = config().getConnectTimeoutMillis();
            if (connectTimeoutMillis > 0) {
                connectTimeoutFuture = eventLoop().schedule(new Runnable() {
                    @Override
                    public void run() {
                        ChannelPromise connectPromise = AbstractNioChannel.this.connectPromise;
                        ConnectTimeoutException cause =
                                new ConnectTimeoutException("connection timed out: " + remoteAddress);
                        if (connectPromise != null && connectPromise.tryFailure(cause)) {
                            close(voidPromise());
                        }
                    }
                }, connectTimeoutMillis, TimeUnit.MILLISECONDS);
            }

            promise.addListener(new ChannelFutureListener() {
                @Override
                public void operationComplete(ChannelFuture future) throws Exception {
                    if (future.isCancelled()) {
                        if (connectTimeoutFuture != null) {
                            connectTimeoutFuture.cancel(false);
                        }
                        connectPromise = null;
                        close(voidPromise());
                    }
                }
            });
        }
    } catch (Throwable t) {
        promise.tryFailure(annotateConnectException(t, remoteAddress));
        closeIfClosed();
    }
}

private void fulfillConnectPromise(ChannelPromise promise, boolean wasActive) {
    if (promise == null) {
        return;
    }

    boolean active = isActive();
    boolean promiseSet = promise.trySuccess();

    if (!wasActive && active) {
        pipeline().fireChannelActive();
    }

    if (!promiseSet) {
        close(voidPromise());
    }
}
{% endhighlight %}

{% highlight java linenos %}
public final void finishConnect() {
    // Note this method is invoked by the event loop only if the connection attempt was
    // neither cancelled nor timed out.

    assert eventLoop().inEventLoop();

    try {
        boolean wasActive = isActive();
        doFinishConnect();
        fulfillConnectPromise(connectPromise, wasActive);
    } catch (Throwable t) {
        fulfillConnectPromise(connectPromise, annotateConnectException(t, requestedRemoteAddress));
    } finally {
        // Check for null as the connectTimeoutFuture is only created 
        // if a connectTimeoutMillis > 0 is used
        // See https://github.com/netty/netty/issues/1770
        if (connectTimeoutFuture != null) {
            connectTimeoutFuture.cancel(false);
        }
        connectPromise = null;
    }
}
{% endhighlight %}

------

## NioServerSocketChannel

NioServerSocketChannel 的继承树如下：

{% highlight java linenos %}
AbstractChannel
    <- AbstractNioChannel
    <- AbstractNioMessageChannel
    <- NioServerSocketChannel
{% endhighlight %}

### AbstractNioMessageChannel

{% highlight java linenos %}
{% endhighlight %}

{% highlight java linenos %}
{% endhighlight %}

### NioServerSocketChannel

{% highlight java linenos %}
{% endhighlight %}


{% highlight java linenos %}
{% endhighlight %}


------

## NioSocketChannel

NioServerSocketChannel 的继承树如下：

{% highlight java linenos %}
AbstractChannel
    <- AbstractNioChannel
    <- AbstractNioByteChannel
    <- NioSocketChannel
{% endhighlight %}

### AbstractNioByteChannel

### NioSocketChannel

作为 AbstractNioChannel#doConnect 的具体实现，调用了低层 SocketChannel 的 #connect 方法，向服务端发起连接。 由于 Netty 中的多路复用通道总是设置成非阻塞模式，因此 #connect 方法总是反回 false（？），这时需要在 selectionKey 中加入事件类型 *SelectionKey.OP_CONNECT*。在下一轮执行 #select 后，一旦出现该类事件，说明*连接已完成*，可以调用 SocketChannel#finishConnect 方法结束连接过程。

{% highlight java linenos %}
protected boolean doConnect(SocketAddress remoteAddress, SocketAddress localAddress) throws Exception {
    if (localAddress != null) {
        // 如果需要，绑定本地地址
        doBind0(localAddress);
    }

    boolean success = false;
    try {
        // 非阻塞模式下，总是立即返回 false
        boolean connected = SocketUtils.connect(javaChannel(), remoteAddress);
        if (!connected) {
            // 注册 OP_CONNECT，等待连接完成
            selectionKey().interestOps(SelectionKey.OP_CONNECT);
        }
        success = true;
        return connected;
    } finally {
        if (!success) {
            doClose();
        }
    }
}

protected void doFinishConnect() throws Exception {
    if (!javaChannel().finishConnect()) {
        throw new Error();
    }
}
{% endhighlight %}

{% highlight java linenos %}
{% endhighlight %}