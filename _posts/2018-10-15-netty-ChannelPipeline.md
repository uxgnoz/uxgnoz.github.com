---
title: Netty 之管道 ChannelPipeline
layout: posts
---

# Netty 之管道 ChannelPipeline

------

## 综述

ChannelPipeline 实现了拦截器模式（[Intercepting Filter](http://www.oracle.com/technetwork/java/interceptingfilter-142169.html) pattern）的高级版本。

管道中的主体结构为由 AbstractChannelHandlerContext 组成的双向链表，head 和 tail 分别为链表的表头和表尾。出站事件（outbound event）从 tail 流向 head，入站事件（inbound event）从 head 流向 tail。

{% highlight java linenos %}
final AbstractChannelHandlerContext head;
final AbstractChannelHandlerContext tail;
{% endhighlight %}

在构造管道实例时，初始化了双向链表的基本结构。由构造函数的参数，我们也可看出一个 channel 会对应一个管道实例。

{% highlight java linenos %}
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

{% highlight java linenos %}
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

ChannelPipeline#addFirst 创建传入参数 ChannelHandler 的 AbstractChannelHandlerContext 实例 newCtx，并插入到链表表头 head 之后。插入成功后，需要在相应的工作线程调用 ChannelHandler#handlerAdded 方法。

如果此时 channel 尚未注册到相应的工作线程（event loop），则调用方法 $callHandlerCallbackLater() 往异步任务队列中添加任务，等 channel 注册工作线程成功后，触发 ChannelPipeline#callHandlerAddedForAllHandlers 异步执行ChannelHandler#handlerAdded 方法 。

{% highlight java linenos %}
public final ChannelPipeline addFirst(String name, ChannelHandler handler) {
    return addFirst(null, name, handler);
}

public final ChannelPipeline addFirst(EventExecutorGroup group, String name, ChannelHandler handler) {
    final AbstractChannelHandlerContext newCtx;
    synchronized (this) {
        // 校验没有添加 Sharable 注解的 ChannelHandler 的同一实例不能添加多次
        checkMultiplicity(handler);
        // 对传入的 name 进行重复性校验，如果为 null 则自动生成一个 name
        name = filterName(name, handler);
        // 创建新的 AbstractChannelHandlerContext 实例，并绑定自己的工作线程
        newCtx = newContext(group, name, handler);
        // 往双向链表的头部插入新创建的 AbstractChannelHandlerContext 实例
        addFirst0(newCtx);

        // registered 为 false 说明 channel 还没有 注册到工作线程，
        // 我们设置新的 AbstractChannelHandlerContext 实例状态为『未就绪』，
        // 同时添加一个异步任务，当 channel 注册成功时，最终去调用 ChannelHandler#handlerAdded 方法
        if (!registered) {
            newCtx.setAddPending();
            callHandlerCallbackLater(newCtx, true);
            return this;
        }

        // registered 为 true
        // 获取 newCtx 的工作线程，如果 newCtx 自己没有工作线程，则使用关联的 channel 注册的工作线程
        EventExecutor executor = newCtx.executor();
        if (!executor.inEventLoop()) {
            // 设置 newCtx 状态 『未就绪』
            newCtx.setAddPending();
            // 工作线程异步调用 ChannelHandler#handlerAdded
            executor.execute(new Runnable() {
                @Override
                public void run() {
                    callHandlerAdded0(newCtx);
                }
            });
            return this;
        }
    }

    // 当前处于工作线程，直接调用 ChannelHandler#handlerAdded
    callHandlerAdded0(newCtx);
    return this;
}

private AbstractChannelHandlerContext newContext(EventExecutorGroup group, String name, 
        ChannelHandler handler) {
    return new DefaultChannelHandlerContext(this, childExecutor(group), name, handler);
}

// 在双链表的表头 head 之后插入 newCtx
private void addFirst0(AbstractChannelHandlerContext newCtx) {
    AbstractChannelHandlerContext nextCtx = head.next;
    newCtx.prev = head;
    newCtx.next = nextCtx;
    head.next = newCtx;
    nextCtx.prev = newCtx;
}

private void callHandlerAdded0(final AbstractChannelHandlerContext ctx) {
    try {
        // We must call setAddComplete before calling handlerAdded. 
        // Otherwise if the handlerAdded method generates
        // any pipeline events ctx.handler() will miss them because the state will not allow it.
        ctx.setAddComplete();
        ctx.handler().handlerAdded(ctx);
    } catch (Throwable t) {
        boolean removed = false;
        try {
            remove0(ctx);
            try {
                ctx.handler().handlerRemoved(ctx);
            } finally {
                ctx.setRemoved();
            }
            removed = true;
        } catch (Throwable t2) {
            if (logger.isWarnEnabled()) {
                logger.warn("Failed to remove a handler: " + ctx.name(), t2);
            }
        }

        if (removed) {
            fireExceptionCaught(new ChannelPipelineException(
                    ctx.handler().getClass().getName() +
                    ".handlerAdded() has thrown an exception; removed.", t));
        } else {
            fireExceptionCaught(new ChannelPipelineException(
                    ctx.handler().getClass().getName() +
                    ".handlerAdded() has thrown an exception; also failed to remove.", t));
        }
    }
}
{% endhighlight %}

方法 $callHandlerCallbackLater 往 pendingHandlerCallbackHead 为头指针的单链表的表尾插入异步任务。任务分为 AbstractChannelHandlerContext 添加任务和删除任务，最终都是要在 ctx 自己的工作线程中去调用它关联的 ChannelHandler#handlerAdded 或者 ChannelHandler#handlerRemoved 方法。

{% highlight java linenos %}
/**
 * This is the head of a linked list that is processed by {@link #callHandlerAddedForAllHandlers()} and so process
 * all the pending {@link #callHandlerAdded0(AbstractChannelHandlerContext)}.
 *
 * We only keep the head because it is expected that the list is used infrequently and its size is small.
 * Thus full iterations to do insertions is assumed to be a good compromised to saving memory and tail management
 * complexity.
 */
private PendingHandlerCallback pendingHandlerCallbackHead;

// 在 pendingHandlerCallbackHead 作表头的单向链表尾部插入 add 或 remove 任务
private void callHandlerCallbackLater(AbstractChannelHandlerContext ctx, boolean added) {
    assert !registered;

    PendingHandlerCallback task = added ? new PendingHandlerAddedTask(ctx) : new PendingHandlerRemovedTask(ctx);
    PendingHandlerCallback pending = pendingHandlerCallbackHead;
    if (pending == null) {
        pendingHandlerCallbackHead = task;
    } else {
        // Find the tail of the linked-list.
        while (pending.next != null) {
            pending = pending.next;
        }
        pending.next = task;
    }
}

private final class PendingHandlerAddedTask extends PendingHandlerCallback {
    PendingHandlerAddedTask(AbstractChannelHandlerContext ctx) {
        super(ctx);
    }

    public void run() {
        callHandlerAdded0(ctx);
    }

    void execute() {
        EventExecutor executor = ctx.executor();

        // 判断当前代码执行是否在工作线程
        if (executor.inEventLoop()) {
            // 直接调用
            callHandlerAdded0(ctx);
        } else {
            try {
                // 向工作线程提交任务
                executor.execute(this);
            } catch (RejectedExecutionException e) {
                remove0(ctx);
                ctx.setRemoved();
            }
        }
    }
}
{% endhighlight %}

### ChannelPipeline#addLast

逻辑和 #addFirst 类似。

{% highlight java linenos %}
// 在链表表尾 tail 之前插入 newCtx
private void addLast0(AbstractChannelHandlerContext newCtx) {
    AbstractChannelHandlerContext prev = tail.prev;
    newCtx.prev = prev;
    newCtx.next = tail;
    prev.next = newCtx;
    tail.prev = newCtx;
}
{% endhighlight %}

### ChannelPipeline#addBefore

逻辑和 #addFirst 类似。

{% highlight java linenos %}
// 在链表元素 ctx 之前插入 newCtx
private static void addBefore0(AbstractChannelHandlerContext ctx, AbstractChannelHandlerContext newCtx) {
    newCtx.prev = ctx.prev;
    newCtx.next = ctx;
    ctx.prev.next = newCtx;
    ctx.prev = newCtx;
}
{% endhighlight %}

### ChannelPipeline#addAfter

逻辑和 #addFirst 类似。

{% highlight java linenos %}
// 在链表元素 ctx 之后插入 newCtx
private static void addAfter0(AbstractChannelHandlerContext ctx, AbstractChannelHandlerContext newCtx) {
    newCtx.prev = ctx;
    newCtx.next = ctx.next;
    ctx.next.prev = newCtx;
    ctx.next = newCtx;
}
{% endhighlight %}

### ChannelPipeline#remove

从管道中删除特定的 ChannelHandler ，实际上删除的是 ChannelHandler 对应的 AbstractChannelHandlerContext 实例。删除成功后，需在工作线程调用 ChannelHandler#handlerRemoved 方法。

同 #addFirst 一样，如果此时 channel 还没有注册工作线程，往 pendingHandlerCallbackHead 指向的链表中添加 remove 任务，待将来执行。

{% highlight java linenos %}
public final ChannelHandler remove(String name) {
    return remove(getContextOrDie(name)).handler();
}

private AbstractChannelHandlerContext remove(final AbstractChannelHandlerContext ctx) {
    synchronized (this) {
        remove0(ctx);

        if (!registered) {
            callHandlerCallbackLater(ctx, false);
            return ctx;
        }

        EventExecutor executor = ctx.executor();
        if (!executor.inEventLoop()) {
            executor.execute(new Runnable() {
                @Override
                public void run() {
                    callHandlerRemoved0(ctx);
                }
            });
            return ctx;
        }
    }
    callHandlerRemoved0(ctx);
    return ctx;
}

// 从链表中删除 ctx
private static void remove0(AbstractChannelHandlerContext ctx) {
    AbstractChannelHandlerContext prev = ctx.prev;
    AbstractChannelHandlerContext next = ctx.next;
    prev.next = next;
    next.prev = prev;
}

private final class PendingHandlerRemovedTask extends PendingHandlerCallback {
    PendingHandlerRemovedTask(AbstractChannelHandlerContext ctx) {
        super(ctx);
    }

    public void run() {
        callHandlerRemoved0(ctx);
    }

    void execute() {
        EventExecutor executor = ctx.executor();
        if (executor.inEventLoop()) {
            // 直接执行
            callHandlerRemoved0(ctx);
        } else {
            try {
                // 向工作线程提交，异步执行
                executor.execute(this);
            } catch (RejectedExecutionException e) {
                if (logger.isWarnEnabled()) {
                    logger.warn(
                            "Can't invoke handlerRemoved() as the EventExecutor {} rejected it," +
                                    " removing handler {}.", executor, ctx.name(), e);
                }
                // remove0(...) was call before so just call AbstractChannelHandlerContext.setRemoved().
                ctx.setRemoved();
            }
        }
    }
}
{% endhighlight %}

### ChannelPipeline#replace

删除旧的 ChannelHander ， 插入新的 ChannelHandler。

> 要保证 ChannelHandler#handlerAdded 在 ChannelHandler#handlerRemoved 之前调用。因为 ChannelHandler#handlerRemoved 可能会触发 ChannelHandler#channelRead 和 ChannelHandler#flush 方法，这些方法必须在新的 ChannelHandler#handlerAdded 调用之后才能执行。

{% highlight java linenos %}
private ChannelHandler replace(
        final AbstractChannelHandlerContext ctx, String newName, ChannelHandler newHandler) {
    assert ctx != head && ctx != tail;

    final AbstractChannelHandlerContext newCtx;
    synchronized (this) {
        // 此处省略部分雷同代码

        newCtx = newContext(ctx.executor, newName, newHandler);
        // 执行链表替换操作
        replace0(ctx, newCtx);

        if (!registered) {
            callHandlerCallbackLater(newCtx, true);
            callHandlerCallbackLater(ctx, false);
            return ctx.handler();
        }

        EventExecutor executor = ctx.executor();
        if (!executor.inEventLoop()) {
            executor.execute(new Runnable() {
                @Override
                public void run() {
                    callHandlerAdded0(newCtx);
                    callHandlerRemoved0(ctx);
                }
            });
            return ctx.handler();
        }
    }

    callHandlerAdded0(newCtx);
    callHandlerRemoved0(ctx);
    return ctx.handler();
}
{% endhighlight %}

## ChannelInboundInvoker api

ChannelPipeline#fireChannelRegistered 方法直接调用 AbstractChannelHandlerContext#invokeChannelRegistered ，传入的参数为*表头节点*。其他入站类方法类似。

ChannelHandlerContext 分析见 [Netty 之 ChannelHandler 上下文 ChannelHandlerContext](/netty-ChannelHandlerContext/) 。

{% highlight java linenos %}
public final ChannelPipeline fireChannelRegistered() {
    AbstractChannelHandlerContext.invokeChannelRegistered(head);
    return this;
}
{% endhighlight %}

## ChannelOutboundInvoker api

ChannelPipeline#bind 从链表的尾部开始调用 ChannelHandlerContext#bind 方法。其他出站类方法类似。

ChannelHandlerContext 分析见 [Netty 之 ChannelHandler 上下文 ChannelHandlerContext](/netty-ChannelHandlerContext/) 。

{% highlight java linenos %}
public final ChannelFuture bind(SocketAddress localAddress) {
    return tail.bind(localAddress);
}
{% endhighlight %}

## 其他类

方法 #onUnhandledInboundXXX 处理没有被管道中的 ChannelHandler 处理的事件，要么做资源释放，要么为空方法。

### ChannelPipeline#invokeHandlerAddedIfNeeded

channel 在第一次注册工作线程的时候要调用 ChannelPipeline#invokeHandlerAddedIfNeeded，依次执行 pendingHandlerCallbackHead 指向链表中 ChannelHandler#handlerAdded 。

> 确保之前添加的所有 ChannelHandler 在处理其他事件之前先调用 ChannelHandler#handlerAdded 方法。

{% highlight java linenos %}
final void invokeHandlerAddedIfNeeded() {
    assert channel.eventLoop().inEventLoop();
    if (firstRegistration) {
        firstRegistration = false;
        callHandlerAddedForAllHandlers();
    }
}

private void callHandlerAddedForAllHandlers() {
    final PendingHandlerCallback pendingHandlerCallbackHead;
    synchronized (this) {
        assert !registered;
        // This Channel itself was registered.
        registered = true;

        pendingHandlerCallbackHead = this.pendingHandlerCallbackHead;
        // Null out so it can be GC'ed.
        this.pendingHandlerCallbackHead = null;
    }

    // 依次执行 pendingHandlerCallbackHead 指向链表中的任务
    PendingHandlerCallback task = pendingHandlerCallbackHead;
    while (task != null) {
        task.execute();
        task = task.next;
    }
}
{% endhighlight %}

## 表头表尾

HeadContext 为管道的表头节点，同时实现了 ChannelInboundHandler 和 ChannnelOutboundHandler。作为 ChannelInboundHandler ，它负责向后传递入站事件。作为 ChannnelOutboundHandler ，它负责利用 Channel@Unsafe 执行具体的出站事件，如数据发送，连接对端，绑定端口等等。

TailContext 为管道尾部节点，同时实现了 ChannelInboundHandler 接口，它负责调用 ChannelPipeline#onUnhandledInboundXXX 方法消化管道中未处理事件。

代码略。