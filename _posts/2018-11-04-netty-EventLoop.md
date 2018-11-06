---
title: Netty 之工作线程 NioEventLoop
layout: posts
---

# Netty 之工作线程 NioEventLoop

------

## 综述

从下面的 NioEventLoop 的继承树，很容易看出 Nio 的工作线程是单线程的。

{% highlight java linenos %}
SingleThreadEventExecutor
    <- SingleThreadEventLoop
    <- NioEventLoop
{% endhighlight %}

一个 channel 只会注册到一个*工作线程*，但一个*工作线程*会处理多个 channel。channel 向*工作线程*注册，实际上是注册到*工作线程*中的 selector 上，channel 实例作为附件存放在 key 里。

{% highlight java linenos %}
private Selector selector;
private Selector unwrappedSelector;
private SelectedSelectionKeySet selectedKeys;

private final SelectorProvider provider;
{% endhighlight %}

工作线程的 5 个状态。

* 未开始；
* 工作中；
* 关闭准备中；
* 已关闭；
* 已终止。

{% highlight java linenos %}
// 未开始
private static final int ST_NOT_STARTED = 1;
// 工作中
private static final int ST_STARTED = 2;
// 关闭准备中
private static final int ST_SHUTTING_DOWN = 3;
// 已关闭
private static final int ST_SHUTDOWN = 4;
// 已终止
private static final int ST_TERMINATED = 5;
{% endhighlight %}

------

## #execute

方法 #execute 向*工作线程*提交任务。

该方法在*工作线程*调用时，仅仅是向`taskQueue`中加入新的任务。

在*用户线程*调用时，如果*工作线程*还没开始，那么还需要负责启动*工作线程*。如果*工作线程*状态为`已关闭`，且还能够从`taskQueue`中移除前面刚提交的任务，那么抛出异常、拒绝任务。如果*工作线程*为`工作中`，且任务类型不是`NonWakeupRunnable`，那么还需要尝试唤醒它。

> 『尝试唤醒』是因为*工作线程*也许正在运行，不需要被唤醒；也许正被 select 挂起，需要被唤醒。

{% highlight java linenos %}
// in SingleThreadEventExecutor
// 任务队列
private final Queue<Runnable> taskQueue;

public void execute(Runnable task) {
    if (task == null) {
        throw new NullPointerException("task");
    }

    boolean inEventLoop = inEventLoop();
    // 向任务队列 taskQueue 中加入任务
    addTask(task);
    if (!inEventLoop) {
        // 如果任务是在用户线程中提交的，且工作线程还没有启动，启动之
        startThread();
        if (isShutdown() && removeTask(task)) {
            // 工作线程 已关闭，且从任务队列删除 task 成功，拒绝 task
            reject();
        }
    }

    // NioEventLoop 中 addTaskWakesUp 被初始化为 false
    if (!addTaskWakesUp && wakesUpForTask(task)) {
        wakeup(inEventLoop);
    }
}

// 往 taskQueue 中加入任务
protected void addTask(Runnable task) {
    if (task == null) {
        throw new NullPointerException("task");
    }
    if (!offerTask(task)) {
        // taskQueue 容量满，放不下了，拒绝任务
        reject(task);
    }
}

final boolean offerTask(Runnable task) {
    if (isShutdown()) {
        // 工作线程已关闭，抛出异常拒绝任务
        reject();
    }
    // 尝试在 taskQueue 中加入任务
    return taskQueue.offer(task);
}

public boolean isShutdown() {
    return state >= ST_SHUTDOWN;
}

// 删除传入的任务
protected boolean removeTask(Runnable task) {
    if (task == null) {
        throw new NullPointerException("task");
    }
    return taskQueue.remove(task);
}

// SingleThreadEventLoop#wakesUpForTask 覆盖了 SingleThreadEventExecutor 中的
protected boolean wakesUpForTask(Runnable task) {
    return !(task instanceof NonWakeupRunnable);
}
{% endhighlight %}

------

## #wakeup

NioEventLoop#wakeup 覆盖了 SingleThreadEventExecutor#wakeup，唤醒被`select`挂起的*工作线程*。只有在*用户线程*调用才*可能*起作用。

{% highlight java linenos %}
protected void wakeup(boolean inEventLoop) {
    // 如果当前执行在用户线程，
    // 修改 wakeUp 由 false 改为 true 成功，则当前或下一轮 select 立即返回
    if (!inEventLoop && wakenUp.compareAndSet(false, true)) {
        selector.wakeup();
    }
}
{% endhighlight %}

------

## #startThread

方法 #doStartThread 启动真正的工作线程，并调用 NioEventLoop#run 执行 Nio 处理流程。

{% highlight java linenos %}
private void startThread() {
    if (state == ST_NOT_STARTED) {
        if (STATE_UPDATER.compareAndSet(this, ST_NOT_STARTED, ST_STARTED)) {
            try {
                doStartThread();
            } catch (Throwable cause) {
                STATE_UPDATER.set(this, ST_NOT_STARTED);
                PlatformDependent.throwException(cause);
            }
        }
    }
}

private void doStartThread() {
    assert thread == null;
    // 开启工作线程
    executor.execute(new Runnable() {
        // 真正的工作线程执行流
        public void run() {
            // 缓存工作线程
            thread = Thread.currentThread();
            if (interrupted) {
                // 不懂哎，待搞
                thread.interrupt();
            }

            boolean success = false;
            // 更新最后执行时间
            updateLastExecutionTime();
            try {
                // Nio 执行流，无限 select，key 处理循环
                SingleThreadEventExecutor.this.run();
                success = true;
            } catch (Throwable t) {
                logger.warn("Unexpected exception from an event executor: ", t);
            } finally { // 执行流结束
                // 修改工作线程状态为 关闭准备中。这里会有 竞争 吗？
                for (;;) {
                    int oldState = state;
                    if (oldState >= ST_SHUTTING_DOWN 
                            || STATE_UPDATER.compareAndSet(
                                    SingleThreadEventExecutor.this, 
                                    oldState, ST_SHUTTING_DOWN)) {
                        break;
                    }
                }

                // Check if confirmShutdown() was called at the end of the loop.
                if (success && gracefulShutdownStartTime == 0) {
                    // 看看 confirmShutdown 在上面的 run 中有没有被调用，
                    // 没有的话记录一下，可能有 bug
                }

                try {
                    for (;;) {
                        // 反复调用 #confirmShutdown，跑完剩余的任务为止
                        if (confirmShutdown()) {
                            break;
                        }
                    }
                } finally {
                    try {
                        // 关闭 elector
                        cleanup();
                    } finally {
                        // 设置状态为 已终止
                        STATE_UPDATER.set(SingleThreadEventExecutor.this, ST_TERMINATED);
                        threadLock.release();
                        if (!taskQueue.isEmpty()) {
                            // just log
                        }

                        terminationFuture.setSuccess(null);
                    }
                }
            }
        }
    });
}
{% endhighlight %}

------

## #cleanup 

关闭`selector`。

{% highlight java linenos %}
protected void cleanup() {
    try {
        selector.close();
    } catch (IOException e) {
        logger.warn("Failed to close a selector.", e);
    }
}
{% endhighlight %}

------

## #run

NioEventLoop#run 总体执行流程：

1. 当前`taskQueue`和`tailTasks`中还有未执行任务，跳转到第 2步 ；否则，执行 select，检查有无关注的 io 事件；
2. 处理关注的所有发生的 io 事件；
3. 根据 ioRatio 执行队列中的任务；
4. 如果需要关闭工作线程，#closeAll 关闭所有通道；#confirmShutdown 执行队列中所有未完成任务；结束工作线程；
5. 否则，跳转到第 1 步。

{% highlight java linenos %}
// NioEventLoop#run
protected void run() {
    for (;;) {
        try {
            // 有任务执行时，直接走 default；否则 select
            switch (selectStrategy.calculateStrategy(selectNowSupplier, hasTasks())) {
                case SelectStrategy.CONTINUE:
                    continue;
                case SelectStrategy.BUSY_WAIT:
                    // fall-through to SELECT since the busy-wait is not supported with NIO
                case SelectStrategy.SELECT:
                    // 没有任务等待执行
                    select(wakenUp.getAndSet(false));

                    if (wakenUp.get()) {
                        selector.wakeup();
                    }
                    // fall through
                default:
            }

            cancelledKeys = 0;
            needsToSelectAgain = false;
            final int ioRatio = this.ioRatio;
            if (ioRatio == 100) {
                try {
                    processSelectedKeys();
                } finally {
                    // Ensure we always run tasks.
                    runAllTasks();
                }
            } else {
                final long ioStartTime = System.nanoTime();
                try {
                    processSelectedKeys();
                } finally {
                    // Ensure we always run tasks.
                    final long ioTime = System.nanoTime() - ioStartTime;
                    runAllTasks(ioTime * (100 - ioRatio) / ioRatio);
                }
            }
        } catch (Throwable t) {
            handleLoopException(t);
        }
        // Always handle shutdown even if the loop processing threw an exception.
        try {
            if (isShuttingDown()) {
                closeAll();
                // 如果剩余任务全部跑完，立即退出
                if (confirmShutdown()) {
                    return;
                }
            }
        } catch (Throwable t) {
            handleLoopException(t);
        }
    }
}

protected boolean hasTasks() {
    return super.hasTasks() || !tailTasks.isEmpty();
}
{% endhighlight %}

------

## #select

{% highlight java linenos %}
private void select(boolean oldWakenUp) throws IOException {
    Selector selector = this.selector;
    try {
        int selectCnt = 0;
        long currentTimeNanos = System.nanoTime();
        long selectDeadLineNanos = currentTimeNanos + delayNanos(currentTimeNanos);

        for (;;) {
            long timeoutMillis = (selectDeadLineNanos - currentTimeNanos + 500000L) / 1000000L;
            if (timeoutMillis <= 0) {
                if (selectCnt == 0) {
                    selector.selectNow();
                    selectCnt = 1;
                }
                break;
            }

            // If a task was submitted when wakenUp value was true, the task didn't get a chance to call
            // Selector#wakeup. So we need to check task queue again before executing select operation.
            // If we don't, the task might be pended until select operation was timed out.
            // It might be pended until idle timeout if IdleStateHandler existed in pipeline.
            if (hasTasks() && wakenUp.compareAndSet(false, true)) {
                selector.selectNow();
                selectCnt = 1;
                break;
            }

            int selectedKeys = selector.select(timeoutMillis);
            selectCnt ++;

            if (selectedKeys != 0 || oldWakenUp || wakenUp.get() || hasTasks() || hasScheduledTasks()) {
                // - Selected something,
                // - waken up by user, or
                // - the task queue has a pending task.
                // - a scheduled task is ready for processing
                break;
            }
            if (Thread.interrupted()) {
                // Thread was interrupted so reset selected keys and break so we not run into a busy loop.
                // As this is most likely a bug in the handler of the user or it's client library we will
                // also log it.
                //
                // See https://github.com/netty/netty/issues/2426
                if (logger.isDebugEnabled()) {
                    logger.debug("Selector.select() returned prematurely because " +
                            "Thread.currentThread().interrupt() was called. Use " +
                            "NioEventLoop.shutdownGracefully() to shutdown the NioEventLoop.");
                }
                selectCnt = 1;
                break;
            }

            long time = System.nanoTime();
            if (time - TimeUnit.MILLISECONDS.toNanos(timeoutMillis) >= currentTimeNanos) {
                // timeoutMillis elapsed without anything selected.
                selectCnt = 1;
            } else if (SELECTOR_AUTO_REBUILD_THRESHOLD > 0 &&
                    selectCnt >= SELECTOR_AUTO_REBUILD_THRESHOLD) {
                // The selector returned prematurely many times in a row.
                // Rebuild the selector to work around the problem.
                logger.warn(
                        "Selector.select() returned prematurely {} times in a row; rebuilding Selector {}.",
                        selectCnt, selector);

                rebuildSelector();
                selector = this.selector;

                // Select again to populate selectedKeys.
                selector.selectNow();
                selectCnt = 1;
                break;
            }

            currentTimeNanos = time;
        }

        if (selectCnt > MIN_PREMATURE_SELECTOR_RETURNS) {
            if (logger.isDebugEnabled()) {
                logger.debug("Selector.select() returned prematurely {} times in a row for Selector {}.",
                        selectCnt - 1, selector);
            }
        }
    } catch (CancelledKeyException e) {
        if (logger.isDebugEnabled()) {
            logger.debug(CancelledKeyException.class.getSimpleName() + " raised by a Selector {} - JDK bug?",
                    selector, e);
        }
        // Harmless exception - log anyway
    }
}
{% endhighlight %}

------

## #processSelectedKeys

下面的代码处理关注的所有发生的 io 事件。#processSelectedKeysPlain 依次处理所有 selectedKeys。

在遍历的过程当中，每取消 CLEANUP_INTERVAL 个 key，需要执行一次 #selectAgain。

{% highlight java linenos %}
private void processSelectedKeys() {
    if (selectedKeys != null) {
        // 优化过的
        processSelectedKeysOptimized();
    } else {
        // 原生
        processSelectedKeysPlain(selector.selectedKeys());
    }
}

// 原生 Selector
private void processSelectedKeysPlain(Set<SelectionKey> selectedKeys) {
    if (selectedKeys.isEmpty()) {
        return;
    }

    Iterator<SelectionKey> i = selectedKeys.iterator();
    for (;;) {
        final SelectionKey k = i.next();
        final Object a = k.attachment();
        i.remove();

        if (a instanceof AbstractNioChannel) {
            processSelectedKey(k, (AbstractNioChannel) a);
        } else {
            @SuppressWarnings("unchecked")
            NioTask<SelectableChannel> task = (NioTask<SelectableChannel>) a;
            processSelectedKey(k, task);
        }

        if (!i.hasNext()) {
            break;
        }

        if (needsToSelectAgain) {
            // 重新 select 之后，需要重新获取遍历的 Iterator
            selectAgain();
            selectedKeys = selector.selectedKeys();

            // Create the iterator again to avoid ConcurrentModificationException
            if (selectedKeys.isEmpty()) {
                break;
            } else {
                i = selectedKeys.iterator();
            }
        }
    }
}
{% endhighlight %}

------

## #processSelectedKey

* 如果 key 不合法性，关闭属于自己的 channel，忽略不属于自己的 channel，并返回；
* 如果 channel 上有 OP_CONNECT 事件，取消*连接关注*，并调用 Unsafe#finishConnect 结束连接过程；
* 如果 channel 上有 OP_WRITE 事件，调用 Unsafe#forceFlush 直接写出出站缓冲区 *flush 区间*剩余数据；
* 如果 channel 上有 OP_READ 或 OP_ACCEPT，调用 Unsafe#read，发起读操作。

> 方法 Unsafe#forceFlush 相比 Unsafe#flush，不需要调用 ChannelOutboundBuffer#addFlush 去标记 *flush 区间*。

{% highlight java linenos %}
private void processSelectedKey(SelectionKey k, AbstractNioChannel ch) {
    final AbstractNioChannel.NioUnsafe unsafe = ch.unsafe();
    if (!k.isValid()) { // key 非法
        final EventLoop eventLoop;
        try {
            eventLoop = ch.eventLoop();
        } catch (Throwable ignored) {
            return;
        }

        if (eventLoop != this || eventLoop == null) {
            return;
        }
        // 关闭属于自己的 channel
        unsafe.close(unsafe.voidPromise());
        return;
    }

    try {
        int readyOps = k.readyOps();
  
        // 发起连接的客户端才有该事件
        if ((readyOps & SelectionKey.OP_CONNECT) != 0) {
            int ops = k.interestOps();
            // 取消关注，否则无限有它
            ops &= ~SelectionKey.OP_CONNECT;
            k.interestOps(ops);
            // 结束连接过程
            unsafe.finishConnect();
        }

        // 优先处理 写事件，可能也许大概可以清理部分内存
        if ((readyOps & SelectionKey.OP_WRITE) != 0) {
            // 数据刷完之后，会取消 写关注的
            ch.unsafe().forceFlush();
        }

        // Also check for readOps of 0 to workaround possible JDK bug 
        // which may otherwise lead to a spin loop
        if ((readyOps & (SelectionKey.OP_READ | SelectionKey.OP_ACCEPT)) != 0 
                || readyOps == 0) {
            // 发起读操作，可能是处理数据读取，可能是处理客户端连接
            unsafe.read();
        }
    } catch (CancelledKeyException ignored) {
        // 关闭之
        unsafe.close(unsafe.voidPromise());
    }
}
{% endhighlight %}

------

## #closeAll

{% highlight java linenos %}
   private void closeAll() {
        // 为啥要 selectAgain？
        selectAgain();
        Set<SelectionKey> keys = selector.keys();
        Collection<AbstractNioChannel> channels = 
                new ArrayList<AbstractNioChannel>(keys.size());

        for (SelectionKey k: keys) {
            Object a = k.attachment();
            if (a instanceof AbstractNioChannel) {
                channels.add((AbstractNioChannel) a);
            } else {
                k.cancel();
                @SuppressWarnings("unchecked")
                NioTask<SelectableChannel> task = (NioTask<SelectableChannel>) a;
                invokeChannelUnregistered(task, k, null);
            }
        }

        // 关闭所有 channel
        for (AbstractNioChannel ch: channels) {
            ch.unsafe().close(ch.unsafe().voidPromise());
        }
    }
{% endhighlight %}

## #confirmShutdown

* 确认当初所处的状态；
* 确保只能在工作线程中调用；
* 取消所有`scheduledTaskQueue`中的任务；
* 

{% highlight java linenos %}
protected boolean confirmShutdown() {
    if (!isShuttingDown()) {
        // 当前不处于 关闭中
        return false;
    }

    // 确保只能在工作线程中调用
    if (!inEventLoop()) {
        throw new IllegalStateException("must be invoked from an event loop");
    }

    // 取消所有定时任务
    cancelScheduledTasks();

    if (gracefulShutdownStartTime == 0) {
        gracefulShutdownStartTime = ScheduledFutureTask.nanoTime();
    }

    if (runAllTasks() || runShutdownHooks()) {
        if (isShutdown()) {
            // Executor shut down - no new tasks anymore.
            return true;
        }

        // 如果静默期为 0，直接返回 TRUE；否则唤醒 selector
        if (gracefulShutdownQuietPeriod == 0) {
            // 大概可以关闭了
            return true;
        }

        // 唤醒 selector
        wakeup(true);

        // 还处于 关闭准备中
        return false;
    }

    // 到这里，说明当前没有任务和 hook 需要执行

    final long nanoTime = ScheduledFutureTask.nanoTime();
    // 已经关闭或关闭超时，返回 TRUE
    if (isShutdown() || nanoTime - gracefulShutdownStartTime > gracefulShutdownTimeout) {
        // 大概可以关闭了
        return true;
    }

    // 静默有效期
    if (nanoTime - lastExecutionTime <= gracefulShutdownQuietPeriod) {
        // Check if any tasks were added to the queue every 100ms.
        // 唤醒 selector
        wakeup(true);
        try {
            Thread.sleep(100);
        } catch (InterruptedException e) {
            // Ignore
        }
        // 还处于 关闭准备中
        return false;
    }

    // 静默期没有任务加入，大概可以关闭了
    return true;
}

protected void cancelScheduledTasks() {
    assert inEventLoop();
    PriorityQueue<ScheduledFutureTask<?>> scheduledTaskQueue = this.scheduledTaskQueue;
    if (isNullOrEmpty(scheduledTaskQueue)) {
        return;
    }

    final ScheduledFutureTask<?>[] scheduledTasks =
            scheduledTaskQueue.toArray(new ScheduledFutureTask<?>[0]);

    for (ScheduledFutureTask<?> task: scheduledTasks) {
        task.cancelWithoutRemove(false);
    }
    // 清空队列
    scheduledTaskQueue.clearIgnoringIndexes();
}

// 至少执行一个 hook 发回 TRUE，否则 FALSE
private boolean runShutdownHooks() {
    boolean ran = false;
    // Note shutdown hooks can add / remove shutdown hooks.
    while (!shutdownHooks.isEmpty()) {
        List<Runnable> copy = new ArrayList<Runnable>(shutdownHooks);
        shutdownHooks.clear();
        for (Runnable task: copy) {
            try {
                task.run();
            } catch (Throwable t) {
                logger.warn("Shutdown hook raised an exception.", t);
            } finally {
                ran = true;
            }
        }
    }

    if (ran) {
        lastExecutionTime = ScheduledFutureTask.nanoTime();
    }

    return ran;
}

public boolean isShuttingDown() {
    return state >= ST_SHUTTING_DOWN;
}
{% endhighlight %}

------

## #runAllTasks

执行`taskQueue`所有的任务，和`scheduledTaskQueue` 中到当前为止可以安排运行的任务。

返回值：

* true，至少有执行了一个任务；
* false，没有任务需要执行。

{% highlight java linenos %}
protected boolean runAllTasks() {
    assert inEventLoop();
    boolean fetchedAll;
    boolean ranAtLeastOne = false;

    do {
        fetchedAll = fetchFromScheduledTaskQueue();
        if (runAllTasksFrom(taskQueue)) {
            ranAtLeastOne = true;
        }
    } // 当前能安排执行的任务都要执行结束
    while (!fetchedAll); 

    if (ranAtLeastOne) {
        lastExecutionTime = ScheduledFutureTask.nanoTime();
    }
    afterRunningAllTasks();
    return ranAtLeastOne;
}

// 从 scheduledTaskQueue 中摘取可安排执行的任务到 taskQueue
private boolean fetchFromScheduledTaskQueue() {
    long nanoTime = AbstractScheduledEventExecutor.nanoTime();
    Runnable scheduledTask  = pollScheduledTask(nanoTime);
    while (scheduledTask != null) {
        if (!taskQueue.offer(scheduledTask)) {
            // taskQueue 容量不够，任务放回 scheduledTaskQueue
            scheduledTaskQueue().add((ScheduledFutureTask<?>) scheduledTask);
            // 返回 FALSE 说明还有可安排执行的任务没有放入 taskQueue
            return false;
        }
        scheduledTask  = pollScheduledTask(nanoTime);
    }
    // 可安排执行的任务已全部放入 taskQueue
    return true;
}
{% endhighlight %}

------

## #pollScheduledTask

取`scheduledTaskQueue`队首且可以安排执行的任务，没有返回`null`。

{% highlight java linenos %}
protected final Runnable pollScheduledTask(long nanoTime) {
    assert inEventLoop();

    Queue<ScheduledFutureTask<?>> scheduledTaskQueue = this.scheduledTaskQueue;
    ScheduledFutureTask<?> scheduledTask = 
            scheduledTaskQueue == null ? null : scheduledTaskQueue.peek();
    if (scheduledTask == null) {
        return null;
    }
    // 是否可以安排执行
    if (scheduledTask.deadlineNanos() <= nanoTime) {
        scheduledTaskQueue.remove();
        return scheduledTask;
    }
    // 还未到执行时间
    return null;
}
{% endhighlight %}

------

## #runAllTasksFrom

依次执行传入参数 taskQueue 中所有任务。

{% highlight java linenos %}
protected final boolean runAllTasksFrom(Queue<Runnable> taskQueue) {
    Runnable task = pollTaskFrom(taskQueue);
    if (task == null) {
        return false;
    }
    for (;;) {
        safeExecute(task);
        task = pollTaskFrom(taskQueue);
        if (task == null) {
            return true;
        }
    }
}

protected static Runnable pollTaskFrom(Queue<Runnable> taskQueue) {
    for (;;) {
        Runnable task = taskQueue.poll();
        if (task == WAKEUP_TASK) {
            // 排除唤醒用的空任务
            continue;
        }
        return task;
    }
}

protected static void safeExecute(Runnable task) {
    try {
        task.run();
    } catch (Throwable t) {
        logger.warn("A task raised an exception. Task: {}", task, t);
    }
}
{% endhighlight %}
{% highlight java linenos %}
{% endhighlight %}
{% highlight java linenos %}
{% endhighlight %}