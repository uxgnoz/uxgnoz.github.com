---
title: Java 垃圾收集算法：Serial GC
layout: posts
categories: java, garbage collection, gc
---

# Java 垃圾收集算法：Serial GC

------

## 概述

这个组合的垃圾收集器使用*标记-复制*的方式清理*年轻代*，使用*标记-清除-整理*的方式清理*老年代*。正如名字所指，这些收集器都是单线程的，不能并行处理。它们也都会触发`Stop-the-world`暂停，挂起应用的全部线程。

`Serial GC`算法不能发挥出现代多核处理器的优势，因为它不依赖与 CPU 核心数，在垃圾收集时**仅仅使用一个核心**。

要为*年轻代*和*老年代*使用这种垃圾收集器，只需要在 JVM 启动脚本中加入一个参数就行：

{% highlight bash linenos %}
java -XX:+UseSerialGC com.mypackages.MyExecutableClass
{% endhighlight %}

`Serial GC`算法对运行在单核 CPU 且堆只有几百兆字节的 JVM 来说是合理并推荐使用的。对绝大部分部署在服务端的 JVM 来说，这是非常少见的。因为大部分服务端 JVM 都会部署在多核处理器环境下，选择`Serial GC`算法，就等于人为设置系统资源利用上限。这会导致资源空闲，而如果充分利用这些资源原本是可以降低延迟或增加系统吞吐量的。 

让我们来看看当使用`Serial GC`算法时垃圾收集的处理日志，并看看能从中获得哪些有用的信息。为此，我们需要开启 GC 日志。

{% highlight bash linenos %}
-XX:+PrintGCDetails -XX:+PrintGCDateStamps -XX:+PrintGCTimeStamps
{% endhighlight %}

日志输出：

{% highlight bash linenos %}
2015-05-26T14:45:37.987-0200: 151.126: [GC (Allocation Failure) 151.126: [DefNew: 629119K->69888K(629120K), 0.0584157 secs] 1619346K->1273247K(2027264K), 0.0585007 secs] [Times: user=0.06 sys=0.00, real=0.06 secs]
2015-05-26T14:45:59.690-0200: 172.829: [GC (Allocation Failure) 172.829: [DefNew: 629120K->629120K(629120K), 0.0000372 secs]172.829: [Tenured: 1203359K->755802K(1398144K), 0.1855567 secs] 1832479K->755802K(2027264K), [Metaspace: 6741K->6741K(1056768K)], 0.1856954 secs] [Times: user=0.18 sys=0.00, real=0.18 secs]
{% endhighlight %}

这点 GC 日志片段展示了很多 JVM 内部所发生的事情。事实上，这两条日志中发生了 2 次垃圾收集事件，一个清理了*年轻代*，一个清理了整个堆。我们先来看看发生在*年轻代*的第一个事件。

------

## Minor GC

下面的日志片段包含了清理*年轻代*的垃圾收集事件信息：

> `2015-05-26T14:45:37.987-0200` : `151.126` : [`GC` ( `Allocation Failure` ) 151.126 : [`DefNew` : `629119K -> 69888K` `(629120K)`, 0.0584157 secs] `1619346K -> 1273247K` `(2027264K)`, `0.0585007 secs`] `[Times: user=0.06 sys=0.00, real=0.06 secs]`
>
> <br/>
>
> 1. `2015-05-26T14:45:37.987-0200` -- GC 开始时间。
> 2. `151.126` -- GC 开始时间，相对于 JVM 的启动时间的偏移，单位秒。
> 3. `GC` -- 标志位：*Minor GC*或*Full GC*。本次为*Minor GC*。
> 4. `Allocation Failure` -- 触发垃圾收集的原因。本次为*年轻代*空间不足以分配新对象。
> 5. `DefNew` -- 使用的垃圾收集器名称。这里使用单线程*标记-复制*且`Stop-the-world`垃圾收集器清理*年轻代*。
> 6. `629119K -> 69888K` -- 垃圾收集前后*年轻代*空间使用量。
> 7. `(629120K)` -- *年轻代*空间大小。
> 8. `1619346K -> 1273247K` -- 垃圾收集前后堆上空间使用量。
> 9. `(2027264K)` -- 堆大小。
> 10. `0.0585007 secs` -- 垃圾收集时长，单位秒。
> 11. `[Times: user=0.06 sys=0.00, real=0.06 secs]` -- 分类统计的垃圾收集时长：
    * user：垃圾收集中的线程占用的 CPU 总时间
    * sys：系统调用和等待系统事件占用的 CPU 时间
    * real：应用暂停时长。由于*Serial GC*是单线程的，因此 $$real = user + sys$$。

从上面的日志我们可以洞悉在垃圾收集时 JVM 中内存使用的变化情况。垃圾收集之前，堆空间使用量为 1,619,346K，其中*年轻代*使用了 629,119K，我们可以计算出*老年代*的使用量为 990,227K。

一个更重要的结论影藏在下一批数据之中，它表明，垃圾收集之后，*年轻代*使用量下降了 559,231K，但是堆的使用量仅下降了 346,099K。从这里我们可推出**有 213,132K 的对象从*年轻代*提升到了*老年代***。

下图示意了垃圾收集前后的内存使用情况。

![serial-gc-in-young-generation](/images/2018-12-06-serial-gc-in-young-generation.png)

------

## Full GC

理解了*Minor GC*事件之后，我们来看看*Full GC*事件日志片段：

> `15-05-26T14:45:59.690-0200` : `172.829` : [GC (Allocation Failure) 172.829: `[DefNew: 629120K->629120K(629120K), 0.0000372 secs]` 172.829 : [`Tenured` : `1203359K->755802K` `(1398144K)`, `0.1855567 secs`] `1832479K->755802K` `(2027264K)`, `[Metaspace: 6741K->6741K(1056768K)]` `[Times: user=0.18 sys=0.00, real=0.18 secs]`
> 
> <br/>
>
> 1. `15-05-26T14:45:59.690-0200` -- GC 开始时间。
> 2. `172.829` -- GC 开始时间，相对于 JVM 的启动时间的偏移，单位秒。
> 3. `[DefNew: 629120K->629120K(629120K), 0.0000372 secs]` -- *年轻代*中由于对象分配失败而触发一次*Minor GC*，运行了和上面日志中同样的叫`DefNew`的收集器，它把*年轻代*的使用量从 629,120K 降到 0。注意，**JVM 由于 bug 而导致日志有误**：日志说*年轻代*空间被用完了。*Minor GC*花费了 0.0000372 秒。
> 4. `Tenured` -- 清理*老年代*的垃圾收集器名称。`Tenured`这个名称说明使用了单线程*标记-清除-整理*且`Stop-the-world`的垃圾收集器。
> 5. `1203359K->755802K` -- 垃圾收集前后*老年代*的空间使用量。
> 6. `(1398144K)` -- *老年代*空间大小。
> 7. `0.1855567 secs` -- *老年代*垃圾清理时长。
> 8. `1832479K->755802K` -- 清理*年轻代*和*老年代*前后堆上空间使用量。
> 9. `(2027264K)` -- 堆大小。
> 10. `[Metaspace: 6741K->6741K(1056768K)]` -- *元数据区*垃圾收集信息，本次垃圾回收事件在*元数据区*没有建树。
> 11. `[Times: user=0.18 sys=0.00, real=0.18 secs]` -- 分类统计的垃圾收集时长：
    * user：垃圾收集中的线程占用的 CPU 总时间
    * sys：系统调用和等待系统事件占用的 CPU 时间
    * real：应用暂停时长。由于*Serial GC*是单线程的，因此 $$real = user + sys$$。

*Full GC*跟*Minor GC*的区别很明显 -- 除了*年轻代*，*老年代*和*元数据区*同样被清理了。下图示意了*Full GC*前后内存使用情况。

![serial-gc-in-old-gen-java](/images/2018-12-06-serial-gc-in-old-gen-java.png)

> 原文地址：[GC Algorithms: Basics](https://plumbr.io/handbook/garbage-collection-algorithms-implementations#serial-gc)。


------

## 相关文章

* [Java 垃圾收集](/garbage-collection-in-java/)
* [Java 垃圾收集算法：基础篇](/garbage-collection-algorithms-basics/)
* [Java 垃圾收集算法：Serial GC](/garbage-collection-algorithms-serial-gc/)
* [Java 垃圾收集算法：Parallel GC](/garbage-collection-algorithms-parallel-gc/)
* [Java 垃圾收集算法：Concurrent Mark and Sweep](/garbage-collection-algorithms-concurrent-mark-and-sweep/)
* [Java 垃圾收集算法：G1](/garbage-collection-algorithms-garbage-first/)
