---
title: Netty 之 ChannelHandler 上下文 ChannelHandlerContext
layout: posts
---

# Netty 之 ChannelHandler 上下文 ChannelHandlerContext

------

## 综述

ChannelHandlerContext 继承自 ChannelInboundInvoker 和 ChannelOutboundInvoker。

ChannelHandler 可以通过 ChannelHandlerContext 和它所属的管道及管道上其他 ChannelHandler 互动。ChannelHandler 可以动态修改管道的属性，也可以给紧靠着它的下一个 ChannelHandler 发送通知。

ChannelHandlerContext 提供了 如下 9 中通知方法，它们继承自 ChannelInboundInvoker。

{% highlight java %}
ChannelHandlerContext fireChannelRegistered();

ChannelHandlerContext fireChannelUnregistered();

ChannelHandlerContext fireChannelActive();

ChannelHandlerContext fireChannelInactive();

ChannelHandlerContext fireExceptionCaught(Throwable cause);

ChannelHandlerContext fireUserEventTriggered(Object evt);

ChannelHandlerContext fireChannelRead(Object msg);

ChannelHandlerContext fireChannelReadComplete();

ChannelHandlerContext fireChannelWritabilityChanged();
{% endhighlight %}



## ChannelHandlerContext#fireChannelRegistered()

Channel 注册到 EventLoop 时，触发 channelRegistered 事件，开始调用下一个 ChannelHandler 的 #channelRegistered(ChannelHandlerContext) 方法。

方法 #findContextInbound 从当前 ctx 开始，查找下一个 inbound 为 true 的 ctx。

静态方法 @invokeChannelRegistered 直接调用下一个 ctx 的 #invokeChannelRegistered 方法。

> 调用的方式有点特别，如果当前代码执行在工作线程，则直接调用，否则打包成任务，再添加到工作线程异步执行。

{% highlight java %}
public ChannelHandlerContext fireChannelRegistered() {
    invokeChannelRegistered(findContextInbound());
    return this;
}

static void invokeChannelRegistered(final AbstractChannelHandlerContext next) {
    EventExecutor executor = next.executor();
    if (executor.inEventLoop()) {
        next.invokeChannelRegistered();
    } else {
        executor.execute(new Runnable() {
            @Override
            public void run() {
                next.invokeChannelRegistered();
            }
        });
    }
}
{% endhighlight %}

在 #invokeChannelRegistered 中，如果当前 ctx 的 ChannelHandler 准备就绪，那么直接调用它的 #channelRegistered 方法。否则继续往下一个 ChannelHandler 传播 channelRegistered 事件。

{% highlight java %}
private void invokeChannelRegistered() {
    if (invokeHandler()) {
        try {
            ((ChannelInboundHandler) handler()).channelRegistered(this);
        } catch (Throwable t) {
            notifyHandlerException(t);
        }
    } else {
        fireChannelRegistered();
    }
}

private boolean invokeHandler() {
    // Store in local variable to reduce volatile reads.
    int handlerState = this.handlerState;
    return handlerState == ADD_COMPLETE || (!ordered && handlerState == ADD_PENDING);
}
{% endhighlight %}

字段 inbound 指示当前 ctx 的 ChannelHandler 类型为 ChannelInboundHandler ，也就是 handler 对进来的数据感兴趣。

{% highlight java %}
private AbstractChannelHandlerContext findContextInbound() {
    AbstractChannelHandlerContext ctx = this;
    do {
        ctx = ctx.next;
    } while (!ctx.inbound);
    return ctx;
}

// DefaultChannelHandlerContext@isInbound
private static boolean isInbound(ChannelHandler handler) {
    return handler instanceof ChannelInboundHandler;
}
{% endhighlight %}

ChannelInboundInvoker 中的其他 8 个方法实现类似，不再赘述。

------

未完待续。。。

{% highlight java %}
{% endhighlight %}