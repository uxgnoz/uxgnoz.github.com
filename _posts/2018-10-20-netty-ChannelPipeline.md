---
title: Netty 之管道 ChannelPipeline
layout: posts
---

# Netty 之管道 ChannelPipeline

------

## 综述

ChannelPipeline 实现了拦截器模式（[Intercepting Filter](http://www.oracle.com/technetwork/java/interceptingfilter-142169.html) pattern）的高级版本。

管道中的主体结构为由 AbstractChannelHandlerContext 组成的双向链表，head 和 tail 分别为链表的表头和表尾。出站事件（inbound event）从 tail 流向 head，入站（outbound event）事件从 head 流向 tail。

{% highlight java %}
final AbstractChannelHandlerContext head;
final AbstractChannelHandlerContext tail;
{% endhighlight %}

在构造管道实例时，初始化了双向链表的基本结构。由传入参数，我们也可看出一个 channel 会对应一个管道实例。

{% highlight java %}
protected DefaultChannelPipeline(Channel channel) {
    this.channel = ObjectUtil.checkNotNull(channel, "channel");
    succeededFuture = new SucceededChannelFuture(channel, null);
    voidPromise =  new VoidChannelPromise(channel, true);

    tail = new TailContext(this);
    head = new HeadContext(this);

    head.next = tail;
    tail.prev = head;
}
{% endhighlight %}

childExecutors 用来固定管道任务在 EventExecutorGroup 中的工作线程。

{% highlight java %}
private Map<EventExecutorGroup, EventExecutor> childExecutors;

private EventExecutor childExecutor(EventExecutorGroup group) {
    if (group == null) {
        return null;
    }
    Boolean pinEventExecutor = channel.config().getOption(ChannelOption.SINGLE_EVENTEXECUTOR_PER_GROUP);
    if (pinEventExecutor != null && !pinEventExecutor) {
        return group.next();
    }
    Map<EventExecutorGroup, EventExecutor> childExecutors = this.childExecutors;
    if (childExecutors == null) {
        // Use size of 4 as most people only use one extra EventExecutor.
        childExecutors = this.childExecutors = new IdentityHashMap<EventExecutorGroup, EventExecutor>(4);
    }
    // Pin one of the child executors once and remember it so that the same child executor
    // is used to fire events for the same channel.
    EventExecutor childExecutor = childExecutors.get(group);
    if (childExecutor == null) {
        childExecutor = group.next();
        childExecutors.put(group, childExecutor);
    }
    return childExecutor;
}
{% endhighlight %}

我们把管道提供的 api 分为如下 4 类： 

* ChannelHandler 增删改查类
* ChannelInboundInvoker api
* ChannelOutboundInvoker api
* 其他类

------

## ChannelHandler 增删改查类

### ChannelPipeline#addFirst

方法 $checkMultiplicity 校验没有添加 Sharable 注解的 ChannelHandler 的同一实例不能添加多次。

方法 $filterName 对传入的 name 进行重复性校验，如果为 null 则自动生成一个 name。

方法 $newContext 创建新的 AbstractChannelHandlerContext 实例，并绑定自己的工作线程。

{% highlight java %}
public final ChannelPipeline addFirst(String name, ChannelHandler handler) {
    return addFirst(null, name, handler);
}

public final ChannelPipeline addFirst(EventExecutorGroup group, String name, ChannelHandler handler) {
    final AbstractChannelHandlerContext newCtx;
    synchronized (this) {
        checkMultiplicity(handler);
        name = filterName(name, handler);

        newCtx = newContext(group, name, handler);

        addFirst0(newCtx);

        // If the registered is false it means that the channel was not registered on an eventloop yet.
        // In this case we add the context to the pipeline and add a task that will call
        // ChannelHandler.handlerAdded(...) once the channel is registered.
        if (!registered) {
            newCtx.setAddPending();
            callHandlerCallbackLater(newCtx, true);
            return this;
        }

        EventExecutor executor = newCtx.executor();
        if (!executor.inEventLoop()) {
            newCtx.setAddPending();
            executor.execute(new Runnable() {
                @Override
                public void run() {
                    callHandlerAdded0(newCtx);
                }
            });
            return this;
        }
    }
    callHandlerAdded0(newCtx);
    return this;
}

private AbstractChannelHandlerContext newContext(EventExecutorGroup group, String name, 
        ChannelHandler handler) {
    return new DefaultChannelHandlerContext(this, childExecutor(group), name, handler);
}
{% endhighlight %}

方法 $addFirst0 往双向链表的头部插入新创建的 AbstractChannelHandlerContext 实例。

{% highlight java %}
private void addFirst0(AbstractChannelHandlerContext newCtx) {
    AbstractChannelHandlerContext nextCtx = head.next;
    newCtx.prev = head;
    newCtx.next = nextCtx;
    head.next = newCtx;
    nextCtx.prev = newCtx;
}
{% endhighlight %}

## ChannelInboundInvoker api

## ChannelOutboundInvoker api

## 其他类




{% highlight java %}

{% endhighlight %}