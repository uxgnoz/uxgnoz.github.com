---
title: Netty 之多路复用通道 
layout: posts
---

# Netty 之多路复用通道

------

## AbstractNioChannel

AbstractNioChannel 是所有基于 Selector 多路复用通道的抽象基类。下面是它的部分字段及构造方法。

构造方法中设置通道关联的低层 SelectableChannel 实例 ch 及其在 Selector 中关注的事件类型 readInterestOp。如果本通道是由服务端接受客户端连接而创建的，还需要设置通道的 parent 为服务端通道。

字段 `readInterestOp`，作为通道自带的关注事件：

* 服务端通道为 `OP_ACCEPT`，
* 客户端通道为 `OP_READ`。

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
        } catch (IOException e2) { }

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
    //Return underlying {@link SelectableChannel}
    SelectableChannel ch();
    // 客户端在连接完成后，调用
    void finishConnect();
    //Read from underlying {@link SelectableChannel}
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
4. *连接成功*，往通道中发送 channel `激活`事件；
5. *连接尚未成功*，设置 connectPromise 为 promise，requestedRemoteAddress 为 remoteAddress；提交连接超时任务并设置 connectTimeoutFuture；在 connectPromise 中添加*连接任务取消逻辑*监听器。

> 在非阻塞 Nio 中，#doConnect 方法会返回 false，指明连接发起中，但还未完成。

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
            // 非阻塞 Nio 中，一般会走这个分支
            connectPromise = promise;
            requestedRemoteAddress = remoteAddress;

            // Schedule connect timeout.
            int connectTimeoutMillis = config().getConnectTimeoutMillis();
            if (connectTimeoutMillis > 0) {
                connectTimeoutFuture = eventLoop().schedule(new Runnable() {
                    @Override
                    public void run() {
                        ChannelPromise connectPromise = 
                                AbstractNioChannel.this.connectPromise;
                        ConnectTimeoutException cause =
                                new ConnectTimeoutException(
                                    "connection timed out: " + remoteAddress
                                );
                        // 尝试设置*连接任务*失败        
                        if (connectPromise != null && connectPromise.tryFailure(cause)) {
                            // 关闭通道
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
                            // 取消上面的超时任务
                            connectTimeoutFuture.cancel(false);
                        }
                        connectPromise = null;
                        // 关闭通道
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

一旦连接服务端过程完成，需要调用 #finishConenct 方法，结束连接，可能连接成功，也能连接失败。

> #finishConenct 方法只能在工作线程中调用。

{% highlight java linenos %}
public final void finishConnect() {
    assert eventLoop().inEventLoop();

    try {
        boolean wasActive = isActive();
        // 比如从 selectionKey 的关注事件中去除*连接事件*
        doFinishConnect();
        // 往通道中发送 channel `激活`事件
        fulfillConnectPromise(connectPromise, wasActive);
    } catch (Throwable t) {
        fulfillConnectPromise(
            connectPromise, 
            annotateConnectException(t, requestedRemoteAddress)
        );
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

private void fulfillConnectPromise(ChannelPromise promise, Throwable cause) {
    if (promise == null) {
        // Closed via cancellation and the promise has been notified already.
        return;
    }

    // Use tryFailure() instead of setFailure() to avoid the race against cancel().
    promise.tryFailure(cause);
    closeIfClosed();
}
{% endhighlight %}

在调用父类的 #flush0 之前检查 selectionKey 是否有效，同时它的*关注事件类型*中是否有 SelectionKey.OP_WRITE 类型。

{% highlight java linenos %}
protected final void flush0() {
    // Flush immediately only when there's no pending flush.
    // If there's a pending flush operation, event loop will call forceFlush() later,
    // and thus there's no need to call it now.
    if (!isFlushPending()) {
        super.flush0();
    }
}

public final void forceFlush() {
    // directly call super.flush0() to force a flush now
    super.flush0();
}

private boolean isFlushPending() {
    SelectionKey selectionKey = selectionKey();
    return selectionKey.isValid() 
            && (selectionKey.interestOps() & SelectionKey.OP_WRITE) != 0;
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

AbstractNioMessageChannel$NioMessageUnsafe 继承自 AbstractNioUnsafe，实现了其中的 #read 方法。看注释吧，没啥好说的。

{% highlight java linenos %}
private final List<Object> readBuf = new ArrayList<Object>();

public void read() {
    // 仅限工作线程调用
    assert eventLoop().inEventLoop();

    final ChannelConfig config = config();
    final ChannelPipeline pipeline = pipeline();
    final RecvByteBufAllocator.Handle allocHandle = unsafe().recvBufAllocHandle();
    allocHandle.reset(config);

    boolean closed = false;
    Throwable exception = null;
    try {
        try {
            do {
                // 每次读一个客户端通道
                int localRead = doReadMessages(readBuf);
                if (localRead == 0) {
                    break;
                }
                // 在 Nio 这里，要么 0，要么 1
                if (localRead < 0) {
                    closed = true;
                    break;
                }
                // 增加读入消息数（客户端通道数）
                allocHandle.incMessagesRead(localRead);
            } // 是否要继续，一次调用处理多个客户端连接？
            while (allocHandle.continueReading());
        } catch (Throwable t) {
            exception = t;
        }

        int size = readBuf.size();
        for (int i = 0; i < size; i ++) {
            // 设置没有读等待
            readPending = false;
            // 往服务端管道中发送 ChannelRead 事件，参数是 客户端通道
            pipeline.fireChannelRead(readBuf.get(i));
        }

        readBuf.clear();
        allocHandle.readComplete();
        // 本次调用中的客户端通道处理完成，管道中发送 ChannelReadComplete 事件
        pipeline.fireChannelReadComplete();

        if (exception != null) {
            // 上面的过程有异常，看看是否需要关闭服务端通道
            closed = closeOnReadError(exception);
            // 管道中发送 ExceptionCaught 事件
            pipeline.fireExceptionCaught(exception);
        }

        if (closed) { // 需要关闭服务端通道
            inputShutdown = true;
            if (isOpen()) {
                // 关之
                close(voidPromise());
            }
        }
    } finally {
        // Check if there is a readPending which was not processed yet.
        // This could be for two reasons:
        // * The user called Channel.read() or ChannelHandlerContext.read() in channelRead(...) method
        // * The user called Channel.read() or ChannelHandlerContext.read() in channelReadComplete(...) method
        //
        // See https://github.com/netty/netty/issues/2254
        if (!readPending && !config.isAutoRead()) {
            // 取消客户端连接关注 OP_ACCEPT
            removeReadOp();
        }
    }
}
}
{% endhighlight %}

### NioServerSocketChannel

下面是 NioServerSocketChannel 的具体构造方法。注意 `readInterestOp` 为 `SelectionKey.OP_ACCEPT`。

{% highlight java linenos %}
public NioServerSocketChannel(ServerSocketChannel channel) {
    // 读事件为 OP_ACCEPT
    super(null, channel, SelectionKey.OP_ACCEPT);
    config = new NioServerSocketChannelConfig(this, javaChannel().socket());
}
{% endhighlight %}

{% highlight java linenos %}
{% endhighlight %}

方法 #doReadMessages 实现了父类的 AbstractNioMessageChannel#doReadMessages。每次接受一个客户端，并为之创建 NioSocketChannel 实例。

方法返回值：

* 1，成功接受客户端连接，并为之创建 NioSocketChannel 实例；
* 0，因权限导致接受客户端连接失败，或创建 NioSocketChannel 实例失败。

{% highlight java linenos %}
protected int doReadMessages(List<Object> buf) throws Exception {
    SocketChannel ch = SocketUtils.accept(javaChannel());

    try {
        if (ch != null) {
            buf.add(new NioSocketChannel(this, ch));
            return 1;
        }
    } catch (Throwable t) {
        logger.warn("Failed to create a new channel from an accepted socket.", t);

        try {
            ch.close();
        } catch (Throwable t2) {
            logger.warn("Failed to close a socket.", t2);
        }
    }

    return 0;
}
{% endhighlight %}

方法 #doWrite 在 Nio 中没有用到，就不提了。下面几个随意看看。

{% highlight java linenos %}
protected void doBind(SocketAddress localAddress) throws Exception {
    if (PlatformDependent.javaVersion() >= 7) {
        javaChannel().bind(localAddress, config.getBacklog());
    } else {
        javaChannel().socket().bind(localAddress, config.getBacklog());
    }
}

protected void doClose() throws Exception {
    javaChannel().close();
}

public boolean isActive() {
    return javaChannel().socket().isBound();
}
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

从下面的构造方法，我们可以看出客户端通道 的 `readInterestOp` 都是 `SelectionKey.OP_READ`。

{% highlight java linenos %}
protected AbstractNioByteChannel(Channel parent, SelectableChannel ch) {
    super(parent, ch, SelectionKey.OP_READ);
}
{% endhighlight %}

下面的代码实现了 AbstractChannel#doWrite 方法。在执行 AbstractUnsafe#flush 时，会调用 #doWrite 的子类具体实现，执行数据写入操作。

> 在 AbstractChannel$AbstractUnsafe 中，#flush 会调用 #flush0，进而调用 #doWrite。

方法 #doWriteInternal 的返回值：

* `0`，msg 中没有可写数据；
* `1`，成功写出 msg 中的部分或全部数据；
* `Integer.MAX_VALUE`，底层缓冲区满，未写出数据。
  
每一次 #doWriteInternal 成功的数据写出 writeSpinCount 递减 1，直到 writeSpinCount 为 0。localFlushedAmount 为实际写出的字节数，如果 localFlushedAmount 小于等于 0，说明操作系统网络底层的写缓冲区满了。

> writeSpinCount 限制了单个 socket 的资源使用，比如 cpu 时间。

{% highlight java linenos %}
@Override
protected void doWrite(ChannelOutboundBuffer in) throws Exception {
    int writeSpinCount = config().getWriteSpinCount();
    do {
        Object msg = in.current();
        if (msg == null) {
            // 出站数据全部写完，取消 写关注
            clearOpWrite();
            // Directly return here so incompleteWrite(...) is not called.
            return;
        }
        writeSpinCount -= doWriteInternal(in, msg);
    } while (writeSpinCount > 0);

    incompleteWrite(writeSpinCount < 0);
}

private int doWriteInternal(ChannelOutboundBuffer in, Object msg) throws Exception {
    if (msg instanceof ByteBuf) {
        ByteBuf buf = (ByteBuf) msg;
        if (!buf.isReadable()) {
            // buf 无可写数据，从出站缓冲区删除队首 Entry
            in.remove();
            return 0;
        }

        // 数据写出，localFlushedAmount 为实际写出数据字节数
        final int localFlushedAmount = doWriteBytes(buf);
        if (localFlushedAmount > 0) {
            // 进度通知
            in.progress(localFlushedAmount);
            if (!buf.isReadable()) {
                // buf 无可写数据，从出站缓冲区删除队首 Entry
                in.remove();
            }
            return 1;
        }
    } else if (msg instanceof FileRegion) {
        FileRegion region = (FileRegion) msg;
        if (region.transferred() >= region.count()) {
            // 从出站缓冲区删除队首 Entry
            in.remove();
            return 0;
        }

        // 数据写出，localFlushedAmount 为实际写出数据字节数
        long localFlushedAmount = doWriteFileRegion(region);
        if (localFlushedAmount > 0) {
            in.progress(localFlushedAmount);
            if (region.transferred() >= region.count()) {
                // 从出站缓冲区删除队首 Entry
                in.remove();
            }
            return 1;
        }
    } else {
        // 咱就支持上面 2 中数据类型
        throw new Error();
    }

    // 系统缓冲区满，返回 Integer.MAX_VALUE
    return WRITE_STATUS_SNDBUF_FULL;
}
{% endhighlight %}

定额 writeSpinCount 用完，当出站缓冲区依然有数据未写出。有 2 种情况：

1. `setOpWrite` 为 `TRUE`，$$writeSpinCount < 0$$，这种情况一般是由底层网络缓冲区满导致，因此需要设置*写关注*，待可写时，继续写；
2. `setOpWrite` 为 `FALSE`，$$writeSpinCount == 0$$，说明本次定额*正常用完*，取消*写关注*，打包*数据写出任务*到工作线程，先让其他任务有机会执行，以后我们继续。

{% highlight java linenos %}
protected final void incompleteWrite(boolean setOpWrite) {
    // Did not write completely.
    if (setOpWrite) {
        setOpWrite();
    } else {
        // It is possible that we have set the write OP, woken up by NIO 
        // because the socket is writable, and then use our write quantum. 
        // In this case we no longer want to set the write OP because the socket is still
        // writable (as far as we know). We will find out next time we attempt to write 
        // if the socket is writable and set the write OP if necessary.
        clearOpWrite();

        // Schedule flush again later so other tasks can be picked up in the meantime
        eventLoop().execute(flushTask);
    }
}

private final Runnable flushTask = new Runnable() {
    @Override
    public void run() {
        // 直接写出上次未完数据，不用在出站缓冲区中重新确定数据范围
        ((AbstractNioUnsafe) unsafe()).flush0();
    }
};

// 设置 写关注
protected final void setOpWrite() {
    final SelectionKey key = selectionKey();
    if (!key.isValid()) {
        return;
    }

    final int interestOps = key.interestOps();
    if ((interestOps & SelectionKey.OP_WRITE) == 0) {
        key.interestOps(interestOps | SelectionKey.OP_WRITE);
    }
}

// 取消 写关注
protected final void clearOpWrite() {
    final SelectionKey key = selectionKey();
    if (!key.isValid()) {
        return;
    }

    final int interestOps = key.interestOps();
    if ((interestOps & SelectionKey.OP_WRITE) != 0) {
        key.interestOps(interestOps & ~SelectionKey.OP_WRITE);
    }
}
{% endhighlight %}

### AbstractNioByteChannel$NioByteUnsafe

方法 #isAllowHalfClosure 判断是否允许半关闭。

方法 #read 执行流程：

1. 校验输入流是否已关闭，如果已关闭，则取消`读操作`等待标志并立即返回；
2. 分配 byteBuf；
3. 调用子类具体实现 #doReadBytes 读入数据到 byteBuf，并更新读取字节数到 allocHandle#lastBytesRead；
4. 如果没有读到数据，则释放 byteBuf；如果读到 `EOF`，设置 readPending 为 false；跳出循环；
5. 调用 allocHandle#incMessagesRead，读取记录数增加 1；设置 readPending 为 false；往通道中发送 `ChannelRead 事件`；
6. 调用 allocHandle#continueReading 判断是否需要继续读取数据，如果返回 true 则回到第 2 步；
7. 循环读取结束，往通道中发送 `ChannelReadComplete 事件`；
8. 如果由于读到数据流 EOF 而导致读取循环结束，调用 #closeOnRead， 视 channel 配置选择关闭输入流或关闭整个通道；
9. 最后，如果 readPending 为 false 且没有配置自动读，调用 #removeReadOp 移除本通道的关注事件。


{% highlight java linenos %}
// 读数据时出错导致输入流已关闭 
private boolean inputClosedSeenErrorOnRead;

// AbstractNioByteChannel#shouldBreakReadReady
// 是否结束`读操作`
final boolean shouldBreakReadReady(ChannelConfig config) {
    return isInputShutdown0() 
            && (inputClosedSeenErrorOnRead || !isAllowHalfClosure(config)); 
}

public final void read() {
    final ChannelConfig config = config();
    if (shouldBreakReadReady(config)) {
        clearReadPending();
        return;
    }
    final ChannelPipeline pipeline = pipeline();
    final ByteBufAllocator allocator = config.getAllocator();
    final RecvByteBufAllocator.Handle allocHandle = recvBufAllocHandle();
    allocHandle.reset(config);

    ByteBuf byteBuf = null;
    boolean close = false;
    try {
        do {
            byteBuf = allocHandle.allocate(allocator);
            allocHandle.lastBytesRead(doReadBytes(byteBuf));
            if (allocHandle.lastBytesRead() <= 0) {
                // nothing was read. release the buffer.
                byteBuf.release();
                byteBuf = null;
                close = allocHandle.lastBytesRead() < 0;
                if (close) {
                    // There is nothing left to read as we received an EOF.
                    readPending = false;
                }
                break;
            }

            allocHandle.incMessagesRead(1);
            readPending = false;
            pipeline.fireChannelRead(byteBuf);
            byteBuf = null;
        } while (allocHandle.continueReading());

        allocHandle.readComplete();
        pipeline.fireChannelReadComplete();

        if (close) {
            closeOnRead(pipeline);
        }
    } catch (Throwable t) {
        handleReadException(pipeline, byteBuf, t, close, allocHandle);
    } finally {
        // Check if there is a readPending which was not processed yet.
        // This could be for two reasons:
        // * The user called Channel.read() or ChannelHandlerContext.read() in channelRead(...) method
        // * The user called Channel.read() or ChannelHandlerContext.read() in channelReadComplete(...) method
        //
        // See https://github.com/netty/netty/issues/2254
        if (!readPending && !config.isAutoRead()) {
            removeReadOp();
        }
    }
}

private void closeOnRead(ChannelPipeline pipeline) {
    if (!isInputShutdown0()) {
        if (isAllowHalfClosure(config())) {
            shutdownInput();
            pipeline.fireUserEventTriggered(ChannelInputShutdownEvent.INSTANCE);
        } else {
            close(voidPromise());
        }
    } else {
        inputClosedSeenErrorOnRead = true;
        pipeline.fireUserEventTriggered(ChannelInputShutdownReadComplete.INSTANCE);
    }
}
{% endhighlight %}

方法 #handleReadException 处理读取异常。

1. 如果出异常前 byteBuf 中已读取了部分数据，设置 readPending 为 false，往通道中发送 `ChannelRead 事件`，否则释放 byteBuf；
2. 往通道中发送 `ChannelReadComplete 事件`；
3. 往通道中发送 `ExceptionCaught 事件`；
4. 如果输入流返回了 `EOF` 或者出现了 IO 异常，调用 #closeOnRead，视 channel 配置选择关闭输入流或关闭整个通道；

{% highlight java linenos %}
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

方法 #closeOnRead，视 channel 配置选择仅关闭*输入流*或关闭整个通道。

{% highlight java linenos %}
private void closeOnRead(ChannelPipeline pipeline) {
    // 输入流未关闭
    if (!isInputShutdown0()) {  
        // 允许半关闭
        if (isAllowHalfClosure(config())) {
            shutdownInput();
            pipeline.fireUserEventTriggered(ChannelInputShutdownEvent.INSTANCE);
        } 
        // 不允许半关闭
        else {
            close(voidPromise());
        }
    } 
    // 输入流已关闭
    else { 
        inputClosedSeenErrorOnRead = true;
        pipeline.fireUserEventTriggered(ChannelInputShutdownReadComplete.INSTANCE);
    }
}
{% endhighlight %}

### NioSocketChannel

方法 #doConnect 作为 AbstractNioChannel#doConnect 的具体实现，调用了低层 SocketChannel#connect 方法，向服务端发起连接。 由于 Netty 中的*多路复用通道*总是被设置成*非阻塞*模式，因此 #connect 方法总是立即反回 false（？），这时需要在 selectionKey 中加入关注事件类型 *SelectionKey.OP_CONNECT*。在执行下一轮 #select 时，一旦出现该类事件，说明*连接已完成*，可以调用 SocketChannel#finishConnect 方法结束连接过程。

{% highlight java linenos %}
protected boolean doConnect(SocketAddress remoteAddress, SocketAddress localAddress) 
        throws Exception {
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
    // 结束连接过程
    if (!javaChannel().finishConnect()) {
        throw new Error();
    }
}
{% endhighlight %}

NioSocketChannel#doWrite 覆写了上面的 AbstractNioByteChannel#doWrite 方法。

{% highlight java linenos %}
protected void doWrite(ChannelOutboundBuffer in) throws Exception {
    SocketChannel ch = javaChannel();
    int writeSpinCount = config().getWriteSpinCount();
    do {
        if (in.isEmpty()) {
            // 没有出站数据，取消写关注
            clearOpWrite();
            // 直接返回，incompleteWrite(...) 不会被调用
            return;
        }

        // 本次最大数据写出量
        int maxBytesPerGatheringWrite = 
                ((NioSocketChannelConfig) config).getMaxBytesPerGatheringWrite();
        // 从出站缓冲区中，
        // 拿出最多 1024 个 ByteBuffer 且最多 maxBytesPerGatheringWrite 的数据量
        ByteBuffer[] nioBuffers = in.nioBuffers(1024, maxBytesPerGatheringWrite);
        // 实际拿出 ByteBuffer 的个数
        int nioBufferCnt = in.nioBufferCount();

        switch (nioBufferCnt) {
            case 0:
                // ByteBuffer 个数为 0，说明有除了 ByteBuffer 以外的其他东西，比如 FileRegion
                writeSpinCount -= doWrite0(in);
                break;
            case 1: {
                // 只有 1 个 ByteBuffer，采用 普通写
                ByteBuffer buffer = nioBuffers[0];
                int attemptedBytes = buffer.remaining();
                // 向 javaChannel 写出数据，并返回实际写出数据量 localWrittenBytes
                final int localWrittenBytes = ch.write(buffer);
                if (localWrittenBytes <= 0) {
                    // 数据没写出，设置 写关注
                    incompleteWrite(true);
                    // 结束本次调用
                    return;
                }
                // 调整下次最大数据写出量
                adjustMaxBytesPerGatheringWrite(
                        attemptedBytes, 
                        localWrittenBytes, 
                        maxBytesPerGatheringWrite
                );

                // 从出站缓冲区移除已写出的数据
                in.removeBytes(localWrittenBytes);
                // 递减 写定额
                --writeSpinCount;
                break;
            }
            default: {
                // 多于 1 个 ByteBuffer 时，采用 汇聚写
                long attemptedBytes = in.nioBufferSize();
                // 汇聚写，并返回实际写出字节数 localWrittenBytes
                final long localWrittenBytes = ch.write(nioBuffers, 0, nioBufferCnt);
                if (localWrittenBytes <= 0) {
                    // 数据没写出，设置 写关注
                    incompleteWrite(true);
                    // 结束本次调用
                    return;
                }
                //调整下次最大数据写出量
                adjustMaxBytesPerGatheringWrite(
                        (int) attemptedBytes, 
                        (int) localWrittenBytes,
                        maxBytesPerGatheringWrite
                );

                // 从出站缓冲区移除已写出的数据
                in.removeBytes(localWrittenBytes);
                // 递减 写定额
                --writeSpinCount;
                break;
            }
        }
    } // 定额未用完，继续写
    while (writeSpinCount > 0);

    // 在上面的循环中，出站缓冲区中的数据没有被全部写出
    // 视情形设置写关注，或打包写任务到工作线程，以后执行
    incompleteWrite(writeSpinCount < 0);
}

// AbstractNioByteChannel#doWrite0
// 直接写出 flush 区间表头中的数据
protected final int doWrite0(ChannelOutboundBuffer in) throws Exception {
    Object msg = in.current();
    if (msg == null) {
        return 0;
    }
    return doWriteInternal(in, in.current());
}

private void adjustMaxBytesPerGatheringWrite(int attempted, int written, 
        int oldMaxBytesPerGatheringWrite) {
    // By default we track the SO_SNDBUF when ever it is explicitly set. 
    // However some OSes may dynamically change SO_SNDBUF 
    // (and other characteristics that determine how much data can be written at once) 
    // so we should try make a best effort to adjust as OS behavior changes.
    if (attempted == written) {
        if (attempted << 1 > oldMaxBytesPerGatheringWrite) {
            ((NioSocketChannelConfig) config).setMaxBytesPerGatheringWrite(attempted << 1);
        }
    } 
    else if (attempted > MAX_BYTES_PER_GATHERING_WRITE_ATTEMPTED_LOW_THRESHOLD 
            && written < attempted >>> 1) {
        ((NioSocketChannelConfig) config).setMaxBytesPerGatheringWrite(attempted >>> 1);
    }
}
{% endhighlight %}


下面的方法看看就行了。

{% highlight java linenos %}
// 从 javaChannel 中读取数据到 byteBuf
protected int doReadBytes(ByteBuf byteBuf) throws Exception {
    final RecvByteBufAllocator.Handle allocHandle = unsafe().recvBufAllocHandle();
    allocHandle.attemptedBytesRead(byteBuf.writableBytes());
    return byteBuf.writeBytes(javaChannel(), allocHandle.attemptedBytesRead());
}

// 把 byteBuf 中的数据写出 javaChannel
protected int doWriteBytes(ByteBuf buf) throws Exception {
    final int expectedWrittenBytes = buf.readableBytes();
    return buf.readBytes(javaChannel(), expectedWrittenBytes);
}

// 把 FileRegion 中的数据写出到 javjaChannel
protected long doWriteFileRegion(FileRegion region) throws Exception {
    final long position = region.transferred();
    return region.transferTo(javaChannel(), position);
}

// 地址绑定
protected void doBind(SocketAddress localAddress) throws Exception {
    doBind0(localAddress);
}

private void doBind0(SocketAddress localAddress) throws Exception {
    if (PlatformDependent.javaVersion() >= 7) {
        SocketUtils.bind(javaChannel(), localAddress);
    } else {
        SocketUtils.bind(javaChannel().socket(), localAddress);
    }
}
{% endhighlight %}