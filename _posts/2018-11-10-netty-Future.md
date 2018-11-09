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

Netty 里面所有的`io 操作`都是*异步执行*的。任何 io 调用都是立即返回的，也就是说在`io 调用`结束时，不保证 `io 操作`也执行结束。`io 调用`会返回代表`io 操作`的结果或状态信息的`ChannelFuture`。

`io 操作`一开始，就先创建一个`ChannelFuture`，这时它的状态是*未完成*：不是*成功*、*失败*或*已取消*，因为`io 操作`还没有结束。如果 io 操作已成功、失败、被取消而结束，`ChannelFuture`会被标记为*已完成*，还附带有其他更详细的结果信息，比如失败的原因。要注意，*失败*和*已取消*都属于*已完成*状态。
 
|未完成|成功|失败|已取消|
|:-------|:-------|:-------|:-------|
|isDone() = false <br/> isSuccess() = false <br/> isCancelled() = false <br/> cause() = null|isDone() = true <br/> isSuccess() = true| isDone() = true <br/> cause() = non-null | isDone() = true <br/> isCancelled() = true|

`ChannelFuture`对外提供多种不同的方法来检查 io 操作是否*已完成*，等待io 操作执行完成和获取执行结果。你也可以给`ChannelFuture`添加监听器`ChannelFutureListener`，在io执行完成时，你会接到通知。

推荐使用*监听器*的方式来获取结果通知，然后进行后续操作，而不是使用`#await`方法。因为`#addListener`是非阻塞执行的，一旦 io 操作执行完成，*工作线程*会通知与之相应的`ChannelFuture`的监听器。相反，`#await`方法是阻塞执行的，一旦被调用，调用线程就会被阻塞直到*io 操作*完成，而线程间通信是相对昂贵的，在特定的环境下，甚至还有可能导致*死锁*。

> 不要在`ChannelHandler`中调用`#await`。

{% highlight java linenos %}
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
@Override
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



{% highlight java linenos %}
{% endhighlight %}

{% highlight java linenos %}
{% endhighlight %}
{% highlight java linenos %}
{% endhighlight %}
{% highlight java linenos %}
{% endhighlight %}
{% highlight java linenos %}
{% endhighlight %}
{% highlight java linenos %}
{% endhighlight %}
{% highlight java linenos %}
{% endhighlight %}

