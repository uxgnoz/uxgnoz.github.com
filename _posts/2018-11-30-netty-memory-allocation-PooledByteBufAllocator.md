---
title: Netty 之内存分配：PooledByteBufAllocator
layout: posts
categories: netty, 内存分配
---

# Netty 之内存分配：PooledByteBufAllocator

------

`PooledByteBufAllocator`中维护了 2 个`PoolArena`数组：`heapArenas`和`directArenas`。

{% highlight java linenos %}
private final PoolArena<byte[]>[] heapArenas;
private final PoolArena<ByteBuffer>[] directArenas;
{% endhighlight %}

每个线程会绑定一个`PoolArena`到它的线程本地变量`PoolThreadCache`中，也就是说，所有该线程中的内存分配都会使用同一个`PoolArena`。那怎么来决定一个线程该绑定哪个`PoolArena`呢？答案是*最少使用*原则，下面的代码可以很容易看出这一点。在初始化线程本地变量时，调用了`#leastUsedArena`来决定需要绑定的`PoolArena`。另外，该方法也可以最大限度的避免竞争，且均匀分布任务负荷。

> 早前版本的 Netty 使用了*轮询*方式来决定线程的`PoolArena`，该方法的缺点是随着线程频繁的创建和消亡，各`PoolArena`的负载越来越不均衡。而*最少使用*这一方式可以避免这种问题。

{% highlight java linenos %}
// PoolThreadLocalCache#initialValue
protected synchronized PoolThreadCache initialValue() {
    final PoolArena<byte[]> heapArena = leastUsedArena(heapArenas);
    final PoolArena<ByteBuffer> directArena = leastUsedArena(directArenas);

    Thread current = Thread.currentThread();
    if (useCacheForAllThreads || current instanceof FastThreadLocalThread) {
        return new PoolThreadCache(heapArena, directArena, ...);
    }
    // No caching so just use 0 as sizes.
    return new PoolThreadCache(heapArena, directArena, 0, 0, 0, 0, 0);
}
// PoolThreadLocalCache#leastUsedArena
// 返回绑定线程数最少的 PoolArena
private <T> PoolArena<T> leastUsedArena(PoolArena<T>[] arenas) {
    if (arenas == null || arenas.length == 0) {
        return null;
    }

    PoolArena<T> minArena = arenas[0];
    for (int i = 1; i < arenas.length; i++) {
        PoolArena<T> arena = arenas[i];
        if (arena.numThreadCaches.get() < minArena.numThreadCaches.get()) {
            minArena = arena;
        }
    }

    return minArena;
}
{% endhighlight %}

------

## 内存分配

分配*直接内存*的时候，从线程本地变量中拿出`PoolArena`，创建`PooledByteBuf`实例，分配并初始化其底层空间。

{% highlight java linenos %}
public ByteBuf directBuffer(int initialCapacity, int maxCapacity) {
    if (initialCapacity == 0 && maxCapacity == 0) {
        return emptyBuf;
    }
    // 容量校验
    validate(initialCapacity, maxCapacity);
    return newDirectBuffer(initialCapacity, maxCapacity);
}

protected ByteBuf newDirectBuffer(int initialCapacity, int maxCapacity) {
    PoolThreadCache cache = threadCache.get();
    // 本地 PoolArena
    PoolArena<ByteBuffer> directArena = cache.directArena;

    final ByteBuf buf;
    if (directArena != null) {
        // 创建 buf，分配、初始化底层空间
        buf = directArena.allocate(cache, initialCapacity, maxCapacity);
    } else {
        buf = ...
    }
    // 包装一层，引用计数的 buf
    return toLeakAwareBuffer(buf);
}
{% endhighlight %}

------

## 内存回收

当用户或 Netty 的某段代码不需要继续使用某`PooledByteBuf`实例时，通过调用`ReferenceCounted#release`方法减少引用计数，当引用计数达到 0 的时候才会真正触发内存回收。

当需要持有某个 Netty 传给我们的`PooledByteBuf`实例，防止被其他线程误释放时，调用`ReferenceCounted#retain`方法增加引用计数；在不再需要使用的时候调用`ReferenceCounted#release` 方法，减少引用计数，告诉别人如果可以，就把它放了吧。

{% highlight java linenos %}
public boolean release() {
    return release0(1);
}

private boolean release0(int decrement) {
    // 递减引用计数
    int oldRef = refCntUpdater.getAndAdd(this, -decrement);
    if (oldRef == decrement) {
        deallocate();
        return true;
    }
    if (oldRef < decrement || oldRef - decrement > oldRef) {
        // Ensure we don't over-release, and avoid underflow.
        refCntUpdater.getAndAdd(this, decrement);
        throw new IllegalReferenceCountException(oldRef, -decrement);
    }
    return false;
}
// 回收内存空间，回收 buf 实例
protected final void deallocate() {
    if (handle >= 0) {
        final long handle = this.handle;
        this.handle = -1;
        memory = null;
        tmpNioBuf = null;
        // 空间回收
        chunk.arena.free(chunk, handle, maxLength, cache);
        chunk = null;
        // 实例回收
        recycle();
    }
}
{% endhighlight %}

------

## 参考

* [Netty 之内存分配：PoolArena](/netty-memory-allocation-PoolArena/)
* [Netty 之内存分配：堆外内存分配与释放](/netty-memory-allocation-direct-memory/)
* [Netty 之内存分配：Buddy 算法](/netty-memory-allocation-buddy/)
* [Netty 之内存分配：Slab 算法](/netty-memory-allocation-slab)
* [Netty 之内存分配：PooledByteBuf](/netty-memory-allocation-PooledByteBuf/)
* [Netty 之内存分配：PoolChunkList](/netty-memory-allocation-PoolChunkList/)


{% highlight java linenos %}
{% endhighlight %}
{% highlight java linenos %}
{% endhighlight %}
{% highlight java linenos %}
{% endhighlight %}