---
title: Java 垃圾收集算法：Parallel GC
layout: posts
categories: java, garbage collection, gc
---

# Java 垃圾收集算法：Parallel GC

------

## 概述

这个组合的垃圾收集器使用*标记-复制*的方式清理*年轻代*，使用*标记-清除-整理*的方式清理*老年代*。它们都会触发`Stop-the-world`暂停，挂起应用的全部线程。它们都会使用多线程来运行*标记*和*复制/整理*，这也是`Parallel GC`名字的由来。使用这种方法，垃圾收集的次数会明显减少很多。

垃圾收集时使用的线程数可以通过参数`-XX:ParallelGCThreads=NNN`设置，默认值为系统硬件的 CPU 核心数。

要使用`Parallel GC`，可以选择下面三种方式之一来启动 JVM。

{% highlight console linenos %}
java -XX:+UseParallelGC com.mypackages.MyExecutableClass
java -XX:+UseParallelOldGC com.mypackages.MyExecutableClass
java -XX:+UseParallelGC -XX:+UseParallelOldGC com.mypackages.MyExecutableClass
{% endhighlight %}

在多核 CPU 环境下，如果你得首要目的是增加系统吞吐量，那么`Parallel GC`非常合适。更高的吞吐量是由更高效的资源利用率带来的：

* 垃圾收集时，所有的 CPU 核心并行做垃圾清理，带来了更短的暂停时间；
* 在垃圾收集事件之间，收集器不占用任何资源。

另一方面，因为垃圾收集的所有阶段都不能被打断，`Parallel GC`还是有可能导致长时间的应用暂停。因此，如果低延时是你的首要目标，那么你应该去看看[CMS 垃圾收集算法](/garbage-collection-algorithms-concurrent-mark-and-sweep/)。

让我们来看看使用`Parallel GC`时，垃圾收集日志长什么样，我们能从中得到哪些信息。下面的日志包含了 2 次垃圾收集事件：`Minor GC`和`Full GC`。

{% highlight console linenos %}
2015-05-26T14:27:40.915-0200: 116.115: [GC (Allocation Failure) [PSYoungGen: 2694440K->1305132K(2796544K)] 9556775K->8438926K(11185152K), 0.2406675 secs] [Times: user=1.77 sys=0.01, real=0.24 secs]
2015-05-26T14:27:41.155-0200: 116.356: [Full GC (Ergonomics) [PSYoungGen: 1305132K->0K(2796544K)] [ParOldGen: 7133794K->6597672K(8388608K)] 8438926K->6597672K(11185152K), [Metaspace: 6745K->6745K(1056768K)], 0.9158801 secs] [Times: user=4.49 sys=0.64, real=0.92 secs]
{% endhighlight %}

------

## Minor GC

下面是第一段日志片段，包含了清理*年轻代*的垃圾收集事件信息：

> `2015-05-26T14:27:40.915-0200` : `116.115` : [`GC` (`Allocation Failure`) [`PSYoungGen` : `2694440K->1305132K` `(2796544K)` ] `9556775K->8438926K` `(11185152K)`, `0.2406675 secs`] `[Times: user=1.77 sys=0.01, real=0.24 secs]`
> 
> <br/>
>
> 1. `2015-05-26T14:27:40.915-0200` -- GC 开始时间。
> 2. `116.115` -- GC 开始时间，相对于 JVM 的启动时间的偏移，单位秒。
> 3. `GC` -- 标志位：*Minor GC*或*Full GC*。本次为*Minor GC*。
> 4. `Allocation Failure` -- 触发垃圾收集的原因。本次为*年轻代*空间不足以分配新对象。
> 5. `PSYoungGen` -- 使用的垃圾收集器名称，代表使用的是并行*标记-复制*且`Stop-the-world`的垃圾收集器清理*年轻代*。
> 6. `2694440K->1305132K` -- 垃圾收集前后*年轻代*空间使用量。
> 7. `(2796544K)` -- *年轻代*空间大小。
> 8. `9556775K->8438926K` -- 垃圾收集前后堆上空间使用量。
> 9. `(11185152K)` -- 堆大小。
> 10. `0.2406675 secs` -- 垃圾收集时长，单位秒。
> 11. `[Times: user=1.77 sys=0.01, real=0.24 secs]` -- 分类统计的垃圾收集时长：
    * user：垃圾收集中的线程占用的 CPU 总时间
    * sys：系统调用和等待系统事件占用的 CPU 时间
    * real：应用暂停时长。使用`Paralled GC`时，$$real \approx (user + sys)\ /\ countOfThreadsUsedInGC$$，本次 GC 中使用了 8 个线程。要注意，GC 中总有一些操作是不能并行执行的，因此，实际的`real`值一般会比计算出来的值大一些。


总之，垃圾收集之前堆的使用量为 9,556,775K，其中*年轻代*使用量为 2,694,440K，那么可算出*老年代*使用量为 6,862,335K。垃圾收集之后，*年轻代*使用量下降了 1,389,308K，但堆的使用量只下降了 1,117,849K，意味着有 271,459K的对象从*年轻代*提升到了*老年代*。

![ParallelGC-in-Young-Generation-Java](/images/2018-12-06-ParallelGC-in-Young-Generation-Java.png)

------

## Full GC

了解了上面清理*年轻代*的垃圾收集日志，下面通过分析第二段日志看看整个堆是怎么被清理的。

> `2015-05-26T14:27:41.155-0200` : `116.356` : [`Full GC` (`Ergonomics`) `[PSYoungGen: 1305132K->0K(2796544K)]` [`ParOldGen` : `7133794K->6597672K` `(8388608K)`] `8438926K->6597672K` `(11185152K)`,  `[Metaspace: 6745K->6745K(1056768K)]`, `0.9158801 secs`, `[Times: user=4.49 sys=0.64, real=0.92 secs]`
> 
> <br/>
>
> 1. `2015-05-26T14:27:41.155-0200` -- GC 开始时间。
> 2. `116.356` -- GC 开始时间，相对于 JVM 的启动时间的偏移，单位秒。
> 3. `Full GC` -- 标志位：`Minor GC`或`Full GC`。本次为清理*年轻代*和*老年代*的`Full GC`。
> 4. `Ergonomics` -- GC 发生的原因。`Ergonomics`表明 JVM 觉得是时候做些垃圾清理工作了。
> 5. `[PSYoungGen: 1305132K->0K(2796544K)]` -- 跟上面的例子类似，它是一个叫`PSYoungGen`的并发*标记-复制*且`Stop-the-world`的垃圾收集器。*年轻代*的使用量降到了 0，这也是`Full GC`的一般结果。
> 6. `ParOldGen` -- 清理*老年代*的垃圾收集器类型。这是一个叫`ParOldGen`的并行*标记-清除-整理*且`Stop-the-world`的垃圾收集器。
> 7. `7133794K->6597672K` -- 垃圾收集前后*老年代*使用量。
> 8. `(8388608K)` -- *老年代*空间大小。
> 9. `8438926K->6597672K` -- 垃圾收集前后堆上空间使用量。
> 10. `(11185152K)` -- 堆大小。
> 11. `[Metaspace: 6745K->6745K(1056768K)]` -- 垃圾收集前后*元数据区*使用量。这里没有变化。
> 12. `0.9158801 secs` -- 垃圾收集时长，单位秒。
> 13. `[Times: user=4.49 sys=0.64, real=0.92 secs]` -- 分类统计的垃圾收集时长：
    * user：垃圾收集中的线程占用的 CPU 总时间
    * sys：系统调用和等待系统事件占用的 CPU 时间
    * real：应用暂停时长。使用`Paralled GC`时，$$real \approx (user + sys)\ /\ countOfThreadsUsedInGC$$，本次 GC 中使用了 8 个线程。要注意，GC 中总有一些操作是不能并行执行的，因此，实际的`real`值一般会比计算出来的值大一些。

*Full GC*跟*Minor GC*的区别很明显 -- 除了*年轻代*，*老年代*和*元数据区*同样被清理了。下图示意了*Full GC*前后内存使用情况。

![Java-ParallelGC-in-Old-Generation](/images/2018-12-06-Java-ParallelGC-in-Old-Generation.png)

> 原文地址：[GC Algorithms: Parallel GC](https://plumbr.io/handbook/garbage-collection-algorithms-implementations#parallel-gc)。


------

## 相关文章

* [Java 垃圾收集](/garbage-collection-in-java/)
* [Java 垃圾收集算法：基础篇](/garbage-collection-algorithms-basics/)
* [Java 垃圾收集算法：Serial GC](/garbage-collection-algorithms-serial-gc/)
* [Java 垃圾收集算法：Parallel GC](/garbage-collection-algorithms-parallel-gc/)
* [Java 垃圾收集算法：Concurrent Mark and Sweep](/garbage-collection-algorithms-concurrent-mark-and-sweep/)
* [Java 垃圾收集算法：G1](/garbage-collection-algorithms-garbage-first/)