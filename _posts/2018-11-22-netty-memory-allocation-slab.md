---
title: Netty 之内存分配：Slab 算法
layout: posts
categories: netty, slab, 内存分配
---

# Netty 之缓存池实现：Slab 算法

------

## 算法概述

slab 算法用来分配页内空间，页空间本身由 [buddy 算法](/netty-memory-allocation-buddy) 分配而来。Netty 中把这些小空间分成 2 类：

* `tinySubpagePools`用来分配小于 512 字节的页内空间，且大小必须是**16的整数倍**。`tinySubpagePools`中的元素只存放对应空间大小的链表首指针。比如 tinySubpagePools[0] 为只分配大小为 16（16 * 1） 字节空间的链表首指针，tinySubpagePools[1] 为只分配大小为 32（16 * 2）字节的链表首指针，以此类推，tinySubpagePools[31] 为只分配大小为 496（16 * 31）字节的链表首指针，共 32 个元素。
* `smallSubpagePools`分配 512 到 4096字节的页内空间，且大小依次**翻倍**。和`tinySubpagePools`中的链表内容类似，但只有 4 个元素，各链表能分配空间大小分别为 512、1024、2048、4096。

`PoolSubpage`通过位图的方式管理页内空间状态。下面图示了含有 2 个 4bit 元素的位图数组以及每一个 bit 所代表的页内空间编号。值为 1 的 bit，表示对应的页内空间*不可用*，0 表示状态为*空闲*。

{% highlight java  %}
+---+---+---+---+  +---+---+---+---+
| 3 | 2 | 1 | 0 |  | 7 | 6 | 5 | 4 | 
+---+---+---+---+  +---+---+---+---+
{% endhighlight %}

`PoolSubpage`分配页内空间时，返回值中除了页内空间编号，还包含了该页对应的叶节点编号。

------

## #findSubpagePoolHead

根据传入的空间大小`elemSize`，查找对应的链表首指针，如果`elemSize`小于 512，在`tinySubpagePools`中查找，否则在`smallSubpagePools`中查找。

{% highlight java linenos %}
// PoolArena#findSubpagePoolHead
PoolSubpage<T> findSubpagePoolHead(int elemSize) {
    int tableIdx;
    PoolSubpage<T>[] table;
    if (isTiny(elemSize)) { // < 512
        // 计算 16 的倍数，即 tinySubpagePools 元素索引
        tableIdx = elemSize >>> 4;
        // 取数组 tinySubpagePools
        table = tinySubpagePools;
    } else {
        tableIdx = 0;
        elemSize >>>= 10;
        // 除以 2 计算索引
        while (elemSize != 0) {
            elemSize >>>= 1;
            tableIdx ++;
        }
        // 取数组 smallSubpagePools
        table = smallSubpagePools;
    }

    // 返回链表首指针 head
    return table[tableIdx];
}

// normCapacity 小于 512 返回 TRUE，否则 FALSE 
static boolean isTiny(int normCapacity) {
    return (normCapacity & 0xFFFFFE00) == 0;
}
{% endhighlight %}

------

## #allocateSubpage

分配页内空间，返回一个 64 位的`handle`值，高 32 位为页内编号，低 32 位为块节点编号。

{% highlight java linenos %}
// PoolChunk#allocateSubpage
private long allocateSubpage(int normCapacity) {
    // 查找所属的链表首指针 head
    PoolSubpage<T> head = arena.findSubpagePoolHead(normCapacity);
    synchronized (head) {
        // 分配深度 maxOrder，因为只能在叶节点分配页内空间
        int d = maxOrder; 
        // 在叶节点中查找空闲节点
        int id = allocateNode(d);
        if (id < 0) {
            // 没有，GG
            return id;
        }

        // 数组 subpages 的大小为块中页的数目，2^maxOrder
        final PoolSubpage<T>[] subpages = this.subpages;
        // 页大小
        final int pageSize = this.pageSize;

        // 分配 1 页后，修改块中空闲空间大小
        freeBytes -= pageSize;

        // 将空闲叶节点编号转换为对应的页在 subpages 中的索引
        int subpageIdx = subpageIdx(id);
        PoolSubpage<T> subpage = subpages[subpageIdx];
        if (subpage == null) {
            // 该页还未分配，创建 PoolSubpage 新实例
            subpage = 
                new PoolSubpage<T>(head, this, id, runOffset(id), pageSize, normCapacity);
            // 放入数组 subpages 对应位置
            subpages[subpageIdx] = subpage;
        } else {
            // 该页已分配，重新初始化一下
            subpage.init(head, normCapacity);
        }
        // 返回页内编号+块编号组合
        return subpage.allocate();
    }
}

// 返回 id 节点在 块 中的字节数组中的偏移量，单位 byte
private int runOffset(int id) {
    // id 节点在深度为 depth(id) 的层上的序号，从 0 开始
    int shift = id ^ 1 << depth(id);
    // 序号 * 节点大小 = 偏移地址
    return shift * runLength(id);
}
// 返回 id 节点代表的空间大小，单位 byte
private int runLength(int id) {
    return 1 << log2ChunkSize - depth(id);
}

// 将空闲叶节点编号转换为对应的页在 subpages 中的索引
private int subpageIdx(int memoryMapIdx) {
    // 一句话解释：最高位置 0。
    // 2^maxOrder, 2^maxOrder + 1, ..., 2^(maxOrder + 1)  
    // ==> 0, 1, ..., 2^maxOrder - 1
    return memoryMapIdx ^ maxSubpageAllocs; 
}
{% endhighlight %}

------

## #free

释放为`handle`代表的页内空间或块空间的节点。

如果高 32 位不为 0 时，释放页内空间。当该页整页空闲，且不是链表中唯一的页时，回收该页对应的叶节点。

如果高 32 位为 0 时，直接回收编号为`handle`的节点。

节点回收详情见 [Netty 之内存分配：Buddy 算法](/netty-memory-allocation-buddy)。

{% highlight java linenos %}
// PoolChunk#free
void free(long handle) {
    // 块节点编号，取低 32 位
    int memoryMapIdx = memoryMapIdx(handle);
    // 高 32 位
    int bitmapIdx = bitmapIdx(handle);

    // 释放页内空间
    if (bitmapIdx != 0) { 
        // memoryMapIdx 对应的 PoolSubpage
        PoolSubpage<T> subpage = subpages[subpageIdx(memoryMapIdx)];
        assert subpage != null && subpage.doNotDestroy;

        // 从 PoolArena 中拿出 elemSize 对应的链表首指针 head
        PoolSubpage<T> head = arena.findSubpagePoolHead(subpage.elemSize);
        synchronized (head) {
            // bitmapIdx & 0x3FFFFFFF 真实的 bitmapIdx
            if (subpage.free(head, bitmapIdx & 0x3FFFFFFF)) {
                return;
            }
        }
    }
    // 增加可用空间大小
    freeBytes += runLength(memoryMapIdx);
    // 设置节点 memoryMapIdx 为空闲节点
    setValue(memoryMapIdx, depth(memoryMapIdx));
    // 更新父节点分配信息，直到根节点
    updateParentsFree(memoryMapIdx);
}

// 取低 32 位，叶节点编号
private static int memoryMapIdx(long handle) {
    return (int) handle;
}
// 取高 32 位，页内空间编号
private static int bitmapIdx(long handle) {
    return (int) (handle >>> Integer.SIZE);
}
{% endhighlight %}

------

## #initBufWithSubpage

初始化`PooledByteBuf`实例对应的底层内存空间。`handle`包含页内空间编号和相应的叶节点编号，`reqCapacity`为请求容量。

{% highlight java linenos %}
void initBufWithSubpage(PooledByteBuf<T> buf, long handle, int reqCapacity) {
    initBufWithSubpage(buf, handle, bitmapIdx(handle), reqCapacity);
}

private void initBufWithSubpage(PooledByteBuf<T> buf, long handle, int bitmapIdx, 
        int reqCapacity) {
    assert bitmapIdx != 0;
    // 叶节点编号
    int memoryMapIdx = memoryMapIdx(handle);
    // 获取叶节点对应的 PoolSubpage 实例
    PoolSubpage<T> subpage = subpages[subpageIdx(memoryMapIdx)];
    assert subpage.doNotDestroy;
    // 确保请求的容量小于该页的页内空间大小
    assert reqCapacity <= subpage.elemSize;
    // 初始化 buf
    buf.init(
        this, // 所属的块
        handle, // 页内编号和叶节点编号
        // 分配的空间首地址在块内存中的偏移量
        // 块偏移（offset） + 页偏移 + 页内偏移
        runOffset(memoryMapIdx) + (bitmapIdx & 0x3FFFFFFF) * subpage.elemSize + offset,
        reqCapacity, // 实际占用的空间大小
        subpage.elemSize, // 分配的空间大小
        arena.parent.threadCache()  // 线程本地缓存
    );
}
{% endhighlight %}

------

## PoolSubpage

`PoolSubpage`以`elemSize`为单位，把一页分为`maxNumElems`个页内空间，其中$$\ elemSize * maxNumElems = pageSize$$。采用位图管理页内空间的分配状态。

下面是`PoolSubpage`中包含的字段及其用途。

{% highlight java linenos %}
// 该页所属的 块
final PoolChunk<T> chunk;
// 该页在块中的编号
private final int memoryMapIdx;
// 该页首地址在块中字节数组的偏移量
private final int runOffset;
// 页大小
private final int pageSize;
// 位图，数组中每个元素的每一个 bit 代表相应页内空间是否被分配
private final long[] bitmap;
// 前驱节点
PoolSubpage<T> prev;
// 后驱节点
PoolSubpage<T> next;
// 是否销毁
boolean doNotDestroy;
// 页内页内空间大小（固定值），elemSize * maxNumElems = pageSize
int elemSize;
// 页内页内空间个数
private int maxNumElems;
// bitmap 数组包含有效值的长度
private int bitmapLength;
// 下一个可用页内空间编号，释放页内空间时设置，加速查找过程
// 其他情形下，需要通过计算才能取得下一个空闲页内空间编号
private int nextAvail;
// 页内空闲页内空间个数
private int numAvail;
{% endhighlight %}

### #init

初始化一个待分配页内空间的`PoolSubpage`实例。初始化的内容包括：

* `elemSize`，页内空间大小；
* `maxNumElems`，页内空间个数；
* `numAvail`，可用页内空间个数，与`maxNumElems`相同；
* `nextAvail`，下一个空闲页内空间编号，初始化为 0，第 1 个；
* `bitmapLength`，位图数组实际有效元素长度；
* `bitmap`，置位图所有有效位为 0；
* 把当前`PoolSubpage`实例加入`head`为首指针的链表中。

{% highlight java linenos %}
void init(PoolSubpage<T> head, int elemSize) {
    // 设置不可销毁
    doNotDestroy = true;
    // 设置元素大小，可以为 0 ？？？
    this.elemSize = elemSize;
    if (elemSize != 0) {
        // 初始化页内元素个数，空闲元素个数
        maxNumElems = numAvail = pageSize / elemSize;
        // 第一个页内空间就空闲
        nextAvail = 0;
        // 初始化 bitmap 有效长度，一个 long 有 64个 bit，可代表64个页内空间，
        // 因此，实际需要的 long 元素个数应该是 maxNumElems / 64
        bitmapLength = maxNumElems >>> 6;
        // 但是，如果 maxNumElems 不是 64 的倍数，那还需要一个额外的 long 来代表剩下的页内空间
        if ((maxNumElems & 63) != 0) {
            // 加上额外的一个 long
            bitmapLength ++;
        }
        // 每个 bit 位置0，表示所有页内空间均空闲
        for (int i = 0; i < bitmapLength; i ++) {
            bitmap[i] = 0;
        }
    }
    // 把本 PoolSubpage 插入链表首指针 head 的后面
    addToPool(head);
}

// 把本 PoolSubpage 插入链表首指针 head 的后面
private void addToPool(PoolSubpage<T> head) {
    assert prev == null && next == null;
    prev = head;
    next = head.next;
    next.prev = this;
    head.next = this;
}
{% endhighlight %}


### #allocate

分配页内空间，返回表示页内空间编号和块节点编号的`handle`值，类型为 `long`，64 位。

{% highlight java linenos %}
long allocate() {
    if (elemSize == 0) {
        return toHandle(0);
    }

    if (numAvail == 0 || !doNotDestroy) {
        return -1;
    }
    // 空闲页内空间编号
    final int bitmapIdx = getNextAvail();
    // 编号在位图数组中的索引
    int q = bitmapIdx >>> 6;
    // 编号对应的 bit 在 long 中的位置，从低位往高位看
    int r = bitmapIdx & 63;
    // 右移 r 位后，末位必须为 0
    assert (bitmap[q] >>> r & 1) == 0;
    // 设置该位 为 1，表示对应的页内空间已分配
    bitmap[q] |= 1L << r;

    // 递减可用页内空间数
    if (-- numAvail == 0) {
        // 没有可用页内空间时，从链表中移除
        removeFromPool();
    }

    return toHandle(bitmapIdx);
}

// 获取下一个空闲页内空间编号
private int getNextAvail() {
    int nextAvail = this.nextAvail;
    if (nextAvail >= 0) {
        this.nextAvail = -1;
        return nextAvail;
    }
    return findNextAvail();
}

private int findNextAvail() {
    final long[] bitmap = this.bitmap;
    final int bitmapLength = this.bitmapLength;
    // 遍历位图，查找可用页内空间编号
    for (int i = 0; i < bitmapLength; i ++) {
        // 查看当前 bits 中有没有为 0 的 bit
        long bits = bitmap[i];
        if (~bits != 0) {
            // bits 取反不为 0，说明至少有一个 bit 不为 0，
            // 那原先的 bits 中至少有一个 bit 为 0，也就至少有一个空闲页内空间
            return findNextAvail0(i, bits);
        }
    }
    // 返回没找到
    return -1;
}

private int findNextAvail0(int i, long bits) {
    final int maxNumElems = this.maxNumElems;
    // 基准值为 i * 64
    final int baseVal = i << 6;

    for (int j = 0; j < 64; j ++) {
        // 末位 bit 为 0，代表空闲页内空间
        if ((bits & 1) == 0) {
            // 基准值加上循环次数 j，就是空闲空间编号了
            int val = baseVal | j;
            // 最终的编号必须小于 maxNumElems，从0 开始编的嘛
            if (val < maxNumElems) {
                return val;
            } else {
                // 否则
                break;
            }
        }
        // bits 右移 1 位，继续下轮测试
        bits >>>= 1;
    }
    // 返回没找到
    return -1;
}

// 从链表中删除本 PoolSubpage
private void removeFromPool() {
    assert prev != null && next != null;
    prev.next = next;
    next.prev = prev;
    next = null;
    prev = null;
}
// 拼装页内编号和块节点编号
private long toHandle(int bitmapIdx) {
    return 0x4000000000000000L | (long) bitmapIdx << 32 | memoryMapIdx;
}
{% endhighlight %}

> 为什么`handle`值不是`(long) bitmapIdx << 32 | memoryMapIdx` ？
> 
> 页内编号也是从 0 开始的。如果`handle`的高 32 位全为0，这时下面 2 种内存分配方式是区分不了的。
>
> * 分配了页内空间，且页内空间编号为 0，节点编号为低 32 位；
> * 只分配了块节点空间，且节点编号为`handle`低32位。
> 
> 因此，分配页内空间时，在`handle`值次高位置 1，就能区分上面2种情况了。最高位置 1，呵呵 。。。

### #free

释放页内空间。

* 返回 TRUE，释放成功，且**页未被回收**；
* 返回 FALSE，释放成功，但**页被回收**。

{% highlight java linenos %}
boolean free(PoolSubpage<T> head, int bitmapIdx) {
    if (elemSize == 0) {
        return true;
    }
    // 编号在位图数组中的索引
    int q = bitmapIdx >>> 6;
    // 编号对应的 bit 在 long 中的位置，从低位往高位看
    int r = bitmapIdx & 63;
    assert (bitmap[q] >>> r & 1) != 0;
    bitmap[q] ^= 1L << r;

    // 设置下一个空闲页内空间编号，加速用
    setNextAvail(bitmapIdx);

    if (numAvail ++ == 0) {
        // 如果原来没有空闲空间，那么现在有了，加入分配链表
        addToPool(head);
        return true;
    }

    // 页内部分空间被分配
    if (numAvail != maxNumElems) {
        return true;
    } 
    // 整页空闲
    else {
        // 如果链表只有本 PoolSubpage 实例，就算了，依然保留在链表中
        if (prev == next) {           
            return true;
        }

        // 否则，从链表中删除本 PoolSubpage 实例
        doNotDestroy = false;
        removeFromPool();
        return false;
    }
}

private void setNextAvail(int bitmapIdx) {
    nextAvail = bitmapIdx;
}
{% endhighlight %}

