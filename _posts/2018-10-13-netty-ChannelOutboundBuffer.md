---
title: Netty 之发送缓冲区 ChannelOutboundBuffer
layout: posts
category: netty
---

# Netty 之发送缓冲区 ChannelOutboundBuffer

------

## 0x01 综述

ChannelOutboundBuffer 为 Channel 的数据发送缓冲区，数据封装成以 Entry 节点的形式存放在单向链表中。链表有三个指针：

{% highlight java linenos %}
// The Entry that is the first in the linked-list structure that was flushed
private Entry flushedEntry;
// The Entry which is the first unflushed in the linked-list structure
private Entry unflushedEntry;
// The Entry which represents the tail of the buffer
private Entry tailEntry;
// The number of flushed entries that are not written yet
private int flushed;
{% endhighlight %}

它们把整个链表分成了 2 个区间，[flushedEntry, unflushedEntry) 和 [unflushedEntry, tailEntry]。指针 tailEntry 为尾指针，方便往链表尾部添加 Entry。flushedEntry 要么为 null，说明还没有调用 ChannelOutboundBuffer#flush 操作，此时 unflushedEntry 为头指针；要么充当头指针，此时区间 [flushedEntry, unflushedEntry) 为已 flush 数据，字段 flushed 记录该区间大小。

------

## 0x02 ChannelOutboundBuffer#addMessage

ChannelOutboundBuffer#addMessage 在链表尾部添加 Entry。

{% highlight java linenos %}
public void addMessage(Object msg, int size, ChannelPromise promise) {
    Entry entry = Entry.newInstance(msg, size, total(msg), promise);
    if (tailEntry == null) {
        flushedEntry = null;
    } else {
        Entry tail = tailEntry;
        tail.next = entry;
    }
    tailEntry = entry;
    if (unflushedEntry == null) {
        unflushedEntry = entry;
    }

    incrementPendingOutboundBytes(entry.pendingSize, false);
}
{% endhighlight %}

在方法 #incrementPendingOutboundBytes() 中修改缓存中的数据大小 totalPendingSize 。如果 totalPendingSize 大于 channel 配置的写缓冲区高水位线，则触发 ChannelPipeline 的 ChannelWritabilityChanged 事件，禁止继续写入。

{% highlight java linenos %}
private void incrementPendingOutboundBytes(long size, boolean invokeLater) {
    if (size == 0) {
        return;
    }

    long newWriteBufferSize = TOTAL_PENDING_SIZE_UPDATER.addAndGet(this, size);
    if (newWriteBufferSize > channel.config().getWriteBufferHighWaterMark()) {
        setUnwritable(invokeLater);
    }
}

private void setUnwritable(boolean invokeLater) {
    for (;;) {
        final int oldValue = unwritable;
        final int newValue = oldValue | 1;
        if (UNWRITABLE_UPDATER.compareAndSet(this, oldValue, newValue)) {
            if (oldValue == 0 && newValue != 0) {
                fireChannelWritabilityChanged(invokeLater);
            }
            break;
        }
    }
}
{% endhighlight %}

> invokeLater 参数指定是否立即执行还是异步执行。

------

## 0x03 ChannelOutboundBuffer#addFlush

ChannelOutboundBuffer#addFlush 把当前链表中处于 [unflushedEntry, tailEntry] 的 Entry 逐个加入到 [flushedEntry, unflushedEntry) 区间。

遍历的过程当中，那些 promise 不能设置成 uncancellable 的 Entry ，调用 Entry#cancel 回收内存并减少 totalPendingSize 。如果 totalPendingSize 小于 channel 配置的写缓冲区低水位线，则触发 ChannelPipeline 的 ChannelWritabilityChanged 事件，设置可写。最后置 unflushedEntry 为 null。

{% highlight java linenos %}
public void addFlush() {
    Entry entry = unflushedEntry;
    if (entry != null) {
        if (flushedEntry == null) {
            // there is no flushedEntry yet, so start with the entry
            flushedEntry = entry;
        }
        do {
            flushed ++;
            if (!entry.promise.setUncancellable()) {
                // Was cancelled so make sure we free up memory and notify about the freed bytes
                int pending = entry.cancel();
                decrementPendingOutboundBytes(pending, false, true);
            }
            entry = entry.next;
        } while (entry != null);

        // All flushed so reset unflushedEntry
        unflushedEntry = null;
    }
}

private void decrementPendingOutboundBytes(long size, boolean invokeLater, 
        boolean notifyWritability) {
    if (size == 0) {
        return;
    }

    long newWriteBufferSize = TOTAL_PENDING_SIZE_UPDATER.addAndGet(this, -size);
    if (notifyWritability && newWriteBufferSize < channel.config().getWriteBufferLowWaterMark()) {
        setWritable(invokeLater);
    }
}

// Entry#cancel()
int cancel() {
    if (!cancelled) {
        cancelled = true;
        int pSize = pendingSize;

        // release message and replace with an empty buffer
        ReferenceCountUtil.safeRelease(msg);
        msg = Unpooled.EMPTY_BUFFER;

        pendingSize = 0;
        total = 0;
        progress = 0;
        bufs = null;
        buf = null;
        return pSize;
    }
    return 0;
}
{% endhighlight %}

------

## 0x04 ChannelOutboundBuffer#current

ChannelOutboundBuffer#current 返回 flushedEntry 指向的 Entry 中的数据。

{% highlight java linenos %}
public Object current() {
    Entry entry = flushedEntry;
    if (entry == null) {
        return null;
    }

    return entry.msg;
}
{% endhighlight %}

------

## 0x05 ChannelOutboundBuffer#progress

ChannelOutboundBuffer#progress 进度通知。如果 flushedEntry 中的 promise 为 ChannelProgressivePromise 类型，则尝试通知进度，也就是当前 Entry 中的数据真正写入 channel 的进度。

{% highlight java linenos %}
public void progress(long amount) {
    Entry e = flushedEntry;
    assert e != null;
    ChannelPromise p = e.promise;
    if (p instanceof ChannelProgressivePromise) {
        long progress = e.progress + amount;
        e.progress = progress;
        ((ChannelProgressivePromise) p).tryProgress(progress, e.total);
    }
}
{% endhighlight %}

------

## 0x06 ChannelOutboundBuffer#remove

ChannelOutboundBuffer#remove  从链表中删除 flushedEntry 指向的 Entry ， flushedEntry 指向下一个 Entry。

如果 flushedEntry 为 null，则清空 nioBuffers 缓存，直接返回 false。否则从链表中删除 Entry，设置该 Entry 的 promise 为 success；修改 totalPendingSize，如果 totalPendingSize 小于 channel 配置的写缓存低水位线，则触发 ChannelPipeline 的 ChannelWritabilityChanged 事件。

最后回收 Entry。

{% highlight java linenos %}
public boolean remove() {
    Entry e = flushedEntry;
    if (e == null) {
        clearNioBuffers();
        return false;
    }
    Object msg = e.msg;

    ChannelPromise promise = e.promise;
    int size = e.pendingSize;

    removeEntry(e);

    if (!e.cancelled) {
        // only release message, notify and decrement if it was not canceled before.
        ReferenceCountUtil.safeRelease(msg);
        safeSuccess(promise);
        decrementPendingOutboundBytes(size, false, true);
    }

    // recycle the entry
    e.recycle();

    return true;
}

private void removeEntry(Entry e) {
    if (-- flushed == 0) {
        // processed everything
        flushedEntry = null;
        if (e == tailEntry) {
            tailEntry = null;
            unflushedEntry = null;
        }
    } else {
        flushedEntry = e.next;
    }
}
{% endhighlight %}

------

## 0x07 ChannelOutboundBuffer#remove(Throwable cause)

ChannelOutboundBuffer#remove(Throwable cause) 基本逻辑跟 ChannelOutboundBuffer#remove一致，除了设置 Entry 的 promise 为 fail。

{% highlight java linenos %}
public boolean remove(Throwable cause) {
    return remove0(cause, true);
}

private boolean remove0(Throwable cause, boolean notifyWritability) {
    Entry e = flushedEntry;
    if (e == null) {
        clearNioBuffers();
        return false;
    }
    Object msg = e.msg;

    ChannelPromise promise = e.promise;
    int size = e.pendingSize;

    removeEntry(e);

    if (!e.cancelled) {
        // only release message, fail and decrement if it was not canceled before.
        ReferenceCountUtil.safeRelease(msg);

        safeFail(promise, cause);
        decrementPendingOutboundBytes(size, false, notifyWritability);
    }

    // recycle the entry
    e.recycle();

    return true;
}
{% endhighlight %}

------

## 0x08 ChannelOutboundBuffer#removeBytes

ChannelOutboundBuffer#removeBytes(long writtenBytes) 从 flushedEntry 指向的 Entry 开始，依次删除数据全部发送完的 Entry，更新部分发送完 Entry 的 readerIndex，并对每个 Entry 中的 promise 发出进度通知。

最后清空 nioBuffers 缓存。

本方法的前提是链表中 Entry 的数据类型为 ByteBuf。

{% highlight java linenos %}
public void removeBytes(long writtenBytes) {
    for (;;) {
        Object msg = current();
        if (!(msg instanceof ByteBuf)) {
            assert writtenBytes == 0;
            break;
        }

        final ByteBuf buf = (ByteBuf) msg;
        final int readerIndex = buf.readerIndex();
        final int readableBytes = buf.writerIndex() - readerIndex;

        if (readableBytes <= writtenBytes) {
            if (writtenBytes != 0) {
                progress(readableBytes);
                writtenBytes -= readableBytes;
            }
            remove();
        } else { // readableBytes > writtenBytes
            if (writtenBytes != 0) {
                buf.readerIndex(readerIndex + (int) writtenBytes);
                progress(writtenBytes);
            }
            break;
        }
    }
    clearNioBuffers();
}
{% endhighlight %}

------

## 0x09 ChannelOutboundBuffer#nioBuffers

ChannelOutboundBuffer#nioBuffers(int maxCount, long maxBytes) 返回区间 [flushedEntry, unflushedEntry) 上Entry#msg 中的底层数据载体 ByteBufer 的数组。 

Entry 中的数据存放在一个或多个 ByteBuf 中，而一个 ByteBuf 底层由一个或多个 ByteBuffer 组成（简单理解）。最终返回的 ByteBuffer 数组存放在线程本地变量中。


* *maxCount* 为 ByteBufer[] 最大长度，
* *nioBufferCount* 为 ByteBufer[] 实际长度；
* *maxBytes* 为 ByteBufer[] 中数据最大值字节数；
* *nioBufferSize* 为 ByteBufer[] 中数据实际字节数。 

由于 *maxCount* 和 *maxBytes* 的存在，很多时候只能返回区间  [flushedEntry, unflushedEntry) 上的一`部分数据`，甚至`某个 Entry 的一部分数据`。

> 部分操作系统的 writeX() 系统调用最大只能允许 Integer.MAX_VALUE 字节的数据写入。

{% highlight java linenos %}
public ByteBuffer[] nioBuffers(int maxCount, long maxBytes) {
    assert maxCount > 0;
    assert maxBytes > 0;
    // ByteBufer[] 中数据实际字节数
    long nioBufferSize = 0;
    // ByteBufer[] 实际长度
    int nioBufferCount = 0;
    final InternalThreadLocalMap threadLocalMap = InternalThreadLocalMap.get();
    ByteBuffer[] nioBuffers = NIO_BUFFERS.get(threadLocalMap);
    Entry entry = flushedEntry;
    while (isFlushedEntry(entry) && entry.msg instanceof ByteBuf) {
        if (!entry.cancelled) {
            ByteBuf buf = (ByteBuf) entry.msg;
            final int readerIndex = buf.readerIndex();
            final int readableBytes = buf.writerIndex() - readerIndex;

            if (readableBytes > 0) {
                // 部分操作系统的 writeX() 系统调用最大只能允许 Integer.MAX_VALUE 字节的数据写入
                // - https://www.freebsd.org/cgi/man.cgi?query=write&sektion=2
                // - http://linux.die.net/man/2/writev
                if (maxBytes - readableBytes < nioBufferSize && nioBufferCount != 0) {
                    break;
                }
                nioBufferSize += readableBytes;
                // msg 中 ByteBuffer 的数据量
                int count = entry.count;
                if (count == -1) {
                    //noinspection ConstantValueVariableUse
                    entry.count = count = buf.nioBufferCount();
                }
                int neededSpace = min(maxCount, nioBufferCount + count);
                if (neededSpace > nioBuffers.length) {
                    nioBuffers = expandNioBufferArray(nioBuffers, neededSpace, nioBufferCount);
                    NIO_BUFFERS.set(threadLocalMap, nioBuffers);
                }
                if (count == 1) {
                    ByteBuffer nioBuf = entry.buf;
                    if (nioBuf == null) {
                        // cache ByteBuffer as it may need to create a new ByteBuffer 
                        // instance if its a derived buffer
                        entry.buf = nioBuf = buf.internalNioBuffer(readerIndex, readableBytes);
                    }
                    nioBuffers[nioBufferCount++] = nioBuf;
                } else {
                    ByteBuffer[] nioBufs = entry.bufs;
                    if (nioBufs == null) {
                        // cached ByteBuffers as they may be expensive to create in terms
                        // of Object allocation
                        entry.bufs = nioBufs = buf.nioBuffers();
                    }
                    for (int i = 0; i < nioBufs.length && nioBufferCount < maxCount; ++i) {
                        ByteBuffer nioBuf = nioBufs[i];
                        if (nioBuf == null) {
                            break;
                        } else if (!nioBuf.hasRemaining()) {
                            // 忽略没有数据可读的 nioBuf
                            continue;
                        }
                        nioBuffers[nioBufferCount++] = nioBuf;
                    }
                }
                if (nioBufferCount == maxCount) {
                    break;
                }
            }
        }
        entry = entry.next;
    }
    this.nioBufferCount = nioBufferCount;
    this.nioBufferSize = nioBufferSize;

    return nioBuffers;
}
{% endhighlight %}

## 0x0a ChannelOutboundBuffer#failFlushed

删除区间 [flushedEntry, unflushedEntry) 上的 Entry ，并设置 Entry 的 promise 为失败。

参数 notify 指定其他条件满足的情况下，是否需要出发 WritabilityChanged 事件。 

{% highlight java linenos %}
void failFlushed(Throwable cause, boolean notify) {
    if (inFail) {
        return;
    }

    try {
        inFail = true;
        for (;;) {
            if (!remove0(cause, notify)) {
                break;
            }
        }
    } finally {
        inFail = false;
    }
}
{% endhighlight %}

## 0x0b ChannelOutboundBuffer#bytesBeforeWritable

ChannelOutboundBuffer#isWritable 返回 false 时，totalPendingSize 高于 channel 配置的缓冲区低水位线字节数，否则返回 0。

> 大白话：`写开关`关闭的情况下，需要从缓冲区拿掉多少字节，才能继续写。

{% highlight java linenos %}
public long bytesBeforeWritable() {
    long bytes = totalPendingSize - channel.config().getWriteBufferLowWaterMark();
    if (bytes > 0) {
        return isWritable() ? 0 : bytes;
    }
    return 0;
}
{% endhighlight %}

## ChannelOutboundBuffer#bytesBeforeUnwritable

ChannelOutboundBuffer#isWritable 返回 true 时，totalPendingSize 低于 channel 配置的缓冲区高水位线字节数，否则返回 0。

> 大白话：`写开关`打开的情况下，还能向缓冲区写多少字节。

{% highlight java linenos %}
public long bytesBeforeUnwritable() {
    long bytes = channel.config().getWriteBufferHighWaterMark() - totalPendingSize;
    if (bytes > 0) {
        return isWritable() ? bytes : 0;
    }
    return 0;
}
{% endhighlight %}