---
title: Netty 之异步执行结果 DefaultChannelPromise
layout: posts
---

# Netty 之异步执行结果 DefaultChannelPromise

------

## 综述

`DefaultChannelPromise`实现了`ChannelFuture`和`ChannelPromise`。

### ChannelFuture

`ChannelFuture`是`Channel`异步执行 io 操作的结果。

Netty 里面所有的`io 操作`都是*异步执行*的。任何 io 调用都是立即返回的，也就是说在`io 调用`结束时，不保证 `io 操作`也执行结束。`io 调用`会返回代表`io 操作`结果或状态信息的`ChannelFuture`。

`io 操作`一开始，就先创建一个`ChannelFuture`，此时它的状态是*未完成*：不是*成功*、*失败*或*已取消*，因为`io 操作`还没有结束。如果 io 操作因执行成功、失败、被取消而结束，`ChannelFuture`会被标记为*已完成*，还附带有其他更详细的结果信息，比如失败的原因。要注意的是，*失败*和*已取消*也都属于*已完成*状态。
 
|未完成|成功|失败|已取消|
|:-------|:-------|:-------|:-------|
|isDone() = false <br/> isSuccess() = false <br/> isCancelled() = false <br/> cause() = null|isDone() = true <br/> isSuccess() = true| isDone() = true <br/> cause() = non-null | isDone() = true <br/> isCancelled() = true|

`ChannelFuture`对外提供多种不同的方法来检查`io 操作`是否*已完成*，等待io 操作执行完成和获取执行结果。你也可以给`ChannelFuture`添加监听器`ChannelFutureListener`，在io执行完成时，你会接到通知。

推荐使用*监听器*的方式来获取结果通知，然后进行后续操作，而不是使用`#await`方法。因为`#addListener`是非阻塞执行的，一旦`io 操作`执行完成，*工作线程*会通知与之相应的`ChannelFuture`的监听器。相反，`#await`方法是阻塞执行的，一旦被调用，调用线程就会被阻塞直到*io 操作*完成，而线程间通信是相对昂贵的，在特定的环境下，甚至还有可能导致*死锁*。

> 不要在`ChannelHandler`中调用`#await`。

下面列出了`ChannelHandler`中一些重要的方法。

{% highlight java linenos %}
// 返回执行 io 操作的 channel
Channel channel();
// io 操作 成功完成返回 TRUE
boolean isSuccess();
// 当且仅当 io 操作 可以被方法 #cancel取消的时候，返回 TRUE
boolean isCancellable();
// 返回 io 操作失败的原因，null 说明状态为 成功 或 未完成
Throwable cause();
// 添加监听器。io 操作完成时会收到通知。如果 io 操作 在添加时已经完成，监听器会立即收到通知。
Future<V> addListener(GenericFutureListener<? extends Future<? super V>> listener);
// 删除首次找到的相同监听器，删除后不会收到通知。
// 如果要删除的监听器不属于该 ChannelFuture，该方法啥也不做，默默返回。
Future<V> removeListener(GenericFutureListener<? extends Future<? super V>> listener);
// 等待 io 操作执行完成，如果执行失败，重新抛出失败异常
Future<V> sync() throws InterruptedException;
// 等待 io 操作执行完成，如果执行失败，重新抛出失败异常。
// 不响应中断操作。
Future<V> syncUninterruptibly();
// 等待 io 操作执行完成
Future<V> await() throws InterruptedException;
// 等待 io 操作执行完成
// 不响应中断
Future<V> awaitUninterruptibly();
// 在指定时间内等待 io 操作执行完成
// 当且仅当 io 操作在指定时间内完成，返回 TRUE
boolean await(long timeout, TimeUnit unit) throws InterruptedException;
// 在指定时间内等待 io 操作执行完成
// 当且仅当 io 操作在指定时间内完成，返回 TRUE
// 不响应中断
boolean awaitUninterruptibly(long timeout, TimeUnit unit);
// 获取当前执行结果，如果未完成，返回 null    
V getNow();
// 取消 io 操作，参数 mayInterruptIfRunning 指定是否中断 io 操作线程
boolean cancel(boolean mayInterruptIfRunning);
{% endhighlight %}

### ChannelPromise

`ChannelPromise`是可写的`ChannelFuture`。多了一些修改结果的方法。

{% highlight java linenos %}
ChannelPromise setSuccess(Void result);
ChannelPromise setSuccess();
boolean trySuccess();
ChannelPromise setFailure(Throwable cause);
boolean tryFailure(Throwable cause);
boolean setUncancellable();
{% endhighlight %}

## #notifyListeners

在*工作线程*或*全局线程*中给所有**当前存在**的和**在执行通知过程中新添加**的*监听器*发送任务完成通知。通知是单次的，因为收到通知的监听器会从监听列表中移除，重复加入另当别论。

> 在绝大部分情况下，通知是在*工作线程*处理的。

{% highlight java linenos %}
private void notifyListeners() {
    EventExecutor executor = executor();
    // 直接在工作线程中 『同步处理』
    if (executor.inEventLoop()) {
        final InternalThreadLocalMap threadLocals = InternalThreadLocalMap.get();
        final int stackDepth = threadLocals.futureListenerStackDepth();
        // 主动防御 StackOverflowError
        if (stackDepth < MAX_LISTENER_STACK_DEPTH) {
            // 开始通知前，stack 深度递增
            threadLocals.setFutureListenerStackDepth(stackDepth + 1);
            try {
                notifyListenersNow();
            } 
            finally {
                // 通知结束后，stack 深度恢复
                threadLocals.setFutureListenerStackDepth(stackDepth);
            }

            return;
        }
    }
    // 当前执行在用户线程，向工作线程提交任务，『异步处理』
    safeExecute(executor, new Runnable() {
        @Override
        public void run() {
            notifyListenersNow();
        }
    });
}

protected EventExecutor executor() {
    // 全局线程？
    EventExecutor e = super.executor();
    if (e == null) {
        // 工作线程
        return channel().eventLoop();
    } else {
        return e;
    }
}

private void notifyListenersNow() {
    // 单次循环要处理的监听器
    Object listeners;

    synchronized (this) {
        // 有通知在进行时，防止二次并发进入执行
        if (notifyingListeners || this.listeners == null) {
            return;
        }
        // 标记通知状态为『进行中』，防止二次进入
        notifyingListeners = true;
        listeners = this.listeners;
        // 实例变量 listeners 置空
        this.listeners = null;
    }

    for (;;) {
        if (listeners instanceof DefaultFutureListeners) {
            // 处理批量监听器
            notifyListeners0((DefaultFutureListeners) listeners);
        } 
        else {
            // 处理单个监听器
            notifyListener0(this, (GenericFutureListener<?>) listeners);
        }

        synchronized (this) {
            if (this.listeners == null) {   // 没有新的监听器加入，结束通知
                // 重置通知状态
                notifyingListeners = false;
                // 结束通知
                return;
            }
            // 说明上面执行通知的过程中有新的监听器加入，继续下轮处理
            listeners = this.listeners;
            // 实例变量 listeners 置空
            this.listeners = null;
        }
    }
}
// 处理批量监听器
private void notifyListeners0(DefaultFutureListeners listeners) {
    GenericFutureListener<?>[] a = listeners.listeners();
    int size = listeners.size();
    // 依次通知监听器
    for (int i = 0; i < size; i ++) {
        notifyListener0(this, a[i]);
    }
}
// 给监听器发送任务完成通知
private static void notifyListener0(Future future, GenericFutureListener l) {
    try {
        l.operationComplete(future);
    } catch (Throwable t) {
        // just log warning
    }
}
{% endhighlight %}

## #addListener

添加新的监听器并检查任务状态。如果此时任务*已完成*，立刻调用`#notifyListeners`发出通知。

当监听器只有一个的时候，字段`listeners`就是监听器本身；当有多于一个监听器时，`listeners`为`DefaultFutureListeners`实例。在`DefaultFutureListeners`中，监听器以数组的方式，按添加的先后次序存放。

{% highlight java linenos %}
public Promise<V> addListener(
        GenericFutureListener<? extends Future<? super V>> listener) {
    checkNotNull(listener, "listener");

    synchronized (this) {
        addListener0(listener);
    }
    // 如果任务已经完成，通知监听器
    if (isDone()) {
        notifyListeners();
    }

    return this;
}

// 按需添加监听器容器
private void addListener0(
        GenericFutureListener<? extends Future<? super V>> listener) {
    if (listeners == null) {
        listeners = listener;
    } else if (listeners instanceof DefaultFutureListeners) {
        ((DefaultFutureListeners) listeners).add(listener);
    } else {
        listeners = 
                new DefaultFutureListeners((GenericFutureListener<?>) listeners, listener);
    }
}
{% endhighlight %}

## #await

同步等待`io 操作`执行结束。如果在*工作线程*中调用本方法，会抛出异常`BlockingOperationException`。等待的过程中，如果接到中断请求，本方法会抛出`InterruptedException`。

同时调用本方法的上限是`Short.MAX_VALUE`，超出限制会抛出异常`IllegalStateException`。

{% highlight java linenos %}
public Promise<V> await() throws InterruptedException {
    // 已经完成，直接返回
    if (isDone()) {
        return this;
    }
    // 如果当前线程被请求过中断，抛出 InterruptedException 响应之
    if (Thread.interrupted()) {
        throw new InterruptedException(toString());
    }
    // 死锁检测，防止在工作线程中调用本方法
    checkDeadLock();
    // Object#wait 标准用法
    synchronized (this) {
        while (!isDone()) {
            // 自增等待者 ++waiters
            incWaiters();
            try {
                // 等待并释放锁，让别人也进来等，嘿嘿
                wait();
            } finally {
                // --waiters
                decWaiters();
            }
        }
    }
    return this;
}

private void incWaiters() {
    if (waiters == Short.MAX_VALUE) {
        throw new IllegalStateException("too many waiters: " + this);
    }
    ++waiters;
}

private void decWaiters() {
    --waiters;
}

protected void checkDeadLock() {
    EventExecutor e = executor();
    if (e != null && e.inEventLoop()) {
        throw new BlockingOperationException(toString());
    }
}
{% endhighlight %}

## #awaitUninterruptibly

同步等待`io 操作`执行结束。如果在*工作线程*中调用本方法，会抛出异常`BlockingOperationException`。本方法忽视等待过程中接到的中断请求，并在等待结束时设置*线程中断标志*。

同时调用本方法的上限是`Short.MAX_VALUE`，超出限制会抛出异常`IllegalStateException`。

{% highlight java linenos %}
public Promise<V> awaitUninterruptibly() {
    // 已经完成，直接返回
    if (isDone()) {
        return this;
    }
    // 死锁检测，防止在工作线程中调用本方法
    checkDeadLock();
    // 是否收到中断请求标志
    boolean interrupted = false;
    // Object#wait 标准用法
    synchronized (this) {
        while (!isDone()) {
            // 自增等待者 ++waiters
            incWaiters();
            try {
                // 等待并释放锁，让别人也进来等，嘿嘿
                wait();
            } catch (InterruptedException e) {
                // 忽视终端请求
                interrupted = true;
            } finally {
                //  --waiters
                decWaiters();
            }
        }
    }

    if (interrupted) {
        // 设置*线程中断标志*
        Thread.currentThread().interrupt();
    }

    return this;
}
{% endhighlight %}

## #await(long timeout, TimeUnit unit)

在指定的时间`timeout`内同步等待`io 操作`执行。返回结果为`TRUE`如果任务*已完成*，否则`FALSE`。

如果在*工作线程*中调用本方法，会抛出异常`BlockingOperationException`。等待的过程中，如果接到中断请求，本方法会抛出`InterruptedException`。

同时调用本方法的上限是`Short.MAX_VALUE`，超出限制会抛出异常`IllegalStateException`。

{% highlight java linenos %}
public boolean await(long timeout, TimeUnit unit) 
        throws InterruptedException {
    return await0(unit.toNanos(timeout), true);
}

private boolean await0(long timeoutNanos, boolean interruptable) 
        throws InterruptedException {
    // 已经完成，直接返回
    if (isDone()) {
        return true;
    }
    // 超时时间无意义，直接返回当前结果
    if (timeoutNanos <= 0) {
        return isDone();
    }
    // 如果当前线程被请求过中断且允许中断，抛出 InterruptedException 响应之
    if (interruptable && Thread.interrupted()) {
        throw new InterruptedException(toString());
    }
    // 死锁检测，防止在工作线程中调用本方法
    checkDeadLock();
    // 开始事件
    long startTime = System.nanoTime();
    // 等待时间
    long waitTime = timeoutNanos;
    // 是否收到中断请求标志
    boolean interrupted = false;
    try {
        for (;;) {
            synchronized (this) {
                // 已经完成，直接返回
                if (isDone()) {
                    return true;
                }
                // 自增等待者 ++waiters
                incWaiters();
                try {
                    // 尝试等待 waitTime 时间
                    wait(waitTime / 1000000, (int) (waitTime % 1000000));
                } catch (InterruptedException e) {
                    if (interruptable) {
                        // 可中断，往上抛出 InterruptedException
                        throw e;
                    } else {
                        // 设置收到过中断请求
                        interrupted = true;
                    }
                } finally {
                    // --waiters
                    decWaiters();
                }
            }
            // 已经完成，直接返回
            if (isDone()) {
                return true;
            } else {
                // #wait 被各种原因打断，计算剩余等待时间
                waitTime = timeoutNanos - (System.nanoTime() - startTime);
                if (waitTime <= 0) {
                    // 等待时间用完，返回
                    return isDone();
                }
            }
        }
    } finally {
        if (interrupted) {
            // 设置*线程中断标志*
            Thread.currentThread().interrupt();
        }
    }
}
{% endhighlight %}

## #get

阻塞获取`io 操作`结果。调用`#await`方法直到任务完成，成功则返回结果，否则抛出失败异常`ExecutionException`或*已取消*异常`CancellationException`。

{% highlight java linenos %}
public V get() throws InterruptedException, ExecutionException {
    // 等待知道任务完成或被打断
    await();

    Throwable cause = cause();
    if (cause == null) {
        return getNow();
    }
    // 已取消
    if (cause instanceof CancellationException) {
        throw (CancellationException) cause;
    }
    // 执行失败
    throw new ExecutionException(cause);
}
{% endhighlight %}

## #sync

阻塞等待`io 操作`执行完成。调用`#await`方法直到任务完成，如果*已取消*或*失败*则抛出异常。

> 这里的抛出的异常绕过了`Java`编译器的检测，因此也会抛出*检查型异常*，虽然方法声明里面没有。

{% highlight java linenos %}
public Promise<V> sync() throws InterruptedException {
    // 等待知道任务完成或被打断
    await();
    rethrowIfFailed();
    return this;
}

private void rethrowIfFailed() {
    Throwable cause = cause();
    if (cause == null) {
        return;
    }
    // *已取消*或*失败*则抛出异常
    PlatformDependent.throwException(cause);
}
{% endhighlight %}

## #setSuccess

尝试设置`io 操作`执行结果。设置成功，则通知监听器任务完成。如果任务*已完成*，则设置失败，抛出异常`IllegalStateException`。

{% highlight java linenos %}
public Promise<V> setSuccess(V result) {
    if (setSuccess0(result)) {
        // 通知监听器
        notifyListeners();
        return this;
    }
    // 任务早已完成，抛出异常
    throw new IllegalStateException("complete already: " + this);
}

private boolean setSuccess0(V result) {
    return setValue0(result == null ? SUCCESS : result);
}

private boolean setValue0(Object objResult) {
    // 此时 result 的值只能是 null 或者是 UNCANCELLABLE
    // 否则不能修改
    if (RESULT_UPDATER.compareAndSet(this, null, objResult) ||
            RESULT_UPDATER.compareAndSet(this, UNCANCELLABLE, objResult)) {
        // 通知所有等待者结束等待
        checkNotifyWaiters();
        return true;
    }
    return false;
}

private synchronized void checkNotifyWaiters() {
    if (waiters > 0) {
        // 唤醒所有由当前 Future 实例中的 #await 类方法阻塞的线程
        notifyAll();
    }
}
{% endhighlight %}

## #trySuccess

尝试设置`io 操作`执行结果，设置成功则通知监听器任务完成并返回`TRUE`；设置失败则默默返回`FALSE`。

{% highlight java linenos %}
public boolean trySuccess(V result) {
    if (setSuccess0(result)) {
        notifyListeners();
        return true;
    }
    return false;
}
{% endhighlight %}