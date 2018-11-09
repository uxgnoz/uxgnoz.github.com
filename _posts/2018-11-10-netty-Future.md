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
 
|Uncompleted|Completed successfully|Completed with failure|Completed by cancellation|
|:-------|:-------|:-------|:-------|
|isDone() = false <br/> isSuccess() = false isCancelled() = false cause() = null|isDone() = true isSuccess() = true| isDone() = true cause() = non-null | isDone() = true  isCancelled() = true|



