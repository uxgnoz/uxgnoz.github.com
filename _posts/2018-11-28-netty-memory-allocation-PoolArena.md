---
title: Netty 之内存分配：PoolArena
layout: posts
categories: netty, 内存分配
---

# Netty 之内存分配：PoolArena

------

## 综述

本文只具体分析`PoolArena`的子类`DirectArena`。

下面是`PoolArena`内部的整体数据结构。

{% highlight java linenos %}
// q... 为 块链表 PoolChunkList
qInit ==> q000 <==> q025 <==> q050 <==> q075 <==> q100

// xxx为数字，块为 PoolChunk
qxxx ==> 块1 <==> 块2 <==> ... <==> 块N
{% endhighlight %}

## #allocateNormal

正常内存分配路径。沿着 q050、q025、q000、qInit、q075的顺序，依次用各个*块链表*分配空间，有一个分配成功则退出。

*块链表*参见[Netty 之内存分配：PoolChunkList](/netty-memory-allocation-PoolChunkList/)。

如果都不能分配，则新创建一个块并加入到 qInit 中。从新块中分配空间。*块内空间*分配见[Netty 之内存分配：Buddy 算法](/netty-memory-allocation-buddy/)。

{% highlight java linenos %}
private void allocateNormal(PooledByteBuf<T> buf, int reqCapacity, int normCapacity) {
    if (q050.allocate(buf, reqCapacity, normCapacity) 
        || q025.allocate(buf, reqCapacity, normCapacity) 
        || q000.allocate(buf, reqCapacity, normCapacity) 
        || qInit.allocate(buf, reqCapacity, normCapacity) 
        || q075.allocate(buf, reqCapacity, normCapacity)) {
        return;
    }

    // 创建一个新的 块
    PoolChunk<T> c = newChunk(pageSize, maxOrder, pageShifts, chunkSize);
    // 从新块中分配空间
    long handle = c.allocate(normCapacity);
    // 确信成功分配
    assert handle > 0;
    // 初始化 buf 底层内存空间
    c.initBuf(buf, handle, reqCapacity);
    // 把新创建的块加入 qInit 中
    qInit.add(c);
}

{% endhighlight %}

`#newChunk`创建一个新的块。

如果系统提供的*直接内存*没有自带 cleaner，这个时候，需要 Netty 通过反射的方式创建`DirectByteBuffer`实例，并负责管理所分配空间的计数与释放。其他情况下，可以直接调用`ByteBuffer@allocateDirect`创建`DirectByteBuffer`实例。

如果需要*地址对齐*，实际分配的*直接内存*会多`directMemoryCacheAlignment`个字节，块中实际使用的内存地址偏移量`offset`就等于对齐需要的偏移量。

{% highlight java linenos %}
// DirectArena#newChunk
protected PoolChunk<ByteBuffer> newChunk(int pageSize, int maxOrder,
        int pageShifts, int chunkSize) {
    // 不用对齐
    if (directMemoryCacheAlignment == 0) {
        return new PoolChunk<ByteBuffer>(
            this,   // 所属 arena
            allocateDirect(chunkSize),  // 底层空间
            pageSize, maxOrder, pageShifts, 
            chunkSize,  // 块大小
            0   // 地址偏移
        );
    }

    final ByteBuffer memory = allocateDirect(chunkSize + directMemoryCacheAlignment);
    return new PoolChunk<ByteBuffer>(
        this,   // 所属 arena
        memory, // 底层空间
        pageSize, maxOrder, pageShifts, 
        chunkSize,  // 块大小
        offsetCacheLine(memory) // 地址偏移
    );
}
// DirectArena@allocateDirect
private static ByteBuffer allocateDirect(int capacity) {
    return PlatformDependent.useDirectBufferNoCleaner() 
            // 通过反射的方式，创建 DirectByteBuffer 实例
            ? PlatformDependent.allocateDirectNoCleaner(capacity) 
            // 直接创建 DirectByteBuffer 实例
            : ByteBuffer.allocateDirect(capacity);
}
// DirectArena#offsetCacheLine
// 计算对齐所需要的偏移量
private int offsetCacheLine(ByteBuffer memory) {
    // 有 Unsafe 时才能计算偏移量，否则会抛异常 NPE.
    int remainder = HAS_UNSAFE
            ? (int) (PlatformDependent.directBufferAddress(memory) 
                    & directMemoryCacheAlignmentMask)
            : 0;
    // offset = alignment - address & (alignment - 1)
    return directMemoryCacheAlignment - remainder;
}
{% endhighlight %}

------

## #allocateHuge

给`PooledByteBuf`实例单独创建一个**非池化**的临时块，并初始化之。

{% highlight java linenos %}
private void allocateHuge(PooledByteBuf<T> buf, int reqCapacity) {
    PoolChunk<T> chunk = newUnpooledChunk(reqCapacity);
    // 更新统计量
    activeBytesHuge.add(chunk.chunkSize());
    // 底层空间初始化
    buf.initUnpooled(chunk, reqCapacity);
    // 更新统计量
    allocationsHuge.increment();
}
// 创建一个非池化的临时块
protected PoolChunk<ByteBuffer> newUnpooledChunk(int capacity) {
    // 无需对齐
    if (directMemoryCacheAlignment == 0) {
        return new PoolChunk<ByteBuffer>(this, allocateDirect(capacity), capacity, 0);
    }
    // 要对齐，修改容量成对齐后的大小
    final ByteBuffer memory = allocateDirect(capacity + directMemoryCacheAlignment);
    // offsetCacheLine 计算对齐偏移量
    return new PoolChunk<ByteBuffer>(this, memory, capacity, offsetCacheLine(memory));
}
{% endhighlight %}

------

## #allocate

返回一个`PooledByteBuf`实例，分配并初始化其底层依赖的内存空间。

`reqCapacity`为请求容量，而`maxCapacity`为最大容量，之后调整实例容量的时候，只能在范围**[0, maxCapacity]**中调整，见下面的方法`#reallocate`。

*堆外内存*管理参见[Netty 之内存分配：堆外内存分配与释放](/netty-memory-allocation-direct-memory/)。*块内空间*分配见[Netty 之内存分配：Buddy 算法](/netty-memory-allocation-buddy/)。

{% highlight java linenos %}
PooledByteBuf<T> allocate(PoolThreadCache cache, int reqCapacity, int maxCapacity) {
    // 创建或重用 buf 实例
    PooledByteBuf<T> buf = newByteBuf(maxCapacity);
    // 分配其底层依赖的内存空间
    allocate(cache, buf, reqCapacity);
    // 谁要给谁
    return buf;
}
// in DirectArena
protected PooledByteBuf<ByteBuffer> newByteBuf(int maxCapacity) {
    if (HAS_UNSAFE) {
        // 内部使用 Unsafe 直接访问内存地址的方式操作数据
        return PooledUnsafeDirectByteBuf.newInstance(maxCapacity);
    } else {
        // 内部使用 ByteBuffer 提供的 api 操作数据
        return PooledDirectByteBuf.newInstance(maxCapacity);
    }
}
// 分配并初始化 buf 底层依赖的内存空间
private void allocate(PoolThreadCache cache, PooledByteBuf<T> buf, 
        final int reqCapacity) {
    // 规范化请求容量 reqCapacity
    final int normCapacity = normalizeCapacity(reqCapacity);
    // 页内空间分配
    if (isTinyOrSmall(normCapacity)) {
        int tableIdx;
        PoolSubpage<T>[] table;
        boolean tiny = isTiny(normCapacity);
        // 小于 512 为 tiny
        if (tiny) { 
            if (cache.allocateTiny(this, buf, reqCapacity, normCapacity)) {
                // cache 中分配成功，nice
                return;
            }
            // cache 不能分配
            // 根据容量，确定我们要从 tinySubpagePools 中的哪个链表分配空间
            tableIdx = tinyIdx(normCapacity);
            table = tinySubpagePools;
        } 
        // [512, 8k) 为 small 
        else {
            if (cache.allocateSmall(this, buf, reqCapacity, normCapacity)) {
                // cache 中分配成功，good
                return;
            }
            // cache 不能分配
            // 根据容量，确定我们要从 smallSubpagePools 中的哪个链表分配空间
            tableIdx = smallIdx(normCapacity);
            table = smallSubpagePools;
        }
        // 拿出对应链表的首指针 head
        final PoolSubpage<T> head = table[tableIdx];
        // 其他有地方会修改链表内容，会竞争，因此咱们给锁上
        synchronized (head) {
            // 链表首页
            final PoolSubpage<T> s = head.next;
            // 链表不为空呀
            if (s != head) {
                assert s.doNotDestroy && s.elemSize == normCapacity;
                // 拿到分配的页内空间编号
                long handle = s.allocate();
                // 不能小于 0 哦
                assert handle >= 0;
                // 初始化 buf 底层依赖的空间
                s.chunk.initBufWithSubpage(buf, handle, reqCapacity);
                // 更新统计量
                incTinySmallAllocation(tiny);
                // 分配并初始化结束
                return;
            }
        }
        // 页内空间相应的链表为空
        synchronized (this) {
            // 走正常路径分配
            allocateNormal(buf, reqCapacity, normCapacity);
        }
        // 更新统计量
        incTinySmallAllocation(tiny);
        // 分配并初始化结束
        return;
    }
    // 块空间分配
    if (normCapacity <= chunkSize) {
        // cache 中分配
        if (cache.allocateNormal(this, buf, reqCapacity, normCapacity)) {
            // cache 分配成功，GG
            return;
        }
        
        synchronized (this) {
            // cache 分配失败,走正常路径分配
            allocateNormal(buf, reqCapacity, normCapacity);
            // 更新统计量
            ++allocationsNormal;
        }
    } else {
        // 太大了，超出块的分配空间
        // 单独分配一个临时创建的大的块，并初始化
        allocateHuge(buf, reqCapacity);
    }
}
{% endhighlight %}

------

## #reallocate

调整`PooledByteBuf`的容量，内部实际上重新分配了`PooledByteBuf`底层空间。扩容时，需要数据复制，收缩时可能不需要。

> 要注意，容量收缩的时候，可能会导致部分数据丢失。

{% highlight java linenos %}
void reallocate(PooledByteBuf<T> buf, int newCapacity, boolean freeOldMemory) {
    // 调整范围 [0, macCapacity]
    if (newCapacity < 0 || newCapacity > buf.maxCapacity()) {
        throw new IllegalArgumentException("newCapacity: " + newCapacity);
    }

    int oldCapacity = buf.length;
    if (oldCapacity == newCapacity) {
        // 容量没有变动，GG
        return;
    }

    // 备份原值快照
    PoolChunk<T> oldChunk = buf.chunk;
    long oldHandle = buf.handle;
    T oldMemory = buf.memory;
    int oldOffset = buf.offset;
    int oldMaxLength = buf.maxLength;
    int readerIndex = buf.readerIndex();
    int writerIndex = buf.writerIndex();
    // 调用 #allocate 分配并初始化 buf 新空间
    allocate(parent.threadCache(), buf, newCapacity);
    // 扩容
    if (newCapacity > oldCapacity) {
        // 数据复制
        memoryCopy(oldMemory, oldOffset, buf.memory, buf.offset, oldCapacity);
    } 
    // 收缩
    else if (newCapacity < oldCapacity) {
        if (readerIndex < newCapacity) {
            if (writerIndex > newCapacity) {
                // 不能继续写了
                writerIndex = newCapacity;
            }
            // 数据复制
            memoryCopy(oldMemory, oldOffset + readerIndex,
                    buf.memory, buf.offset + readerIndex, writerIndex - readerIndex);
        } 
        else {
            // 读写都不行了，数据也就不需要复制了
            readerIndex = writerIndex = newCapacity;
        }
    }
    // 初始化读写位置
    buf.setIndex(readerIndex, writerIndex);

    if (freeOldMemory) {
        // 回收原先的内存空间
        free(oldChunk, oldHandle, oldMaxLength, buf.cache);
    }
}
// DirectArena#memoryCopy
// 内存数据拷贝
protected void memoryCopy(ByteBuffer src, int srcOffset, 
        ByteBuffer dst, int dstOffset, int length) {
    if (length == 0) {
        return;
    }

    if (HAS_UNSAFE) {
        PlatformDependent.copyMemory(
                PlatformDependent.directBufferAddress(src) + srcOffset,
                PlatformDependent.directBufferAddress(dst) + dstOffset, length);
    } else {
        // 其他 Netty buffers 可能会继续操作 src 和 dst，我们拷贝一份外包装就行
        src = src.duplicate();
        dst = dst.duplicate();
        src.position(srcOffset).limit(srcOffset + length);
        dst.position(dstOffset);
        dst.put(src);
    }
}
{% endhighlight %}

------

## #free

回收块中空间，更新各种统计量。

* 临时分配的大空间，需要被销毁；
* 块中空间回收后，利用率下降，可能需要在链表中往前移动，完全*空闲*时，该块需要被销毁。

{% highlight java linenos %}
void free(PoolChunk<T> chunk, long handle, int normCapacity, PoolThreadCache cache) {
    // 非池化的
    if (chunk.unpooled) {
        int size = chunk.chunkSize();
        // 释放块中的内存
        destroyChunk(chunk);
        // 更新统计量
        activeBytesHuge.add(-size);
        // 更新统计量
        deallocationsHuge.increment();
    } 
    // 池中的
    else {
        // 极小、小、普通
        SizeClass sizeClass = sizeClass(normCapacity);
        if (cache != null 
                && cache.add(this, chunk, handle, normCapacity, sizeClass)) {
            // cached so not free it.
            return;
        }
        // 回收空间，适当的时候释放块空间
        freeChunk(chunk, handle, sizeClass);
    }
}
// 极小、小、普通
private SizeClass sizeClass(int normCapacity) {
    if (!isTinyOrSmall(normCapacity)) {
        return SizeClass.Normal;
    }
    return isTiny(normCapacity) ? SizeClass.Tiny : SizeClass.Small;
}
// 回收空间，适当的时候释放块空间
void freeChunk(PoolChunk<T> chunk, long handle, SizeClass sizeClass) {
    final boolean destroyChunk;
    synchronized (this) {
        // 更新统计量
        switch (sizeClass) {
        case Normal:
            ++deallocationsNormal;
            break;
        case Small:
            ++deallocationsSmall;
            break;
        case Tiny:
            ++deallocationsTiny;
            break;
        default:
            throw new Error();
        }
        // 回收块中的空间，如果块完全空闲，设置销毁
        destroyChunk = !chunk.parent.free(chunk, handle);
    }
    // 块完全空闲，需要销毁
    if (destroyChunk) {
        // 释放块中的分配的内存
        destroyChunk(chunk);
    }
}
// 释放块中的分配的内存
protected void destroyChunk(PoolChunk<ByteBuffer> chunk) {
    if (PlatformDependent.useDirectBufferNoCleaner()) {
        PlatformDependent.freeDirectNoCleaner(chunk.memory);
    } else {
        PlatformDependent.freeDirectBuffer(chunk.memory);
    }
}
{% endhighlight %}

------

## 参考

* *堆外内存*管理参见 [Netty 之内存分配：堆外内存分配与释放](/netty-memory-allocation-direct-memory/)。
* *块内空间*分配见 [Netty 之内存分配：Buddy 算法](/netty-memory-allocation-buddy/) 和 [Netty 之内存分配：Slab 算法](/netty-memory-allocation-slab)。
* `PooledByteBuf`分析参见 [Netty 之内存分配：PooledByteBuf](/netty-memory-allocation-PooledByteBuf/)。
* *块链表*分析参见 [Netty 之内存分配：PoolChunkList](/netty-memory-allocation-PoolChunkList/)。

{% highlight java linenos %}
{% endhighlight %}
{% highlight java linenos %}
{% endhighlight %}
{% highlight java linenos %}
{% endhighlight %}
