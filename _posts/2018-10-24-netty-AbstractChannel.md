---
title: Netty 之通道 AbstractChannel
layout: posts
---

# Netty 之通道 AbstractChannel

------

## AbstractChannel

AbstractChannel 是接口 Channel 的抽象实现类。每个 Channel 都会有一个实 Unsafe 实例，它负责执行具体的 IO 操作。

在创建一个 Channel 的时候，必须要初始化它的 ChannelId、Unsafe 实例和 ChannelPipeline。 

> * AbstractChannel#newUnsafe 为抽象方法，留给具体的子类去实现。
> * parent 的值可以为 null。

{% highlight java linenos%}
protected AbstractChannel(Channel parent) {
    this.parent = parent;
    id = newId();
    unsafe = newUnsafe();
    pipeline = newChannelPipeline();
}

protected AbstractChannel(Channel parent, ChannelId id) {
    this.parent = parent;
    this.id = id;
    unsafe = newUnsafe();
    pipeline = newChannelPipeline();
}

protected abstract AbstractUnsafe newUnsafe();

protected DefaultChannelPipeline newChannelPipeline() {
    return new DefaultChannelPipeline(this);
}
{% endhighlight %}

AbstractChannel 中所有的`出站`类方法都是委托给 pipeline 去执行的。比如下面的 AbstractChannel#connect：

{% highlight java linenos %}

public ChannelFuture connect(SocketAddress remoteAddress) {
    return pipeline.connect(remoteAddress);
}
{% endhighlight %}

------

## AbstractChannel#AbstractUnsafe

所有的`入站`事件从这里开始，然后进入管道 head，流向 tail。所有的数据`出站`事件在管道中从 tail 走到 head 后，最终在 Unsafe 中真正执行。

> `出站`事件这里只是说事件流向，并非一定要从 tail 开始，通常我们数据发送时会调用 ctx#write 方法，这时数据从当前 ctx 流向 head 。

每个 Unsafe 实例都有自己的数据发送缓冲区 outboundBuffer。 ChannelOutboundBuffer 见 [Netty 之发送缓冲区 ChannelOutboundBuffer](/netty-ChannelOutboundBuffer/)。

### #register

AbstractUnsafe#register 主要功能为 channel 注册工作线程（EventLoop）。

注册流程：

1. 设置工作线程;
2. 调用 #doRegister 执行具体子类附加注册功能，如 Nio 中 SelectableChannel 向 Selector注册感兴趣的事件等；
3. 调用管道中所有 ChannelHandler#handlerAdded 方法；
4. 设置 promise 结果为成功；
5. 向管道中发送 channel `注册`事件；
6. 如果 channel 是首次注册，向管道中发送 channel `激活`事件；
7. 如果 channel 是非首次注册，且 channel 设置了自动读取，则调用 #doBeginRead 发起数据读取操作。

> Oio 的*工作线程*`ThreadPerChannelEventLoop`没有实现任何附加功能，空方法一个。

{% highlight java linenos %}
public final void register(EventLoop eventLoop, final ChannelPromise promise) {
    // 设置工作线程
    AbstractChannel.this.eventLoop = eventLoop;
    // 省略校验代码 。。。

    if (eventLoop.inEventLoop()) {
        register0(promise);
    } else {
        try {
            eventLoop.execute(new Runnable() {
                @Override
                public void run() {
                    register0(promise);
                }
            });
        } catch (Throwable t) {
            // 调用子类 #doClose 强制关闭通道 
            closeForcibly();
            closeFuture.setClosed();
            safeSetFailure(promise, t);
        }
    }
}

public final void closeForcibly() {
    assertEventLoop();

    try {
        doClose();
    } catch (Exception e) {
        logger.warn("Failed to close a channel.", e);
    }
}

private void register0(ChannelPromise promise) {
    try {
        if (!promise.setUncancellable() || !ensureOpen(promise)) {
            return;
        }
        boolean firstRegistration = neverRegistered;
        // 待子类实现附加功能
        doRegister();
        neverRegistered = false;
        registered = true;

        // 调用管道中所有 ChannelHandler#handlerAdded 方法
        pipeline.invokeHandlerAddedIfNeeded();

        safeSetSuccess(promise);
        // 向管道中发送 channel 注册成功事件
        pipeline.fireChannelRegistered();

        if (isActive()) {
            if (firstRegistration) {
                // 如果是 channel 的首次注册，向管道中发送 channel 激活事件
                pipeline.fireChannelActive();
            } else if (config().isAutoRead()) {
                // 如果是非首次注册，且 channel 设置了自动读取，则发起数据读取操作
                beginRead();
            }
        }
    } catch (Throwable t) {
        // Close the channel directly to avoid FD leak.
        closeForcibly();
        closeFuture.setClosed();
        safeSetFailure(promise, t);
    }
}

public final void beginRead() {
    assertEventLoop();

    if (!isActive()) {
        return;
    }

    try {
        // 待具体子类实现
        doBeginRead();
    } catch (final Exception e) {
        invokeLater(new Runnable() {
            @Override
            public void run() {
                pipeline.fireExceptionCaught(e);
            }
        });
        close(voidPromise());
    }
}
{% endhighlight %}

> #invokeLater 打包要执行的任务到工作线程异步执行。

### #deregister

channel 注销工作线程（EventLoop）。注销工作需要等到当前工作线程中的任务执行结束才能开始，因此需要把注销任务打包提交到工作线程，异步调用。

注销流程：

1. 设置 promise 为不可撤销，失败则返回；
2. 如果 channel 未注册，则直接返回；
3. 调用子类实现 #doDeregister 处理具体的注销工作，如 SelectableChannel 从 Selector 注销；
4. 如果是由关闭 channel 导致的注销，也就是 fireChannelInactive 为 TRUE，则向管道中发送 channel `失活`事件；
5. 如果此时还处于注册状态，则修改状态为`注销`，同时向管道中发送 channel `注销`事件；
6. 设置 promise 结果为成功。

{% highlight java linenos %}
public final void deregister(final ChannelPromise promise) {
    // 防止在用户线程调用
    assertEventLoop();
    deregister(promise, false);
}

private void deregister(final ChannelPromise promise, final boolean fireChannelInactive) {
    if (!promise.setUncancellable()) {
        return;
    }

    if (!registered) {
        // 如果 channel 未注册，则直接返回；
        safeSetSuccess(promise);
        return;
    }

    invokeLater(new Runnable() {
        @Override
        public void run() {
            try {
                doDeregister();
            } catch (Throwable t) {
                logger.warn("Unexpected exception occurred while deregistering a channel.", t);
            } finally {
                if (fireChannelInactive) {
                    pipeline.fireChannelInactive();
                }

                // 防止循环调用导致`注销`事件重复发送
                if (registered) {
                    registered = false;
                    pipeline.fireChannelUnregistered();
                }
                safeSetSuccess(promise);
            }
        }
    });
}

// 提交任务到工作线程，异步执行
private void invokeLater(Runnable task) {
    try {
        eventLoop().execute(task);
    } catch (RejectedExecutionException e) {
        logger.warn("Can't invoke task later as EventLoop rejected it", e);
    }
}
{% endhighlight %}

### #bind

绑定 SocketAddress 到 ChannelPromise 中的 channel。

绑定流程：

1. 设置 promise 为不可撤销，失败则返回；
2. 执行子类 #doBind 实现具体绑定工作；
3. 绑定成功，异步向管道中发出 channel `激活`事件；
4. 设置 promise 结果为成功。

{% highlight java linenos %}
public final void bind(final SocketAddress localAddress, final ChannelPromise promise) {
    assertEventLoop();

    if (!promise.setUncancellable() || !ensureOpen(promise)) {
        return;
    }

    boolean wasActive = isActive();
    try {
        // 执行子类具体绑定工作；
        doBind(localAddress);
    } catch (Throwable t) {
        safeSetFailure(promise, t);
        closeIfClosed();
        return;
    }

    if (!wasActive && isActive()) {
        // 绑定成功，异步向管道中发出 channel `激活`事件；
        invokeLater(new Runnable() {
            @Override
            public void run() {
                pipeline.fireChannelActive();
            }
        });
    }
    // 设置 promise 结果为成功
    safeSetSuccess(promise);
}
{% endhighlight %}

### #write

向出站缓冲区 ChannelOutboundBuffer 末尾添加一条消息。

ChannelOutboundBuffer 见 [Netty 之发送缓冲区 ChannelOutboundBuffer](/netty-ChannelOutboundBuffer/)。

{% highlight java linenos %}
public final void write(Object msg, ChannelPromise promise) {
    assertEventLoop();

    ChannelOutboundBuffer outboundBuffer = this.outboundBuffer;
    if (outboundBuffer == null) {
        safeSetFailure(promise, WRITE_CLOSED_CHANNEL_EXCEPTION);
        // release message now to prevent resource-leak
        ReferenceCountUtil.release(msg);
        return;
    }

    int size;
    try {
        msg = filterOutboundMessage(msg);
        size = pipeline.estimatorHandle().size(msg);
        if (size < 0) {
            size = 0;
        }
    } catch (Throwable t) {
        safeSetFailure(promise, t);
        ReferenceCountUtil.release(msg);
        return;
    }

    outboundBuffer.addMessage(msg, size, promise);
}
{% endhighlight %}

### #flush

在出站缓冲区 ChannelOutboundBuffer 中标记要写出数据的范围 [flushedEntry, unflushedEntry)，调用具体实现的 #doWrite 把数据真正写出。

inFlush0 为 true 说明当前处于数据写出过程，防止重复调用。

> 在 AbstractChannel 的某些具体实现中，方法 #flush0 能够被用户线程调用，可能会和工作线程中调用的 #flush 并发执行。 

{% highlight java linenos %}
public final void flush() {
    assertEventLoop();

    ChannelOutboundBuffer outboundBuffer = this.outboundBuffer;
    if (outboundBuffer == null) {
        return;
    }

    // 确定要写出的数据范围 [flushedEntry, unflushedEntry)
    outboundBuffer.addFlush();
    flush0();
}

@SuppressWarnings("deprecation")
protected void flush0() {
    // 防止重复调用
    if (inFlush0) {
        return;
    }

    final ChannelOutboundBuffer outboundBuffer = this.outboundBuffer;
    if (outboundBuffer == null || outboundBuffer.isEmpty()) {
        return;
    }

    inFlush0 = true;

    // Mark all pending write requests as failure if the channel is inactive.
    if (!isActive()) {
        try {
            if (isOpen()) {
                outboundBuffer.failFlushed(FLUSH0_NOT_YET_CONNECTED_EXCEPTION, true);
            } else {
                // Do not trigger channelWritabilityChanged because the channel is closed already.
                outboundBuffer.failFlushed(FLUSH0_CLOSED_CHANNEL_EXCEPTION, false);
            }
        } finally {
            inFlush0 = false;
        }
        return;
    }

    try {
        // 具体子类实现
        doWrite(outboundBuffer);
    } catch (Throwable t) {
        if (t instanceof IOException && config().isAutoClose()) {
            close(voidPromise(), t, FLUSH0_CLOSED_CHANNEL_EXCEPTION, false);
        } else {
            try {
                shutdownOutput(voidPromise(), t);
            } catch (Throwable t2) {
                close(voidPromise(), t2, FLUSH0_CLOSED_CHANNEL_EXCEPTION, false);
            }
        }
    } finally {
        inFlush0 = false;
    }
}
{% endhighlight %}

### #close

关闭通道。

关闭流程：

1. 设置 promise 为不可撤销，失败则返回；
2. 重复调用校验：非重复调用则设置进入『关闭流程』标志 closeInitiated 为 true，否则返回；
3. 调用子类 #prepareToClose 执行关闭前准备逻辑，并选择性返回一个 Executor（工作线程）或 null；
4. 如果 Executor 不为空，在 Executor 中调用子类 #doClose 方法，执行关闭底层通道逻辑；
5. 否则在当前线程调用子类 #doClose 方法，执行关闭底层通道逻辑；
6. 调用 ChannelOutboundBuffer#failFlushed 清空发送缓冲区中标记为 flushed 的 Entry；
7. 关闭 ChannelOutboundBuffer；
8. 调用 #deregister `注销`通道。

ChannelOutboundBuffer 的分析见 [Netty 之发送缓冲区 ChannelOutboundBuffer](/netty-ChannelOutboundBuffer)。

> 第 6、7 步需要放到 channel 自己的工作线程中执行。

{% highlight java linenos %}
public final void close(final ChannelPromise promise) {
    assertEventLoop();

    close(promise, CLOSE_CLOSED_CHANNEL_EXCEPTION, CLOSE_CLOSED_CHANNEL_EXCEPTION, false);
}

private void close(final ChannelPromise promise, final Throwable cause,
                    final ClosedChannelException closeCause, final boolean notify) {
    if (!promise.setUncancellable()) {
        return;
    }

    if (closeInitiated) {
        // 防止重复发起 close
        // 省略部分代码。。。
        return;
    }

    closeInitiated = true;

    final boolean wasActive = isActive();
    final ChannelOutboundBuffer outboundBuffer = this.outboundBuffer;
    this.outboundBuffer = null; // Disallow adding any messages and flushes to outboundBuffer.
    Executor closeExecutor = prepareToClose();
    if (closeExecutor != null) {
        closeExecutor.execute(new Runnable() {
            @Override
            public void run() {
                try {
                    // Execute the close.
                    doClose0(promise);
                } finally {
                    // Call invokeLater so closeAndDeregister is executed in the EventLoop again!
                    invokeLater(new Runnable() {
                        @Override
                        public void run() {
                            if (outboundBuffer != null) {
                                // 清空发送缓冲区中标记为 flushed 的 Entry；
                                outboundBuffer.failFlushed(cause, notify);
                                outboundBuffer.close(closeCause);
                            }
                            fireChannelInactiveAndDeregister(wasActive);
                        }
                    });
                }
            }
        });
    } else {
        try {
            // Close the channel and fail the queued messages in all cases.
            doClose0(promise);
        } finally {
            if (outboundBuffer != null) {
                // Fail all the queued messages.
                outboundBuffer.failFlushed(cause, notify);
                outboundBuffer.close(closeCause);
            }
        }
        if (inFlush0) {
            invokeLater(new Runnable() {
                @Override
                public void run() {
                    fireChannelInactiveAndDeregister(wasActive);
                }
            });
        } else {
            fireChannelInactiveAndDeregister(wasActive);
        }
    }
}

private void fireChannelInactiveAndDeregister(final boolean wasActive) {
    deregister(voidPromise(), wasActive && !isActive());
}

private void doClose0(ChannelPromise promise) {
    try {
        doClose();
        closeFuture.setClosed();
        safeSetSuccess(promise);
    } catch (Throwable t) {
        closeFuture.setClosed();
        safeSetFailure(promise, t);
    }
}

protected abstract void doClose() throws Exception;
{% endhighlight %}

### #disconnect

连接断开流程：

1. 设置 promise 为不可撤销，失败则返回；
2. 调用子类实现 #doDisconnect 执行具体断连逻辑；
3. 断连成功则打包触发管道事件 ChannelInactive 任务到工作线程；
4. 设置 promise 成功；
5. 关闭通道。

{% highlight java linenos %}
public final void disconnect(final ChannelPromise promise) {
    assertEventLoop();

    if (!promise.setUncancellable()) {
        return;
    }

    boolean wasActive = isActive();
    try {
        doDisconnect();
    } catch (Throwable t) {
        safeSetFailure(promise, t);
        closeIfClosed();
        return;
    }

    if (wasActive && !isActive()) {
        // 打包触发 ChannelInactive 任务到工作线程
        invokeLater(new Runnable() {
            @Override
            public void run() {
                pipeline.fireChannelInactive();
            }
        });
    }

    safeSetSuccess(promise);
    // doDisconnect() might have closed the channel
    closeIfClosed(); 
}

protected final void closeIfClosed() {
    if (isOpen()) {
        return;
    }
    close(voidPromise());
}
{% endhighlight %}

### #shutdownOutput

关闭`出站`流。

关闭流程：

1. 设置 promise 为不可撤销，失败则返回；
2. 设置 字段 outboundBuffer 为 null；
3. 创建 `关闭`事件；
4. 调用子类 #prepareToClose 执行关闭前准备逻辑，并选择性返回一个 Executor（工作线程）或 null；
5. 如果 Executor 不为 null，在 Executor 中执行 6、7；否则在当前工作线程执行 6、7；
6. 调用子类的 #doClose 方法；
7. 设置 promise 结果；
8. 调用 ChannelOutboundBuffer#failFlushed 清空发送缓冲区中标记为 flushed 的 Entry；
9. 关闭 ChannelOutboundBuffer；
10. 在`管道`中发送`关闭`事件。

{% highlight java linenos %}
public final void shutdownOutput(final ChannelPromise promise) {
    assertEventLoop();
    shutdownOutput(promise, null);
}

private void shutdownOutput(final ChannelPromise promise, Throwable cause) {
    if (!promise.setUncancellable()) {
        return;
    }

    final ChannelOutboundBuffer outboundBuffer = this.outboundBuffer;
    if (outboundBuffer == null) {
        promise.setFailure(CLOSE_CLOSED_CHANNEL_EXCEPTION);
        return;
    }
    // Disallow adding any messages and flushes to outboundBuffer.
    this.outboundBuffer = null; 

    final Throwable shutdownCause = cause == null ?
            new ChannelOutputShutdownException("Channel output shutdown") :
            new ChannelOutputShutdownException("Channel output shutdown", cause);
    Executor closeExecutor = prepareToClose();
    if (closeExecutor != null) {
        closeExecutor.execute(new Runnable() {
            @Override
            public void run() {
                try {
                    // Execute the shutdown.
                    doShutdownOutput();
                    promise.setSuccess();
                } catch (Throwable err) {
                    promise.setFailure(err);
                } finally {
                    // 打包关闭 buffer 任务到工作线程执行
                    eventLoop().execute(new Runnable() {
                        @Override
                        public void run() {
                            closeOutboundBufferForShutdown(pipeline, outboundBuffer, shutdownCause);
                        }
                    });
                }
            }
        });
    } else {
        try {
            // Execute the shutdown.
            doShutdownOutput();
            promise.setSuccess();
        } catch (Throwable err) {
            promise.setFailure(err);
        } finally {
            closeOutboundBufferForShutdown(pipeline, outboundBuffer, shutdownCause);
        }
    }
}

private void closeOutboundBufferForShutdown(
        ChannelPipeline pipeline, ChannelOutboundBuffer buffer, Throwable cause) {
    // 调用 ChannelOutboundBuffer#failFlushed 清空发送缓冲区中标记为 flushed 的 Entry；
    buffer.failFlushed(cause, false);
    // 关闭 ChannelOutboundBuffer；
    buffer.close(cause, true);
    // 在`管道`中发送`关闭`事件。
    pipeline.fireUserEventTriggered(ChannelOutputShutdownEvent.INSTANCE);
}
{% endhighlight %}