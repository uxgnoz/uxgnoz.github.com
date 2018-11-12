---
title: Netty 之工作线程 ThreadPerChannelEventLoop
layout: posts
---

# Netty 之工作线程 ThreadPerChannelEventLoop

------

## 综述

在 Netty 中，`ThreadPerChannelEventLoop`是`Oio`使用的*工作线程*。从`ThreadPerChannelEventLoop`的继承树（不含接口），很容易看出，与[Nio 工作线程](/netty-NioEventLoop/)类似，`Oio`的*工作线程*也是单线程的。

{% highlight java linenos %}
SingleThreadEventExecutor
<- SingleThreadEventLoop
<- ThreadPerChannelEventLoop
{% endhighlight %}

与`Nio`不同的是，`Oio`中 channel 和*工作线程*是一对一的关系。

------

## #register

channel 注册*工作线程*。

{% highlight java linenos %}
// ThreadPerChannelEventLoop#register
private Channel ch;
public ChannelFuture register(ChannelPromise promise) {
    // 调用父类方法 SingleThreadEventLoop#register 注册通道
    return super.register(promise).addListener(new ChannelFutureListener() {
        @Override
        public void operationComplete(ChannelFuture future) throws Exception {
            if (future.isSuccess()) {
                //  关联注册成功的 channel
                ch = future.channel();
            } else {
                // 撤销
                deregister();
            }
        }
    });
}
// SingleThreadEventLoop#register
public ChannelFuture register(final ChannelPromise promise) {
    ObjectUtil.checkNotNull(promise, "promise");
    // 调用 Unsafe#register 完成注册
    promise.channel().unsafe().register(this, promise);
    return promise;
}
{% endhighlight %}

方法`Unsafe#register` 参考：[Netty 之通道 AbstractChannel](/netty-AbstractChannel/#register)。

------

## #deregister

撤销 channel。

{% highlight java linenos %}
protected void deregister() {
    // channel 字段置空
    ch = null;
    parent.activeChildren.remove(this);
    parent.idleChildren.add(this);
}
{% endhighlight %}

------

## #takeTask

从队列`scheduledQueue`或`taskQueue`中拿出一个任务。

流程：

1. 先看看有没有定时任务，如果没有转 2，如果有转 3；
2. 从普通任务队列中阻塞式拿任务并返回，忽略唤醒任务，返回结果可能会是 null；
3. 看看定时任务还有多长时间才能执行，我们用这个时间去普通任务队列中拿任务，拿到了就返回这个任务；
4. 拿不到时，定时任务也到了执行的时候了，把定时任务队列中当前可以执行的任务移动到普通任务队列中来；
5. 从普通任务队列中拿出一个并返回。

{% highlight java linenos %}
// SingleThreadEventExecutor#takeTask
protected Runnable takeTask() {
    // 确保在工作线程中执行
    assert inEventLoop();
    // taskQueue 类型限定 BlockingQueue
    if (!(taskQueue instanceof BlockingQueue)) {
        throw new UnsupportedOperationException();
    }

    BlockingQueue<Runnable> taskQueue = (BlockingQueue<Runnable>) this.taskQueue;
    for (;;) {
        // 看看有没有定时任务
        ScheduledFutureTask<?> scheduledTask = peekScheduledTask();
        // 没有定时任务
        if (scheduledTask == null) {
            Runnable task = null;
            try {
                // 从 taskQueue 中阻塞获取一个任务
                task = taskQueue.take();
                if (task == WAKEUP_TASK) {
                    // 忽略唤醒任务
                    task = null;
                }
            } catch (InterruptedException e) {
                // 被中断，忽略之
            }
            // 返回任务，可能为 null
            return task;
        } 
        // 有定时任务
        else {
            // 定时任务延期执行时长
            long delayNanos = scheduledTask.delayNanos();
            Runnable task = null;
            // 延期执行时长还有呢
            if (delayNanos > 0) {
                try {
                    // 我们用 delayNanos 这么长的时间去 taskQueue 中阻塞式拿任务
                    task = taskQueue.poll(delayNanos, TimeUnit.NANOSECONDS);
                } catch (InterruptedException e) {
                    // 被提前中断，返回 null
                    return null;
                }
            }
            // delayNanos 过去了，taskQueue 依然没有任务
            if (task == null) {
                // 把定时任务队列 scheduledTaskQueue 中当前可以执行的任务移到 taskQueue 中来
                fetchFromScheduledTaskQueue();
                // 这时候 taskQueue 中肯定有任务了，拿出一个来吧
                task = taskQueue.poll();
            }

            if (task != null) {
                // 不是 null 就你了
                return task;
            }
        }
    }
}
{% endhighlight %}

------

## #run

单线程的*工作线程*执行流。流程：

1. 获取一个任务，普通任务或定时任务；
2. 运行之；
3. 更新最后运行时间；
4. 看看*工作线程*的状态是不是`关闭准备中`，如果是转 5，否则转 7；
5. 关闭通道
6. 确认*工作线程*是否可以关闭，TRUE 就**退出循环**；否则转 1，继续下一轮；
7. 看看是否有关联的 channel，如果有转 8，否则转 1，继续下一轮；
8. 如果 channel 处于未注册状态，转9，否则转 1，继续下一轮； 
9. 执行当前能执行的所有任务；
10. 取消*工作线程*和 channel 的关联。

channel 的状态可能由于调用`Unsafe#deregister`方法，注销了*工作线程*而处于未注册状态。

{% highlight java linenos %}
// ThreadPerChannelEventLoop#run
protected void run() {
    for (;;) {
        // 获取一个任务，普通任务或定时任务
        Runnable task = takeTask();
        if (task != null) {
            // 运行之
            task.run();
            //更新最后运行时间
            updateLastExecutionTime();
        }

        Channel ch = this.ch;
        if (isShuttingDown()) { // 工作线程 `关闭准备中`
            if (ch != null) {
                // 关闭通道
                ch.unsafe().close(ch.unsafe().voidPromise());
            }
            if (confirmShutdown()) {
                break;
            }
        } else {
            if (ch != null) {
                // Handle deregistration
                if (!ch.isRegistered()) {
                    // 执行taskQueue所有的任务，
                    // 并执行 scheduledTaskQueue 中到当前为止可以安排运行的任务。
                    runAllTasks();
                    deregister();
                }
            }
        }
    }
}
{% endhighlight %}


方法`Unsafe#deregister` 参考：[Netty 之通道 AbstractChannel](/netty-AbstractChannel/#deregister)。

方法`#confirmShutdown`和`#runAllTasks`参考[Netty 之工作线程 NioEventLoop](/netty-NioEventLoop/)。
