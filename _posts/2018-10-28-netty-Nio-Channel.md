---
title: Netty 之多路复用通道 NioServerSocketChannel / NioSocketChannel
layout: posts
---

# Netty 之多路复用通道 NioServerSocketChannel / NioSocketChannel

------

## 0x01 AbstractNioChannel

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

## 0x02 AbstractNioChannel#AbstractNioUnsafe

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

> 该方法只能在工作线程中调用。

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

## 0x03 NioServerSocketChannel

NioServerSocketChannel 的继承树如下：

{% highlight java linenos %}
AbstractChannel
    <- AbstractNioChannel
    <- AbstractNioMessageChannel
    <- NioServerSocketChannel
{% endhighlight %}

### 0x0301 AbstractNioMessageChannel

{% highlight java linenos %}
{% endhighlight %}

{% highlight java linenos %}
{% endhighlight %}

### 0x0302 NioServerSocketChannel

{% highlight java linenos %}
{% endhighlight %}


{% highlight java linenos %}
{% endhighlight %}


------

## 0x04 NioSocketChannel

NioServerSocketChannel 的继承树如下：

{% highlight java linenos %}
AbstractChannel
    <- AbstractNioChannel
    <- AbstractNioByteChannel
    <- NioSocketChannel
{% endhighlight %}

### 0x0401 AbstractNioByteChannel

下面的代码实现了 AbstractChannel#doWrite 方法。在执行 AbstractUnsafe#flush 时，会调用 #doWrite 的子类具体实现，执行数据写入操作。

> 在 AbstractChannel$AbstractUnsafe 中，#flush 会调用 #flush0，进而调用 #doWrite。

每一次 #doWriteInternal 成功的数据写出 writeSpinCount 递减 1，直到 writeSpinCount 为 0。

在 #doWriteInternal 中，localFlushedAmount 为实际写出的字节数，如果 localFlushedAmount 小于等于 0，说明操作系统网络底层的写缓冲区满了。

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

1. writeSpinCount = 0，设置 OP_WRITE（？干啥、不懂哎！）；
2. writeSpinCount < 0，说明底层网络缓冲区满了，清除 OP_WRITE， 我们让打包*数据写出任务*到工作线程，以后继续。

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

// 设置关注事件类型 OP_WRITE
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

// 取消关注事件类型 OP_WRITE
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

### 0x0402 AbstractNioByteChannel$NioByteUnsafe

方法 #isAllowHalfClosure 判断是否允许半关闭。

方法 #read 执行流程：

1. 校验输入流是否已关闭，如果已关闭，则取消`读操作`等待标志并立即返回；
2. 分配 byteBuf；
3. 调用子类具体实现 #doReadBytes 读入数据到 byteBuf，并更新读取字节数到 allocHandle#lastBytesRead；
4. 如果没有读到数据，则释放 byteBuf；如果读到 EOF，设置 readPending 为 false；跳出循环；
5. 调用 allocHandle#incMessagesRead，读取记录数增加 1；设置 readPending 为 false；往通道中发送 ChannelRead 事件；
6. 调用 allocHandle#continueReading 判断是否需要继续读取数据，如果返回 true 则回到第 2 步；
7. 循环读取结束，往通道中发送 ChannelReadComplete 事件；
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

1. 如果出异常前 byteBuf 中已读取了部分数据，设置 readPending 为 false，往通道中发送 ChannelRead 事件，否则释放 byteBuf；
2. 往通道中发送 ChannelReadComplete 事件；
3. 往通道中发送 ExceptionCaught 事件；
4. 如果输入流返回了 EOF 或者出现了 IO 异常，调用 #closeOnRead，视 channel 配置选择关闭输入流或关闭整个通道；

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

方法 #closeOnRead，视 channel 配置选择关闭输入流或关闭整个通道。

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

### 0x0403 NioSocketChannel

作为 AbstractNioChannel#doConnect 的具体实现，调用了低层 SocketChannel#connect 方法，向服务端发起连接。 由于 Netty 中的多路复用通道总是被设置成非阻塞模式，因此 #connect 方法总是反回 false（？），这时需要在 selectionKey 中加入事件类型 *SelectionKey.OP_CONNECT*。在执行下一轮 #select 后，一旦出现该类事件，说明*连接已完成*，可以调用 SocketChannel#finishConnect 方法结束连接过程。

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
            // All written so clear OP_WRITE
            clearOpWrite();
            // Directly return here so incompleteWrite(...) is not called.
            return;
        }

        // Ensure the pending writes are made of ByteBufs only.
        int maxBytesPerGatheringWrite = ((NioSocketChannelConfig) config).getMaxBytesPerGatheringWrite();
        ByteBuffer[] nioBuffers = in.nioBuffers(1024, maxBytesPerGatheringWrite);
        int nioBufferCnt = in.nioBufferCount();

        // Always us nioBuffers() to workaround data-corruption.
        // See https://github.com/netty/netty/issues/2761
        switch (nioBufferCnt) {
            case 0:
                // We have something else beside ByteBuffers to write so fallback to normal writes.
                writeSpinCount -= doWrite0(in);
                break;
            case 1: {
                // Only one ByteBuf so use non-gathering write
                // Zero length buffers are not added to nioBuffers by ChannelOutboundBuffer, so there is no need
                // to check if the total size of all the buffers is non-zero.
                ByteBuffer buffer = nioBuffers[0];
                int attemptedBytes = buffer.remaining();
                final int localWrittenBytes = ch.write(buffer);
                if (localWrittenBytes <= 0) {
                    incompleteWrite(true);
                    return;
                }
                adjustMaxBytesPerGatheringWrite(attemptedBytes, localWrittenBytes, maxBytesPerGatheringWrite);
                in.removeBytes(localWrittenBytes);
                --writeSpinCount;
                break;
            }
            default: {
                // Zero length buffers are not added to nioBuffers by ChannelOutboundBuffer, so there is no need
                // to check if the total size of all the buffers is non-zero.
                // We limit the max amount to int above so cast is safe
                long attemptedBytes = in.nioBufferSize();
                final long localWrittenBytes = ch.write(nioBuffers, 0, nioBufferCnt);
                if (localWrittenBytes <= 0) {
                    incompleteWrite(true);
                    return;
                }
                // Casting to int is safe because we limit the total amount of data in the nioBuffers to int above.
                adjustMaxBytesPerGatheringWrite((int) attemptedBytes, (int) localWrittenBytes,
                        maxBytesPerGatheringWrite);
                in.removeBytes(localWrittenBytes);
                --writeSpinCount;
                break;
            }
        }
    } while (writeSpinCount > 0);

    incompleteWrite(writeSpinCount < 0);
}
{% endhighlight %}

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
{% endhighlight %}

{% highlight java linenos %}
{% endhighlight %}