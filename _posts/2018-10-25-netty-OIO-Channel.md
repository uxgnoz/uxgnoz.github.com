---
title: Netty 之通道 OIO 类 Channel
layout: posts
---

# Netty 之通道 OIO 类 Channel

------

OIOServerSocketChannel 的继承树如下：
{% highlight java %}
AbstractChannel 
    <- AbstractOioChannel 
    <- AbstractOioMessageChannel 
    <- OioServerSocketChannel
{% endhighlight %}

OioSocketChannel 的继承树如下：

{% highlight java %}
AbstractChannel 
    <- AbstractOioChannel 
    <- AbstractOioByteChannel 
    <- OioByteStreamChannel 
    <- OioSocketChannel
{% endhighlight %}

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

            // Get the state as trySuccess() may trigger an ChannelFutureListener that will close the Channel.
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

字段 readPending 指示有无读操作在等待处理。如果为 true 说明读取操作已发起，但还没有真正执行；false 说明没有发起读操作，或者读操作正在执行/已完成。

方法 #clearReadPending 设置当前没有读取操作在等待处理。

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

AbstractOioChannel 中实现安了 #beginRead。

1. 如果 readPending 为 true ，说明已发起过读操作，直接返回；
2. 否则，设置 readPending 为 true；
3. 在工作线程中调用子类实现 #doRead 异步发起读操作。
   
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

{% highlight java %}
{% endhighlight %}

------

## OioSocketChannel

{% highlight java %}
{% endhighlight %}


{% highlight java %}
{% endhighlight %}