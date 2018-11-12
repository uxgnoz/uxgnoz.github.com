---
title: Netty 之工作线程组 NioEventLoopGroup
layout: posts
---

# Netty 之工作线程组 NioEventLoopGroup

------

## 综述

`NioEventLoopGroup`中内部维护一个`工作线程`数组，channel 注册时，它从数组中按特定算法挑选一个，提供给 channel 。默认的挑选算法是*循环挑选*。

`NioEventLoopGroup`负责管理内部*工作线程*的生命周期。所有作为`EventExecutor`的职责，都通过委托的方式，给其中一个*工作线程*来处理。

工作线程`NioEventLoop`请参考[Netty 之工作线程 NioEventLoop](/netty-NioEventLoop/)。

下面是`NioEventLoopGroup`继承树，不含接口。

{% highlight java linenos %}
AbstractEventExecutorGroup
<- MultithreadEventExecutorGroup
<- MultithreadEventLoopGroup
<- NioEventLoopGroup
{% endhighlight %}

主要的初始化工作在`MultithreadEventExecutorGroup`的构造函数中。

{% highlight java linenos %}
protected MultithreadEventExecutorGroup(
        int nThreads, Executor executor, 
        EventExecutorChooserFactory chooserFactory, Object... args) {
    // 线程数如果不提供，默认是 cpu 核数 * 2
    if (nThreads <= 0) {
        throw new IllegalArgumentException(
            String.format("nThreads: %d (expected: > 0)", nThreads)
        );
    }
    // executor 提供真正的执行线程
    if (executor == null) {
        // 默认使用 ThreadPerTaskExecutor，此时一个工作线程对应一个底层 java 线程
        executor = new ThreadPerTaskExecutor(newDefaultThreadFactory());
    }
    // 初始化工作线程存放数组
    children = new EventExecutor[nThreads];

    for (int i = 0; i < nThreads; i ++) {
        boolean success = false;
        try {
            // 初始化每个工作线程
            children[i] = newChild(executor, args);
            success = true;
        } catch (Exception e) {
            throw new IllegalStateException("failed to create a child event loop", e);
        } finally {
            if (!success) {
                // 初始化工作线程失败
                for (int j = 0; j < i; j ++) {
                    // 依次关闭初始化成功的工作线程
                    children[j].shutdownGracefully();
                }

                for (int j = 0; j < i; j ++) {
                    EventExecutor e = children[j];
                    try {
                        // 无限等待工作线程终止
                        while (!e.isTerminated()) {
                            e.awaitTermination(Integer.MAX_VALUE, TimeUnit.SECONDS);
                        }
                    } catch (InterruptedException interrupted) {
                        // 被中断，设置中断标志，退出循环，剩下的留给用户处理
                        Thread.currentThread().interrupt();
                        break;
                    }
                }
            }
        }
    }
    // 初始化工作线程挑选算法，默认是循环挑选
    chooser = chooserFactory.newChooser(children);
    // 初始化工作线程终止监听器
    final FutureListener<Object> terminationListener = new FutureListener<Object>() {
        @Override
        public void operationComplete(Future<Object> future) throws Exception {
            if (terminatedChildren.incrementAndGet() == children.length) {
                // 所有 工作线程 都已终止，设置 工作线程组 已终止
                terminationFuture.setSuccess(null);
            }
        }
    };

    for (EventExecutor e: children) {
        // 依次添加工作线程终止监听器
        e.terminationFuture().addListener(terminationListener);
    }
    // 初始化只读工作线程集合 readonlyChildren
    Set<EventExecutor> childrenSet = new LinkedHashSet<EventExecutor>(children.length);
    Collections.addAll(childrenSet, children);
    readonlyChildren = Collections.unmodifiableSet(childrenSet);
}
// NioEventLoopGroup#newChild
// 返回新的 工作线程 实例
protected EventLoop newChild(Executor executor, Object... args) throws Exception {
    return new NioEventLoop(
        this, 
        executor, 
        (SelectorProvider) args[0],
        ((SelectStrategyFactory) args[1]).newSelectStrategy(), 
        (RejectedExecutionHandler) args[2]
    );
}
{% endhighlight %}

------

## #next

从内部数组中挑选一个*工作线程*并返回。Netty自带的 2 个选择器都是按*循环挑选*算法返回*工作线程*。

{% highlight java linenos %}
public EventExecutor next() {
    return chooser.next();
}
// DefaultEventExecutorChooserFactory$PowerOfTwoEventExecutorChooser
private static final class PowerOfTwoEventExecutorChooser implements EventExecutorChooser {
    private final AtomicInteger idx = new AtomicInteger();
    private final EventExecutor[] executors;

    PowerOfTwoEventExecutorChooser(EventExecutor[] executors) {
        this.executors = executors;
    }

    @Override
    public EventExecutor next() {
        // 自增取模
        return executors[idx.getAndIncrement() & executors.length - 1];
    }
}
// DefaultEventExecutorChooserFactory$GenericEventExecutorChooser
private static final class GenericEventExecutorChooser implements EventExecutorChooser {
    private final AtomicInteger idx = new AtomicInteger();
    private final EventExecutor[] executors;

    GenericEventExecutorChooser(EventExecutor[] executors) {
        this.executors = executors;
    }

    @Override
    public EventExecutor next() {
        // 自增取模
        return executors[Math.abs(idx.getAndIncrement() % executors.length)];
    }
}
{% endhighlight %}

------

## #register

从内部数组中选取一个*工作线程*注册 channel。

{% highlight java linenos %}
public ChannelFuture register(Channel channel) {
    return next().register(channel);
}

@Override
public ChannelFuture register(ChannelPromise promise) {
    return next().register(promise);
}
{% endhighlight %}

------

## #rebuildSelectors

重建数组中所有*工作线程*的 Selector。

{% highlight java linenos %}
public void rebuildSelectors() {
    for (EventExecutor e: this) {
        ((NioEventLoop) e).rebuildSelector();
    }
}
// NioEventLoop#rebuildSelector
// 确保在工作线程自身线程中处理重建
public void rebuildSelector() {
    if (!inEventLoop()) {
        execute(new Runnable() {
            @Override
            public void run() {
                rebuildSelector0();
            }
        });
        return;
    }
    
    rebuildSelector0();
}
// NioEventLoop#rebuildSelector0
private void rebuildSelector0() {
    final Selector oldSelector = selector;
    final SelectorTuple newSelectorTuple;

    if (oldSelector == null) {
        return;
    }

    try {
        // 创建新的 Selector 实例
        newSelectorTuple = openSelector();
    } catch (Exception e) {
        // 创建失败返回
        logger.warn("Failed to create a new Selector.", e);
        return;
    }

    // 成功迁移数，日志用
    int nChannels = 0;
    // 注册所有 channel 到新的 Selector 上
    for (SelectionKey key: oldSelector.keys()) {
        Object a = key.attachment();
        try {
            if (!key.isValid() 
                || key.channel().keyFor(newSelectorTuple.unwrappedSelector) != null) {
                continue;
            }

            int interestOps = key.interestOps();
            key.cancel();
            // channel 注册新的 Selector
            SelectionKey newKey = key.channel().register(
                    newSelectorTuple.unwrappedSelector, interestOps, a);

            if (a instanceof AbstractNioChannel) {
                // Update SelectionKey
                ((AbstractNioChannel) a).selectionKey = newKey;
            }
            nChannels ++;
        } catch (Exception e) {
            logger.warn("Failed to re-register a Channel to the new Selector.", e);
            if (a instanceof AbstractNioChannel) {
                // channel 迁移失败，关闭之
                AbstractNioChannel ch = (AbstractNioChannel) a;
                ch.unsafe().close(ch.unsafe().voidPromise());
            } else {
                @SuppressWarnings("unchecked")
                NioTask<SelectableChannel> task = (NioTask<SelectableChannel>) a;
                invokeChannelUnregistered(task, key, e);
            }
        }
    }

    selector = newSelectorTuple.selector;
    unwrappedSelector = newSelectorTuple.unwrappedSelector;

    try {
        // 是时候关闭就的 Selector 了
        oldSelector.close();
    } catch (Throwable t) {
        if (logger.isWarnEnabled()) {
            logger.warn("Failed to close the old Selector.", t);
        }
    }

    if (logger.isInfoEnabled()) {
        logger.info("Migrated " + nChannels + " channel(s) to the new Selector.");
    }
}
{% endhighlight %}

------

## #awaitTermination

在指定时间`timeout`内等待*工作线程组*终止，并返回是否终止成功。如果在超时之前返回，一般说明终止成功。

{% highlight java linenos %}
public boolean awaitTermination(long timeout, TimeUnit unit)
        throws InterruptedException {
    // 截止时间
    long deadline = System.nanoTime() + unit.toNanos(timeout);
    // 一个个等啊
    loop: for (EventExecutor l: children) {
        for (;;) {
            // 剩余时间
            long timeLeft = deadline - System.nanoTime();
            if (timeLeft <= 0) {
                // 没有时间了，GG
                break loop;
            }
            if (l.awaitTermination(timeLeft, TimeUnit.NANOSECONDS)) {
                // 咱已终止了，下一个吧
                break;
            }
        }
    }
    return isTerminated();
}
{% endhighlight %}


