---
title: Netty 之内存分配：PoolChunkList
layout: posts
categories: netty, 内存分配
---

# Netty 之内存分配：PoolChunkList

------

## #PoolChunkList

下面的代码给出了*块链表*（`PoolChunkList`）中的字段，及其注释。

{% highlight java linenos %}
private static final 
Iterator<PoolChunkMetric> 
EMPTY_METRICS = Collections.<PoolChunkMetric>emptyList().iterator();
// 所属的 arena
private final PoolArena<T> arena;
// arena 中 PoolChunkList 双链表中的后驱节点
private final PoolChunkList<T> nextList;
// 最小使用率
private final int minUsage;
// 最大使用率
private final int maxUsage;
// 最大分配容量
private final int maxCapacity;
// 块链表的首指针
private PoolChunk<T> head;
// arena 中 PoolChunkList 双链表中前驱节点
private PoolChunkList<T> prevList;
{% endhighlight %}

在构造*块链表*实例的时候，需要初始化下面的字段：

* `arena`，所属的`PoolArena`；
* `nextList`，后驱节点；
* `minUsage`，最小使用率；
* `maxUsage`，最大使用率；
* `maxCapacity`，最大分配容量，$$chunkSize * ((100 - minUsage)\ \ /\ 100)$$。块加入某个*块链表*时，它的使用量肯定大于或等于该*块链表*的最低使用率`minUsage`，因此，它所能分配的最大空间率只能是$$1 - minUsage\  /\  100$$。通过`maxCapacity`，我们可以快速判断请求的空间当前*块链表*能不能满足，而不需要继续去遍历*块链表*中的块。

{% highlight java linenos %}
PoolChunkList(PoolArena<T> arena, PoolChunkList<T> nextList, 
        int minUsage, int maxUsage, int chunkSize) {
    assert minUsage <= maxUsage;
    this.arena = arena;
    this.nextList = nextList;
    this.minUsage = minUsage;
    this.maxUsage = maxUsage;
    // 根据 minUsage 和 chunkSize 计算最大分配容量
    maxCapacity = calculateMaxCapacity(minUsage, chunkSize);
}
// 计算最大分配容量
private static int calculateMaxCapacity(int minUsage, int chunkSize) {
    // 最低使用率 1
    minUsage = minUsage0(minUsage);
    if (minUsage == 100) {
        // 最小使用率 100，啥也分配不了，GG
        return 0;
    }
    // 最大分配容量为 chunkSize * ((100 - minUsage) / 100)
    return  (int) (chunkSize * (100L - minUsage) / 100L);
}
{% endhighlight %}

------

## #allocate

利用*块链表*中的块给传入的`PooledByteBuf`实例分配并初始化底层空间。如果块的空间使用率超出当前*块链表*的设定的最大空间使用率，则把块顺着`PoolArena`中的链表往后移动到最大使用率更高的*块链表*中。

返回 TRUE，分配成功；FALSE，分配失败。

*块内空间*分配见 [Netty 之内存分配：Buddy 算法](/netty-memory-allocation-buddy/) 和 [Netty 之内存分配：Slab 算法](/netty-memory-allocation-slab)。

{% highlight java linenos %}
boolean allocate(PooledByteBuf<T> buf, int reqCapacity, int normCapacity) {
    if (head == null || normCapacity > maxCapacity) {
        // PoolChunkList 为空，
        // 或者规范化后的请求容量超过 PoolChunkList 能分配的最大值 maxCapacity，
        // 返回分配失败
        return false;
    }
    // 从 PoolChunk链表头开始分配空间，直到成功 or 全部失败
    for (PoolChunk<T> cur = head;;) {
        // 块内空间分配
        long handle = cur.allocate(normCapacity);
        // 分配失败
        if (handle < 0) {
            // 取下一个块
            cur = cur.next;
            // 没有下一个了，失败，GG
            if (cur == null) {
                return false;
            }
        } 
        // 当前块中空间分配成功
        else {
            // 初始化 buf 底层空间
            cur.initBuf(buf, handle, reqCapacity);
            // 当前块的使用量超出最大使用量了
            if (cur.usage() >= maxUsage) {
                // 从当前块链表中删除块 cur
                remove(cur);
                // 把块 cur 加入下一个 块链表 中
                nextList.add(cur);
            }
            return true;
        }
    }
}
// 从块链表内部的双链表中删除该块
private void remove(PoolChunk<T> cur) {
    if (cur == head) {
        head = cur.next;
        if (head != null) {
            head.prev = null;
        }
    } else {
        PoolChunk<T> next = cur.next;
        cur.prev.next = next;
        if (next != null) {
            next.prev = cur.prev;
        }
    }
}
{% endhighlight %}

------

## #free

释放一个*块节点*或*页内空间*。随着空间的回收，块的空间使用率下降，这时可能需要把当前块顺着`PoolArena`中的链表往前移动到最小使用率更低的*块链表*中。如果块的使用率为 0，该块将会被销毁。

返回值：

* TRUE，说明回收成功；
* FALSE，说明回收成功，且块完全空闲，需要销毁。

`handle`为*块节点*编号和*页内空间*编号。

{% highlight java linenos %}
boolean free(PoolChunk<T> chunk, long handle) {
    // 释放块中节点或页内空间
    chunk.free(handle);
    // 低于最小使用率，需要挪块链表
    if (chunk.usage() < minUsage) {
        // 从当前的双链表中删除该块
        remove(chunk);
        // 水往低处流啊
        return move0(chunk);
    }
    // 不需要挪块链表
    return true;
}

private boolean move0(PoolChunk<T> chunk) {
    if (prevList == null) {
        // 没有前驱节点，只有 q000了
        assert chunk.usage() == 0;
        // 返回 false 将导致该 chunk 内存被销毁
        return false;
    }
    // 考虑往前移动到内存使用率低的块链表
    return prevList.move(chunk);
}

private boolean move(PoolChunk<T> chunk) {
    assert chunk.usage() < maxUsage;
    // 还能更低
    if (chunk.usage() < minUsage) {
        // 继往低处续流啊
        return move0(chunk);
    }
    // 目的地到了，加进来吧
    add0(chunk);
    return true;
}
// 块入块链表
void add0(PoolChunk<T> chunk) {
    chunk.parent = this;
    if (head == null) {
        head = chunk;
        chunk.prev = null;
        chunk.next = null;
    } else {
        chunk.prev = null;
        chunk.next = head;
        head.prev = chunk;
        head = chunk;
    }
}
{% endhighlight %}
{% highlight java linenos %}
{% endhighlight %}