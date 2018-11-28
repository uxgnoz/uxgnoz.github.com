---
title: Netty 之内存分配：Buddy 算法
layout: posts
categories: netty, buddy, 内存分配
---

# Netty 之内存分配：Buddy 算法

------

## 算法概述

以下术语对理解本文很重要。

* `page`，页，最小内存分配单元；
* `pageSize`，页大小，默认为 8K；
* `chunk`，块，页的集合；
* `chunkSize`，块大小，$$chunkSize = pageSize * 2^{maxOrder}$$；
* `maxOrder`，*完全二叉树*的深度。

首先我们开辟一个大小为`chunkSize`的字节数组，当请求分配一个大小为`size`的 ByteBuf 时，我们返回数组中第一个大小合适且未分配的*连续空间*首地址，并把这段*连续空间*标记为*不可用*。为此，我们构造一棵*完全二叉树*，并把节点的分配信息存放在数组`memoryMap`中。

> * 简单起见，所有的`size`都会被规范化，也就是转换成不小于`size`的 2 的 N 次幂。

我们把`块`分成地址连续的$$\ 2^{maxOrder}\ $$个`页`，二叉树的叶节点对应一个`页`。树的节点分布如下，括号内为该层节点所代表的空间大小，深度越大，代表的空间越小：

{% highlight java linenos %}
depth=0        // 1 个节点 (chunkSize/2^0，即 chunkSize)
depth=1        // 2 个节点 (chunkSize/2^1)
..
..
depth=d        // 2^d 个节点 (chunkSize/2^d)
..
depth=maxOrder // 2^maxOrder 个节点 (chunkSize/2^maxOrder = pageSize)
{% endhighlight %}

比如，根节点能分配的最大空间为整个块，深度为1的节点能分配的最大空间为$$\ chunkSize\ /\ 2\ $$，深度为2的节点能分配最大空间为$$\ chunkSize\ /\ 2^2\ $$，以此类推，叶节点能分配的空间为$$\ chunkSize\ /\ 2^{maxOrder}\ $$，也就是只能分配1页。**深度越小，能分配的空间越大**。

有了这棵搜索树之后，**如果要分配一个大小为$$\ chunkSize\ /\ 2^k\ $$的连续空间时，我们只要在深度为 k 的层上，从左到右查找空闲节点就可以了**。

我们把*完全二叉树*的节点从上到下、从左到右编号：$$1,\ 2,\ 3,\ \ ...,\  2^{maxOrder+1} - 1$$，共$$\ 2^{maxOrder + 1} - 1\ $$个节点。`memoryMap`中的元素存放节点的分配状态信息。$$\ memoryMap[id] = x\ $$的含义是：编号`id`的节点能分配的最大空间在深度为`x`的层上，或者，`id`节点能分配的最小深度在`x`。随着节点的分配与释放，我们也会动态的去更新数组中的信息。`memoryMap`中的元素会被初始化为每个节点的*深度*，即，其能分配的最大空间为自身代表的大小。

节点有三个状态：*空闲*、*部分分配*、*不可用*。

* *空闲*：$$memoryMap[id] = depth\_of\_id$$，空闲节点能分配的最大空间为自身代表的大小；
* *部分分配*：$$memoryMap[id] > depth\_of\_id$$，部分分配的节点至少有一个子节点已被分配，因此节点本身不能被直接分配，它能分配的最大空间为`memoryMap[id]`层上节点代表的空间大小；
* *不可用*：$$memoryMap[id] = maxOrder + 1$$，该节点及其子树被完全分配，没有任何子节点可以分配。

> `depth_of_id`：节点`id`的深度。

------

## #allocateNode

在深度为 d 的层，分配空闲节点并返回节点编号。在 d 层找到空闲节点后，设置节点状态为*不可用*，回溯更新父节点分配状态，直到根节点。

块的可分配容量不够，直接返回 -1。

> 只要`块`的根节点能分配的最小深度小于等于 d，肯定能在 d 层找到空闲节点。

{% highlight java linenos %}
private int allocateNode(int d) {
    int id = 1;
    // has last d bits = 0 and rest all = 1
    // 比如 d=5,initial = 0xFF FF FF 11100000
    int initial = - (1 << d); 
    // 从根节点开始
    byte val = value(id);
    if (val > d) { 
        // 根节点下面第一个能分配的子节点在 d 之下，显然容量不够分配，GG
        return -1;
    }

    // 至此，我们能保证在深度为 d 的层上有空闲节点
    // 下面从上到下，从左到右，查找 d 层空闲节点

    // 对于深度小于 d 的层，id & initial == 0
    // 对于深度等于 d 的层，id & initial == 1 << d
    // 对于深度大于 d 的层，id & initial > 1 << d
    // 我们只处理 能分配的空间大于 d 层节点的节点 或者 d 层之上的节点
    while (val < d || (id & initial) == 0) { 
        // 左节点
        id <<= 1;
        // 左节点能分配的最小深度
        val = value(id);
        // memoryMap[id] > d，说明节点可分配空间不够，换右节点试试
        if (val > d) {
            // 右节点
            id ^= 1;
            // 右节点能分配的最小深度
            val = value(id);
        }
    }

    // 深度为 d，编号为 id 的节点，就是我们要找的
    byte value = value(id);
    // 设置 id 不可用
    setValue(id, unusable); // mark as unusable
    // 更新父节点分配信息，一直到根节点
    updateParentsAlloc(id);
    // 返回 编号 id
    return id;
}

// 更新父节点分配信息，一直到根节点
private void updateParentsAlloc(int id) {
    while (id > 1) {
        // 父节点
        int parentId = id >>> 1;
        // 自身可分配节点深度
        byte val1 = value(id);
        // 兄弟可分配节点深度
        byte val2 = value(id ^ 1);
        // 取 min(val1, val2) 作为父节点可分配最小深度
        byte val = val1 < val2 ? val1 : val2;
        // 设置父节点可分配节点深度
        setValue(parentId, val);
        // 继续往上走，总会到根节点的
        id = parentId;
    }
}

private byte value(int id) {
    return memoryMap[id];
}
private void setValue(int id, byte val) {
    memoryMap[id] = val;
}
{% endhighlight %}

------

## #allocateRun

分配大小为`normCapacity`的连续空间，`normCapacity`为规范化后的数值。

`pageSize`为 8k 时，`pageShifts`为 13。如果要分配 16k 的空间，那么深度$$\ d = maxOrder - 1 = maxOrder - (log_{2}(2^{14}) - 13)\ $$。很合理，很好很强大。

{% highlight java linenos %}
private long allocateRun(int normCapacity) {
    // 计算要分配的节点深度
    int d = maxOrder - (log2(normCapacity) - pageShifts);
    // 在深度 d 分配空闲节点，并返回节点 id
    int id = allocateNode(d);
    if (id < 0) {
        // 块容量不够，GG
        return id;
    }
    // 更新剩余空间大小，normCapacity
    freeBytes -= runLength(id);
    return id;
}

private int runLength(int id) {
    // 节点 id 代表的以 byte 为单位的空间大小
    return 1 << log2ChunkSize - depth(id);
}
{% endhighlight %}

------

## #initBuf

初始化`PooledByteBuf`实例对应的底层内存空间。`handle`包含页内空间编号和相应的叶节点编号，`reqCapacity`为请求容量。

方法`#initBufWithSubpage`参见[Netty 之内存分配：Slab 算法](/netty-memory-allocation-slab/#id_5)。

{% highlight java linenos %}
void initBuf(PooledByteBuf<T> buf, long handle, int reqCapacity) {
    // 块节点编号
    int memoryMapIdx = memoryMapIdx(handle);
    // 页内空间编号
    int bitmapIdx = bitmapIdx(handle);
    // 普通空间
    if (bitmapIdx == 0) {
        byte val = value(memoryMapIdx);
        assert val == unusable : String.valueOf(val);
        // 初始化 buf 底层空间
        buf.init(
            this, // 所属的块
            handle, // 块节点编号
            // 块偏移（offset） + 页偏移
            runOffset(memoryMapIdx) + offset, 
            reqCapacity, // 实际占用的空间大小
            runLength(memoryMapIdx), // 分配的空间大小
            rena.parent.threadCache()   // 线程本地缓存
        );
    } 
    // 页内空间
    else {
        // 初始化 buf 对应的页内空间
        initBufWithSubpage(buf, handle, bitmapIdx, reqCapacity);
    }
}
{% endhighlight %}

-----

## #allocate

分配请求参数`normCapacity`指定大小的空间，并返回分配的代表块节点编号和页内空间编号的`handle`值。

{% highlight java linenos %}
long allocate(int normCapacity) {
    // 块节点空间分配
    if ((normCapacity & subpageOverflowMask) != 0) { 
        return allocateRun(normCapacity);
    }
    // 页内空间分配 
    else {
        return allocateSubpage(normCapacity);
    }
}
{% endhighlight %}

-----

## #free

释放编号为`handle`的节点，修改节点状态为*空闲*，回溯更新父节点分配状态，直到根节点。

{% highlight java linenos %}
void free(long handle) {
    int memoryMapIdx = memoryMapIdx(handle);
    int bitmapIdx = bitmapIdx(handle);

    // 此处省略页内空间释放逻辑

    // 增加可用空间大小
    freeBytes += runLength(memoryMapIdx);
    // 设置节点 memoryMapIdx 为空闲节点
    setValue(memoryMapIdx, depth(memoryMapIdx));
    // 更新父节点分配信息，直到根节点
    updateParentsFree(memoryMapIdx);
}

// 更新父节点分配信息，直到根节点
private void updateParentsFree(int id) {
    int logChild = depth(id) + 1;
    while (id > 1) {
        // 父节点
        int parentId = id >>> 1;
        // 自身可分配节点深度
        byte val1 = value(id);
        // 兄弟可分配节点深度
        byte val2 = value(id ^ 1);
        // 咱兄弟俩所处的深度
        logChild -= 1; 

        // 咱兄弟俩都已空闲，更新父节点状态为空闲，也就是更新为它自己的深度
        if (val1 == logChild && val2 == logChild) {
            setValue(parentId, (byte) (logChild - 1));
        } 
        // 否则
        else {
            // 取 min(val1, val2) 作为父节点可分配最小深度
            byte val = val1 < val2 ? val1 : val2;
            setValue(parentId, val);
        }
        // 继续往上走，总会到根节点的
        id = parentId;
    }
}
// 取低 32 位
private static int memoryMapIdx(long handle) {
    return (int) handle;
}
// 取高 32 位
private static int bitmapIdx(long handle) {
    return (int) (handle >>> Integer.SIZE);
}
{% endhighlight %}
