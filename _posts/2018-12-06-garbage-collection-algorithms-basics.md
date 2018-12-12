---
title: Java 垃圾收集算法：基础篇
layout: posts
categories: java, garbage collection, gc
---

# Java 垃圾收集算法：基础篇

-----

在深入垃圾收集（GC）算法的实现细节之前，定义必要的术语和了解一下基本的实现原理是很有好处的。虽然不同的垃圾收集器的具体实现细节有差异，但它们大致上都会聚焦以下 2 个方面：

* 找出所有的存活对象；
* 除去其他对象（推测死亡的和不用的对象）。

第一条中的统计存活对象在所有的垃圾收集器里的实现被称作*标记*阶段。

------

## 标记可达对象（Reachable Objects）

所有现代`GC 算法`都会以找出所有存活对象作为垃圾收集的开始。下面的代表 JVM 内存布局的图片可以很好的解释这个过程。

![Java-GC-mark-and-sweep](/images/2018-12-05-Java-GC-mark-and-sweep.png)

首先，GC 定义一些特定的*垃圾收集根对象*，比如：

* 局部变量和当前执行方法的入参；
* 活动线程；
* 已加载类的静态字段；
* JNI 引用。

然后，GC 遍历内存中的对象引用图，从根对象开始，沿着引用到达其他对象，比如对象的字段引用。所有 GC 访问到的对象被*标记*为存活状态。

在上图中，存活对象以蓝色标注。当*标记*过程结束时，所有的存活对象都会被标记。其他的（灰色的）就是 GC 从根对象开始的不可达对象，也就是说应用已经不能再使用这些不可达对象了，因此，它们被称为垃圾，GC 需要在后面的阶段中移除它们。

*标记*阶段有几个重要的方面要注意：

* *标记*阶段在遍历对象引用图时，应用线程需要被挂起，因为不可能一边修改图的结构，一边遍历图。应用线程临时暂停让 JVM 能够执行内务活动的位置称作*安全点*（Safe Point），导致的结果就是一个称作`Stop The World`的暂停。*安全点*可以因不同的原因被触发，但是垃圾收集是目前为止最常见的一个。
*  暂停的时长不取决于堆中的对象总数或者堆的大小，而是取决于存活对象总数。因此增加堆的大小不会直接影响*标记*阶段的时长。

*标记*阶段结束后，GC 就可以执行下一阶段，开始移除*不可达*对象了。

------

## 移除不用对象(Unused Objects)

不同的 GC 算法移除不用对象的方式不一样，但它们可以被分为 3 种类型：移除型、整理型和复制型。下面我们来分别讨论下它们的更多细节。

### 清除（Sweep）

*标记-清除*算法使用概念上最简单的方式对待垃圾对象--忽略它们。这意味着*标记*阶段结束后，没有访问的对象占用的空间被认为是空闲的，可以分配给新的对象。

这种方法需要使用一种叫做*空闲列表*（free-list）的数据结构来记录每个空闲区域及它们的大小。*空闲列表*的管理会给对象分配带来额外的开销。并且这个方法有一个天生的缺陷：有很多空闲区域，但没有任何单个的区域能够容纳新的对象，对象分配失败，抛出异常`OOME`。

![GC-sweep](/images/2018-12-05-GC-sweep.png)

### 整理（Compact）

*标记-清除-整理*算法通过移动*标记*过的存活对象到内存区域头部的方式解决了*标记-清除*算法的缺陷。坏处是会增加 GC 暂停的时长，因为它需要复制对象到新位置并更新所有到这些对象的引用。好处也很明显，*整理*之后，通过指针碰撞的方式分配新对象的代价非常的轻微。空闲区域的位置总是可知的，且不会有*碎片化*带来的问题。

![GC-mark-sweep-compact](/images/2018-12-05-GC-mark-sweep-compact.png)

### 复制（Copy）

*标记-复制*算法和*标记-整理*算法非常相似，它们都要给存活对象重新分配空间。最大的区别是，重新分配所在的内存区域不同。*标记-复制*的优点是*标记*和*复制*可以同时进行，缺点是需要多一块足够大的内存区域来容纳存活对象。

![GC-mark-and-copy-in-Java](/images/2018-12-05-GC-mark-and-copy-in-Java.png)

> 原文地址：[GC Algorithms: Basics](https://plumbr.io/handbook/garbage-collection-algorithms)。

------

## 相关文章

* [Java 垃圾收集](/garbage-collection-in-java/)
* [Java 垃圾收集算法：基础篇](/garbage-collection-algorithms-basics/)
* [Java 垃圾收集算法：Serial GC](/garbage-collection-algorithms-serial-gc/)
* [Java 垃圾收集算法：Parallel GC](/garbage-collection-algorithms-parallel-gc/)
* [Java 垃圾收集算法：Concurrent Mark and Sweep](/garbage-collection-algorithms-concurrent-mark-and-sweep/)
* [Java 垃圾收集算法：G1](/garbage-collection-algorithms-garbage-first/)