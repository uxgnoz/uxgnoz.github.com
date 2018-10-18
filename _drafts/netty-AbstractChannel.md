---
title: Netty 之通道 AbstractChannel
layout: posts
---

# Netty 之通道 AbstractChannel

------

## AbstractChannel

AbstractChannel 是接口 Channel 的抽象实现类。每个 Channel 都会有一个实 Unsafe 实例，它负责执行具体的 IO 操作。

在创建一个 Channel 的时候，必须要初始化它的 id、unsafe 和 ChannelPipeline。 

> AbstractChannel#newUnsafe 为抽象方法，留给具体的子类去实现。

> parent 的值可以为 null。

{% highlight java %}
protected AbstractChannel(Channel parent) {
    this.parent = parent;
    id = newId();
    unsafe = newUnsafe();
    pipeline = newChannelPipeline();
}

protected AbstractChannel(Channel parent, ChannelId id) {
    this.parent = parent;
    this.id = id;
    unsafe = newUnsafe();
    pipeline = newChannelPipeline();
}

protected abstract AbstractUnsafe newUnsafe();

protected DefaultChannelPipeline newChannelPipeline() {
    return new DefaultChannelPipeline(this);
}
{% endhighlight %}

AbstractChannel 中实现的所有出站类方法都是委托给 pipeline 去执行的。。

{% highlight java %}

public ChannelFuture connect(SocketAddress remoteAddress) {
    return pipeline.connect(remoteAddress);
}
{% endhighlight %}

## AbstractChannel#AbstractUnsafe

所有的`入站`事件从这里开始，然后进入管道 head，流向 tail。所有的数据`出站`事件在管道中从 tail 走到 head 后才会在 Unsafe 中真正执行。

> `出站`事件这里只是说事件流向，并非一定要从 tail 开始，通常我们数据发送时会调用 ctx#write 方法，这时数据从当前 ctx 流向 head 。

每个 Unsafe 实例都有自己的数据发送缓冲区 outboundBuffer。 ChannelOutboundBuffer 见[Netty 之发送缓冲区 ChannelOutboundBuffer](/ChannelOutboundBuffer/)。

------

### AbstractUnsafe#register

AbstractUnsafe#register 主要功能为 channel 注册工作线程（EventLoop）。

流程：

1. 设置工作线程;
2. 执行具体子类附加注册功能；
3. 调用管道中所有 ChannelHandler#handlerAdded 方法；
4. 向管道中发送 channel 注册成功事件
5. 如果是 channel 的首次注册，向管道中发送 channel 激活事件
6. 如果是非首次注册，且 channel 设置了自动读取，则发起数据读取操作

{% highlight java %}
public final void register(EventLoop eventLoop, final ChannelPromise promise) {
    // 设置工作线程
    AbstractChannel.this.eventLoop = eventLoop;
    // 省略校验代码 。。。

    if (eventLoop.inEventLoop()) {
        register0(promise);
    } else {
        try {
            eventLoop.execute(new Runnable() {
                @Override
                public void run() {
                    register0(promise);
                }
            });
        } catch (Throwable t) {
            closeForcibly();
            closeFuture.setClosed();
            safeSetFailure(promise, t);
        }
    }
}

private void register0(ChannelPromise promise) {
    try {
        if (!promise.setUncancellable() || !ensureOpen(promise)) {
            return;
        }
        boolean firstRegistration = neverRegistered;
        // 待子类实现附加功能
        doRegister();
        neverRegistered = false;
        registered = true;

        // 调用管道中所有 ChannelHandler#handlerAdded 方法
        pipeline.invokeHandlerAddedIfNeeded();

        safeSetSuccess(promise);
        // 向管道中发送 channel 注册成功事件
        pipeline.fireChannelRegistered();

        if (isActive()) {
            if (firstRegistration) {
                // 如果是 channel 的首次注册，向管道中发送 channel 激活事件
                pipeline.fireChannelActive();
            } else if (config().isAutoRead()) {
                // 如果是非首次注册，且 channel 设置了自动读取，则发起数据读取操作
                beginRead();
            }
        }
    } catch (Throwable t) {
        // Close the channel directly to avoid FD leak.
        closeForcibly();
        closeFuture.setClosed();
        safeSetFailure(promise, t);
    }
}

public final void beginRead() {
    assertEventLoop();

    if (!isActive()) {
        return;
    }

    try {
        // 待具体子类实现
        doBeginRead();
    } catch (final Exception e) {
        invokeLater(new Runnable() {
            @Override
            public void run() {
                pipeline.fireExceptionCaught(e);
            }
        });
        close(voidPromise());
    }
}
{% endhighlight %}

### AbstractUnsafe#deregister

channel 注销工作线程（EventLoop）。

{% highlight java %}

{% endhighlight %}



{% highlight java %}
{% endhighlight %}