---
title: Netty 之 ChannelHandler 上下文 ChannelHandlerContext
layout: posts
---

# Netty 之 ChannelHandler 上下文 ChannelHandlerContext

------

## 综述

ChannelHandlerContext 继承自 ChannelInboundInvoker 和 ChannelOutboundInvoker。

> ChannelHandlerContext ， ChannelPipeline 和 Channel 存在很多方法签名重叠，因此 Maurer 提炼出了 ChannelInboundInvoker 和 ChannelOutboundInvoker 2 个接口。 ChannelInboundInvoker 负责处理输入事件， ChannelOutboundInvoker 处理输出事件，因此它们事件传播方向上是相反的。

ChannelHandler 可以通过 ChannelHandlerContext 和它所属的管道及管道上其他 ChannelHandler 互动。ChannelHandler 可以动态修改管道的属性，也可以给紧靠着它的下一个（上一个） ChannelHandler 发送通知。

下面的 9 种通知方法，它们继承自 ChannelInboundInvoker。

{% highlight java linenos %}
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

ChannelOutboundInvoker 中的方法可就多了，分为如下 3 类：

* 连接类
* 读写类
* Future 类

## ChannelHandlerContext#fireChannelRegistered()

Channel 注册到 EventLoop 时，触发 channelRegistered 事件，开始调用下一个 ChannelHandler 的 #channelRegistered(ChannelHandlerContext) 方法。

方法 #findContextInbound 从当前 ctx 开始，查找下一个 inbound 为 true 的 ctx。

静态方法 @invokeChannelRegistered 直接调用下一个 ctx 的 #invokeChannelRegistered 方法。

> 调用的方式有点特别，如果当前代码执行在工作线程，则直接调用，否则打包成任务，再添加到工作线程异步执行。

{% highlight java linenos %}
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

{% highlight java linenos %}
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

字段 inbound 指示当前 ctx 的 ChannelHandler 类型为 ChannelInboundHandler 。

{% highlight java linenos %}
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

## 连接类

连接类包括如下几个方法：

{% highlight java linenos %}
ChannelFuture bind(SocketAddress localAddress);
ChannelFuture bind(SocketAddress localAddress, ChannelPromise promise);

ChannelFuture connect(SocketAddress remoteAddress);
ChannelFuture connect(SocketAddress remoteAddress, ChannelPromise promise);
ChannelFuture connect(SocketAddress remoteAddress, SocketAddress localAddress);
ChannelFuture connect(SocketAddress remoteAddress, SocketAddress localAddress, ChannelPromise promise);

ChannelFuture close();
ChannelFuture close(ChannelPromise promise);

ChannelFuture disconnect();
ChannelFuture disconnect(ChannelPromise promise);

ChannelFuture deregister();
ChannelFuture deregister(ChannelPromise promise);
{% endhighlight %}

### ChannelHandlerContext#bind()

基本上跟上文中的 #fireChannelRegistered 一个套路啊。

方法 #findContextOutbound 从当前 ctx 开始，查找下一个 outbound 为 true 的 ctx。最终还是要调用 ctx 的 ChannelOutboundHandler#bind 方法。

{% highlight java linenos %}
public ChannelFuture bind(SocketAddress localAddress) {
    return bind(localAddress, newPromise());
}

public ChannelFuture bind(final SocketAddress localAddress, final ChannelPromise promise) {
    if (localAddress == null) {
        throw new NullPointerException("localAddress");
    }
    if (isNotValidPromise(promise, false)) {
        // cancelled
        return promise;
    }

    final AbstractChannelHandlerContext next = findContextOutbound();
    EventExecutor executor = next.executor();
    if (executor.inEventLoop()) {
        next.invokeBind(localAddress, promise);
    } else {
        safeExecute(executor, new Runnable() {
            @Override
            public void run() {
                next.invokeBind(localAddress, promise);
            }
        }, promise, null);
    }
    return promise;
}

private void invokeBind(SocketAddress localAddress, ChannelPromise promise) {
    if (invokeHandler()) {
        try {
            ((ChannelOutboundHandler) handler()).bind(this, localAddress, promise);
        } catch (Throwable t) {
            notifyOutboundHandlerException(t, promise);
        }
    } else {
        bind(localAddress, promise);
    }
}
{% endhighlight %}

和 #findContextInbound 相反，查找下一个 ctx 时，是从当前 ctx 往前查找。很明显，ctx 将会形成一个双向链表。

字段 outbound 指示当前 ctx 的 ChannelHandler 类型为 ChannelOutboundHandler 。

{% highlight java linenos %}
private AbstractChannelHandlerContext findContextOutbound() {
    AbstractChannelHandlerContext ctx = this;
    do {
        ctx = ctx.prev;
    } while (!ctx.outbound);
    return ctx;
}
{% endhighlight %}

其他方法在套路上是一样一样的，不再赘述。

------

## 读写类

{% highlight java linenos %}
ChannelOutboundInvoker read();

ChannelFuture write(Object msg);
ChannelFuture write(Object msg, ChannelPromise promise);

ChannelOutboundInvoker flush();

ChannelFuture writeAndFlush(Object msg);
ChannelFuture writeAndFlush(Object msg, ChannelPromise promise);
{% endhighlight %}

### ChannelHandlerContext#read()

略。

### ChannelHandlerContext#write()

#write 最终调用私有方法 $write。

不管中间过程咋样，最终还是去调用 ChannelOutboundHandler#write，#flush 方法。

{% highlight java linenos %}
private void write(Object msg, boolean flush, ChannelPromise promise) {
    AbstractChannelHandlerContext next = findContextOutbound();
    final Object m = pipeline.touch(msg, next);
    EventExecutor executor = next.executor();
    if (executor.inEventLoop()) {
        if (flush) {
            next.invokeWriteAndFlush(m, promise);
        } else {
            next.invokeWrite(m, promise);
        }
    } else {
        AbstractWriteTask task;
        if (flush) {
            task = WriteAndFlushTask.newInstance(next, m, promise);
        }  else {
            task = WriteTask.newInstance(next, m, promise);
        }
        safeExecute(executor, task, promise, m);
    }
}

private void invokeWrite(Object msg, ChannelPromise promise) {
    if (invokeHandler()) {
        invokeWrite0(msg, promise);
    } else {
        write(msg, promise);
    }
}

private void invokeWrite0(Object msg, ChannelPromise promise) {
    try {
        ((ChannelOutboundHandler) handler()).write(this, msg, promise);
    } catch (Throwable t) {
        notifyOutboundHandlerException(t, promise);
    }
}

private void invokeWriteAndFlush(Object msg, ChannelPromise promise) {
    if (invokeHandler()) {
        invokeWrite0(msg, promise);
        invokeFlush0();
    } else {
        writeAndFlush(msg, promise);
    }
}

private void invokeFlush0() {
    try {
        ((ChannelOutboundHandler) handler()).flush(this);
    } catch (Throwable t) {
        notifyHandlerException(t);
    }
}

{% endhighlight %}

### ChannelHandlerContext#flush()

略。

------

### Future 类

{% highlight java linenos %}
ChannelFuture newFailedFuture(Throwable cause);
ChannelProgressivePromise newProgressivePromise();
ChannelPromise newPromise();
ChannelFuture newSucceededFuture();
ChannelPromise voidPromise();
{% endhighlight %}

略。

## 总结

不论 ChannelHandlerContext 想干啥，最终都得落实到 ChannelHandler 上去，它就是个传话筒。

> ChannelHandlerContext 的其他部分我们放到 ChannelPipiline 说。