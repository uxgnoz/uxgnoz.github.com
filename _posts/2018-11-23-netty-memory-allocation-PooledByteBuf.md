---
title: Netty 之内存分配：PooledByteBuf
layout: posts
categories: netty, 内存分配
---

# Netty 之内存分配：PooledByteBuf

------

## PooledByteBuf

Netty 中的`ByteBuf`对 JDK 自带的`ByteBuffer`作了改进，用`readerIndex`和`writerIndex`分别标记读写位置，使用起来更自然，更舒坦。

{% highlight java  %}
    +-------------------+------------------+------------------+
    | discardable bytes |  readable bytes  |  writable bytes  |
    +-------------------+------------------+------------------+
    |                   |                  |                  |
    0      <=      readerIndex   <=   writerIndex    <=    capacity
{% endhighlight %}

`PooledByteBuf`作为池化的`ByteBuf`，提高了内存分配与释放的速度，同时，通过`Recycler`，`PooledByteBuf`也实现了实例的重用。

实例重用见 [Netty 之实例重用：Recycler](/netty-Recycler)。

下面代码给出了`PooledByteBuf`中的字段。

{% highlight java  linenos %}
private final Recycler.Handle<PooledByteBuf<T>> recyclerHandle;
// PooledByteBuf 所属的 块
protected PoolChunk<T> chunk;
// 在 块 中的编号（低 32 位），如果是页内空间，还包括页内空间编号（高 32 位）
protected long handle;
// 块内存
protected T memory;
// 实例占用空间首地址在 块 内存中的偏移
protected int offset;
// 实例在块中实际占用的可用内存大小，只为分配空间的一部分
protected int length;
// 最大可用内存空间长度，分配的空间大小。
// 如果是块内空间，则为分配的块节点对应的容量；如果是页内空间，则是页内空间的大小
int maxLength;
// PooledByteBuf 实例关联的线程本地缓存
PoolThreadCache cache;
// ??
private ByteBuffer tmpNioBuf;
// 所属的分配器
private ByteBufAllocator allocator;
{% endhighlight %}

### #init

初始化`PooledByteBuf`实例。包括：

* `chunk`，初始化所属的块；
* `handle`，在块中的节点编号，如果是页内空间，还有页内空间编号；
* `offset`，在块中的偏移地址，单位 byte；
* `length`，可用空间大小；
* `maxLenth`，最大空间大小；
* `cache`，关联的线程本地缓存；
* 初始化当前实例底层的块内存；
* 初始化当前实例的分配器为 `chunk.arena.parent`。

块内空间分配参见 [Netty 之内存分配：Buddy 算法](/netty-memory-allocation-buddy/)，页内空间分配参见 [Netty 之内存分配：Slab 算法](/netty-memory-allocation-slab)。

{% highlight java linenos %}
void init(PoolChunk<T> chunk, long handle, int offset, int length, 
        int maxLength, PoolThreadCache cache) {
    init0(chunk, handle, offset, length, maxLength, cache);
}
private void init0(PoolChunk<T> chunk, long handle, int offset, int length, 
        int maxLength, PoolThreadCache cache) {
    assert handle >= 0;
    assert chunk != null;

    // 所属的块
    this.chunk = chunk;
    // 初始化当前实例底层层的块内存
    memory = chunk.memory;
    // 初始化当前实例的分配器
    allocator = chunk.arena.parent;
    // 关联的线程本地缓存
    this.cache = cache;
    // 在块中的节点编号，如果是页内空间，还有页内空间编号
    this.handle = handle;
    // 在块中的偏移地址，单位 byte
    this.offset = offset;
    // 可用空间大小
    this.length = length;
    // 最大空间大小
    this.maxLength = maxLength;
    tmpNioBuf = null;
}
{% endhighlight %}

### #initUnpooled

底层空间太大，块中分配不了时，会单独创建一个块，来分配空间。

{% highlight java linenos %}
void initUnpooled(PoolChunk<T> chunk, int length) {
    init0(chunk, 0, chunk.offset, length, length, null);
}
{% endhighlight %}

### #capacity

调整实例可用空间容量，调整范围只能在**[0, maxCapacity]**。

调整时，该方法会尽可能的利用**已分配**的内存空间。扩容时，只有在分配的内存空间不够用时，才会重新去分配空间；收缩时，只在新容量不到原分配空间的一半（块节点上）或者收缩的大小超过 16 字节（页内 tiny 空间）时，才会去重新分配空间。

为了提高块中内存利用率，块空间利用率不到一半的，需要释放内存，重新分配。同样的，在 tiny 空间，收缩超过 16 字节的，也需要重新到收缩后`tinySubpagePools`上对应的链表中分配页内空间。

块内空间分配参见 [Netty 之内存分配：Buddy 算法](/netty-memory-allocation-buddy/)，页内空间分配参见 [Netty 之内存分配：Slab 算法](/netty-memory-allocation-slab)。

{% highlight java  linenos %}
public final ByteBuf capacity(int newCapacity) {
    // [0, maxCapacity]
    checkNewCapacity(newCapacity);
    // 没有池化
    if (chunk.unpooled) {
        if (newCapacity == length) {
            // 容量不变，直接返回
            return this;
        }
    } 
    // 池化
    else {
        // 扩容
        if (newCapacity > length) {
            // 当前块节点或页内空间可以容纳调整后的空间
            if (newCapacity <= maxLength) {
                // 直接修改可用空间容量
                length = newCapacity;
                // 返回当前实例
                return this;
            }
        } 
        // 收缩
        else if (newCapacity < length) {
            // 收缩不到一半
            if (newCapacity > maxLength >>> 1) {
                // 页内 tiny 空间
                if (maxLength <= 512) {
                    //  收缩后的容量没有小于当前页内空间的等级，tiny 空间每 16 字节一个级别
                    if (newCapacity > maxLength - 16) {
                        // 直接修改容量
                        length = newCapacity;
                        // 修正容量改变后的读写位置
                        setIndex(Math.min(readerIndex(), newCapacity), 
                                Math.min(writerIndex(), newCapacity));
                        // 返回当前实例
                        return this;
                    }
                } 
                // 块空间，或页内 small 空间
                else { // > 512 (i.e. >= 1024)
                    length = newCapacity;
                    // 修正容量改变后的读写位置
                    setIndex(Math.min(readerIndex(), newCapacity), 
                            Math.min(writerIndex(), newCapacity));
                    // 返回当前实例
                    return this;
                }
            }
        } 
        // 容量不变
        else {
            // 返回当前实例
            return this;
        }
    }
    // 以上条件都不满足，重新给实例分配底层块内存
    chunk.arena.reallocate(this, newCapacity, true);
    // 返回当前实例
    return this;
}

public ByteBuf setIndex(int readerIndex, int writerIndex) {
    if (readerIndex < 0 || readerIndex > writerIndex || writerIndex > capacity()) {
        throw new IndexOutOfBoundsException(...);
    }
    setIndex0(readerIndex, writerIndex);
    return this;
}
{% endhighlight %}


### #idx

返回索引`index`在底层块内存中的实际偏移地址。

{% highlight java  linenos %}
protected final int idx(int index) {
    // 首地址的块偏移加上相对偏移
    return offset + index;
}
{% endhighlight %}

### #deallocate

释放实例占用的底层块空间，并回收本实例。

实例回收/重用见 [Netty 之实例重用：Recycler](/netty-Recycler)。

{% highlight java  linenos %}
protected final void deallocate() {
    if (handle >= 0) {
        final long handle = this.handle;
        this.handle = -1;
        memory = null;
        tmpNioBuf = null;
        // 块空间回收
        chunk.arena.free(chunk, handle, maxLength, cache);
        chunk = null;
        // 实例回收
        recycle();
    }
}
{% endhighlight %}

### #reuse

实例重用，清除各种标志。

{% highlight java  linenos %}
final void reuse(int maxCapacity) {
    maxCapacity(maxCapacity);
    // 设置引用
    setRefCnt(1);
    // 清除读写位置
    setIndex0(0, 0);
    // 清除标记位置
    discardMarks();
}
{% endhighlight %}

------

## PooledDirectByteBuf

`PooledDirectByteBuf`继承了`PooledByteBuf`，底层的数据载体是 JDK 自带的 `ByteBuffer`，内部同样也是用了`ByteBuffer`的 api 来操作数据。

{% highlight java  linenos %}
final class PooledDirectByteBuf extends PooledByteBuf<ByteBuffer>
{% endhighlight %}

### #getBytes

{% highlight java  linenos %}
private void getBytes(int index, byte[] dst, int dstIndex, int length, boolean internal) {
    checkDstIndex(index, length, dstIndex, dst.length);
    ByteBuffer tmpBuf;
    if (internal) {
        tmpBuf = internalNioBuffer();
    } else {
        tmpBuf = memory.duplicate();
    }
    index = idx(index);
    tmpBuf.clear().position(index).limit(index + length);
    tmpBuf.get(dst, dstIndex, length);
}

protected final ByteBuffer internalNioBuffer() {
    ByteBuffer tmpNioBuf = this.tmpNioBuf;
    if (tmpNioBuf == null) {
        this.tmpNioBuf = tmpNioBuf = newInternalNioBuffer(memory);
    }
    return tmpNioBuf;
}
{% endhighlight %}

### @newInstance

获取一个`PooledDirectByteBuf`实例，重用的或新创建的。

实例回收/重用见 [Netty 之实例重用：Recycler](/netty-Recycler)。

{% highlight java  linenos %}
static PooledDirectByteBuf newInstance(int maxCapacity) {
    PooledDirectByteBuf buf = RECYCLER.get();
    buf.reuse(maxCapacity);
    return buf;
}
{% endhighlight %}

------

## PooledUnsafeDirectByteBuf

`PooledUnsafeDirectByteBuf`继承了`PooledByteBuf`，底层的数据载体是 JDK 自带的 `ByteBuffer`，内部使用`Unsafe`进行数据操作。

{% highlight java  linenos %}
final class PooledUnsafeDirectByteBuf extends PooledByteBuf<ByteBuffer> 
{% endhighlight %}

### #getBytes

{% highlight java  linenos %}
public ByteBuf getBytes(int index, byte[] dst, int dstIndex, int length) {
    UnsafeByteBufUtil.getBytes(this, addr(index), index, dst, dstIndex, length);
    return this;
}

static void getBytes(AbstractByteBuf buf, long addr, int index, byte[] dst, int dstIndex, int length) {
    buf.checkIndex(index, length);
    checkNotNull(dst, "dst");
    if (isOutOfBounds(dstIndex, length, dst.length)) {
        throw new IndexOutOfBoundsException("dstIndex: " + dstIndex);
    }
    if (length != 0) {
        PlatformDependent.copyMemory(addr, dst, dstIndex, length);
    }
}
{% endhighlight %}

### @newInstance

获取一个`PooledUnsafeDirectByteBuf`实例，重用的或新创建的。实例回收/重用见 [Netty 之实例重用：Recycler](/netty-Recycler)。

{% highlight java  linenos %}
static PooledUnsafeDirectByteBuf newInstance(int maxCapacity) {
    PooledUnsafeDirectByteBuf buf = RECYCLER.get();
    buf.reuse(maxCapacity);
    return buf;
}
{% endhighlight %}