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
                logger.warn(
                        "Failed to close a partially initialized socket.", e2);
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
                // Force the Selector to select now as the "canceled" SelectionKey may still be
                // cached and not removed because no Select.select(..) operation was called yet.
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

## NioServerSocketChannel

{% highlight linenos %}
AbstractChannel
<- AbstractNioChannel
<- AbstractNioMessageChannel
<- NioServerSocketChannel
{% endhighlight %}


{% highlight java linenos %}
{% endhighlight %}


------

## NioSocketChannel

{% highlight linenos %}
AbstractChannel
<- AbstractNioChannel
<- AbstractNioByteChannel
<- NioSocketChannel
{% endhighlight %}

{% highlight java linenos %}
{% endhighlight %}
{% highlight java linenos %}
{% endhighlight %}