---
title: Java 垃圾收集算法：Concurrent Mark and Sweep
layout: posts
categories: java, garbage collection, gc
---

# Java 垃圾收集算法：Concurrent Mark and Sweep

------

## 概述

这个垃圾收集器组合的官方名称叫『基本（Mostly）上并发标记和清除垃圾收集器』。在*年轻代*使用并行`Stop-the-world`的*标记-复制*算法，在*老年代*使用基本上并发*标记-清除*算法。

CMS 是设计来避免在清理*老年代*时的长时间暂停的，它用了 2 个办法。第一，它对*老年代*不做*整理*，而是用*空闲列表*管理回收的空间；第二，*标记-清除*阶段的大部分任务都是和应用本身并发执行，这意味着这个阶段的垃圾收集不会明显的暂停应用。但是要注意，**它任然会和应用线程竞争 CPU 时间**。默认情况下，垃圾收集的线程数为四分之一系统物理 CPU 核心数。

要使用 CMS 垃圾收集算法，你需要像下面这样做：

{% highlight console linenos %}
java -XX:+UseConcMarkSweepGC com.mypackages.MyExecutableClass
{% endhighlight %}

在多核处理器环境下，如果你的首要目标是低延迟，那么 CMS 垃圾收集算法是个不错的选择。降低单个 GC 暂停时长会直接影响到终端用户的应用体验 -- 系统响应很快。但由于大部分时间，总有部分 CPU 资源被 GC 占用而不执行应用代码，因此，通常 CMS 算法在 CPU 密集型应用中的吞吐量会比`Parallel GC`差。

让我们来看看 CMS 算法的垃圾收集日志，它同样包含了 2 次垃圾收集事件：`Minor GC`和`Full GC`。

{% highlight console linenos %}
2015-05-26T16:23:07.219-0200: 64.322: [GC (Allocation Failure) 64.322: [ParNew: 613404K->68068K(613440K), 0.1020465 secs] 10885349K->10880154K(12514816K), 0.1021309 secs] [Times: user=0.78 sys=0.01, real=0.11 secs]
2015-05-26T16:23:07.321-0200: 64.425: [GC (CMS Initial Mark) [1 CMS-initial-mark: 10812086K(11901376K)] 10887844K(12514816K), 0.0001997 secs] [Times: user=0.00 sys=0.00, real=0.00 secs]
2015-05-26T16:23:07.321-0200: 64.425: [CMS-concurrent-mark-start]
2015-05-26T16:23:07.357-0200: 64.460: [CMS-concurrent-mark: 0.035/0.035 secs] [Times: user=0.07 sys=0.00, real=0.03 secs]
2015-05-26T16:23:07.357-0200: 64.460: [CMS-concurrent-preclean-start]
2015-05-26T16:23:07.373-0200: 64.476: [CMS-concurrent-preclean: 0.016/0.016 secs] [Times: user=0.02 sys=0.00, real=0.02 secs]
2015-05-26T16:23:07.373-0200: 64.476: [CMS-concurrent-abortable-preclean-start]
2015-05-26T16:23:08.446-0200: 65.550: [CMS-concurrent-abortable-preclean: 0.167/1.074 secs] [Times: user=0.20 sys=0.00, real=1.07 secs]
2015-05-26T16:23:08.447-0200: 65.550: [GC (CMS Final Remark) [YG occupancy: 387920 K (613440 K)]65.550: [Rescan (parallel) , 0.0085125 secs]65.559: [weak refs processing, 0.0000243 secs]65.559: [class unloading, 0.0013120 secs]65.560: [scrub symbol table, 0.0008345 secs]65.561: [scrub string table, 0.0001759 secs][1 CMS-remark: 10812086K(11901376K)] 11200006K(12514816K), 0.0110730 secs] [Times: user=0.06 sys=0.00, real=0.01 secs]
2015-05-26T16:23:08.458-0200: 65.561: [CMS-concurrent-sweep-start]
2015-05-26T16:23:08.485-0200: 65.588: [CMS-concurrent-sweep: 0.027/0.027 secs] [Times: user=0.03 sys=0.00, real=0.03 secs]
2015-05-26T16:23:08.485-0200: 65.589: [CMS-concurrent-reset-start]
2015-05-26T16:23:08.497-0200: 65.601: [CMS-concurrent-reset: 0.012/0.012 secs] [Times: user=0.01 sys=0.00, real=0.01 secs]
{% endhighlight %}

------

## Minor GC

日志中的第一个 GC 事件是清理*年轻代*的`Minor GC`。我们来看看 CMS 是如何表现的。

> `2015-05-26T16:23:07.219-0200` : `64.322` : [`GC` (`Allocation Failure`) 64.322 : [`ParNew` : `613404K->68068K` `(613440K)`, `0.1020465 secs`] `10885349K->10880154K` `(12514816K)`, `0.1021309 secs`] `[Times: user=0.78 sys=0.01, real=0.11 secs]`
> 
> <br/>
> 
> 1. `2015-05-26T16:23:07.219-0200` -- GC 开始时间。
> 2. `64.322` -- GC 开始时间，相对于 JVM 的启动时间的偏移，单位秒。
> 3. `GC` -- 标志位：*Minor GC*或*Full GC*。本次为*Minor GC*。
> 4. `Allocation Failure` -- 触发垃圾收集的原因。本次为*年轻代*空间不足以分配新对象。
> 5. `ParNew` -- 垃圾收集器名称，这次*年轻代*中使用的是一个叫`ParNew`的并行*标记-复制*且`Stop-the-world`的垃圾收集器，它是设计来和*老年代*垃圾收集器*并行标记-清除*（Concurrent Mark & Sweep）协同工作的。
> 6. `613404K->68068K` -- 垃圾收集前后*年轻代*空间使用量。
> 7. `(613440K)` -- *年轻代*空间大小。
> 8. `0.1020465 secs` -- Duration for the collection w/o final cleanup.
> 9. `10885349K->10880154K` -- 垃圾收集前后堆上空间使用量。
> 10. `(12514816K)` -- 堆大小。
> 11. `0.1021309 secs` -- 垃圾收集器在*年轻代*中标记和复制存活对象花费的时间，包括与 CMS 收集器通信的时间、提升对象到*老年代*需要的时间和一些在垃圾收集结束前的临终清理时间。
> 12. `[Times: user=0.78 sys=0.01, real=0.11 secs]` -- 分类统计的垃圾收集时长：
    * user：垃圾收集中的线程占用的 CPU 总时间
    * sys：系统调用和等待系统事件占用的 CPU 时间
    * real：应用暂停时长。使用`Paralled GC`时，$$real \approx (user + sys)\ /\ countOfThreadsUsedInGC$$，本次 GC 中使用了 8 个线程。要注意，GC 中总有一些操作是不能并行执行的，因此，实际的`real`值一般会比计算出来的值大一些。

从上面的日志可以看出，垃圾收集之前，堆使用量为 10,885,349K，*年轻代*为 613,404K，可以算出*老年代*使用量为 10,271,945K。垃圾收集之后，*年轻代*使用量下降 545,336K，但堆使用量只下降了 5,195K，这说明有 540,141K 的对象从*年轻代*提升到了*老年代*。

![ParallelGC-in-Young-Generation-Java](/images/2018-12-06-ParallelGC-in-Young-Generation-Java.png)

------

## Full GC

现在，既然你们已经能够轻松的分析 GC 日志了，我们将以不同的形式来分析下一个 GC 日志事件。下面很长的日志中包含了*老年代*中的基本上并发垃圾收集事件的所有阶段，我们一个一个的来分析它们。先把整个事件的日志放出来：

{% highlight console linenos %}
2015-05-26T16:23:07.321-0200: 64.425: [GC (CMS Initial Mark) [1 CMS-initial-mark: 10812086K(11901376K)] 10887844K(12514816K), 0.0001997 secs] [Times: user=0.00 sys=0.00, real=0.00 secs]
2015-05-26T16:23:07.321-0200: 64.425: [CMS-concurrent-mark-start]
2015-05-26T16:23:07.357-0200: 64.460: [CMS-concurrent-mark: 0.035/0.035 secs] [Times: user=0.07 sys=0.00, real=0.03 secs]
2015-05-26T16:23:07.357-0200: 64.460: [CMS-concurrent-preclean-start]
2015-05-26T16:23:07.373-0200: 64.476: [CMS-concurrent-preclean: 0.016/0.016 secs] [Times: user=0.02 sys=0.00, real=0.02 secs]
2015-05-26T16:23:07.373-0200: 64.476: [CMS-concurrent-abortable-preclean-start]
2015-05-26T16:23:08.446-0200: 65.550: [CMS-concurrent-abortable-preclean: 0.167/1.074 secs] [Times: user=0.20 sys=0.00, real=1.07 secs]
2015-05-26T16:23:08.447-0200: 65.550: [GC (CMS Final Remark) [YG occupancy: 387920 K (613440 K)]65.550: [Rescan (parallel) , 0.0085125 secs]65.559: [weak refs processing, 0.0000243 secs]65.559: [class unloading, 0.0013120 secs]65.560: [scrub symbol table, 0.0008345 secs]65.561: [scrub string table, 0.0001759 secs][1 CMS-remark: 10812086K(11901376K)] 11200006K(12514816K), 0.0110730 secs] [Times: user=0.06 sys=0.00, real=0.01 secs]
2015-05-26T16:23:08.458-0200: 65.561: [CMS-concurrent-sweep-start]
2015-05-26T16:23:08.485-0200: 65.588: [CMS-concurrent-sweep: 0.027/0.027 secs] [Times: user=0.03 sys=0.00, real=0.03 secs]
2015-05-26T16:23:08.485-0200: 65.589: [CMS-concurrent-reset-start]
2015-05-26T16:23:08.497-0200: 65.601: [CMS-concurrent-reset: 0.012/0.012 secs] [Times: user=0.01 sys=0.00, real=0.01 secs]
{% endhighlight %}

记住，现实中，在*老年代*中的并发垃圾收集进行时，*年轻代*中的`Minor GC`在任何时候都可能发生。此时，它们的日志将会交叉输出。

------

### 阶段一：初始标记

这是 CMS 算法中**两个**需要`Stop-the-world`的阶段之一。本阶段目的是标记*老年代*中的*根对象*和*年轻代*中的部分存活对象引用的对象。后一个目标很重要的原因是*老年代*是**独立**进行垃圾收集的。

![g1-06-591x187](/images/2018-12-06-g1-06-591x187.png)

> `2015-05-26T16:23:07.321-0200 : 64.42` : [GC (`CMS Initial Mark` [1 CMS-initial-mark: `10812086K` `(11901376K)` ] `10887844K` `(12514816K)`, 0.0001997 secs] `[Times: user=0.00 sys=0.00, real=0.00 secs]`
> 
> <br />
>
> 1. `2015-05-26T16:23:07.321-0200 : 64.42` -- GC 启动时间，一个是启动的系统时间，一个是相对于 JVM 启动时间的偏移量。后面几个阶段都是一样的，我们会省去这部分的说明。
> 2. `CMS Initial Mark` -- *初始标记*阶段的标识，本阶段标记所有的*GC 根对象*。
> 3. `10812086K` -- *老年代*使用量。
> 4. `(11901376K)` -- *老年代*空间大小。
> 5. `10887844K` -- 堆使用量。
> 6. `(12514816K)` -- 堆大小。
> 7. `[Times: user=0.00 sys=0.00, real=0.00 secs]` -- 分类统计的本阶段执行时长。

------

### 阶段二：并发标记

本阶段，GC 从上一阶段得到的*根对象*开始，遍历*老年代*对象图并标记所有的存活对象。*并发标记*阶段，就像名称所指的，和应用**并发执行**，不暂停应用线程。要注意，*老年代*中不是所有能被*标记*的都是存活对象，因为应用在*标记*期间可能会动态改变对象引用。

![g1-07](/images/2018-12-07-g1-07-591x187.png)

上图中，`Current Obj`中的引用删除和*标记*线程并发进行。

> 2015-05-26T16:23:07.321-0200: 64.425: [CMS-concurrent-mark-start] 
> 
> 2015-05-26T16:23:07.357-0200: 64.460: [`CMS-concurrent-mark` : `0.035/0.035 secs`] `[Times: user=0.07 sys=0.00, real=0.03 secs]`
> 
> <br />
>
> 1. `CMS-concurrent-mark` -- *并发标记*阶段标识，本阶段遍历*老年代*对象图，标记所有存活对象。
> 2. `0.035/0.035 secs` -- 本阶段执行时长，系统时间和偏移时间。
> 3. `[Times: user=0.07 sys=0.00, real=0.03 secs]` -- 本阶段并发执行，因此这里统计的时间不那么有意义。

------

### 阶段三：并发预清理

这是一个**并发阶段**，与应用线程并行执行，而不是暂停它们。*阶段二*在与应用并发执行的时候，一些引用可能会被改变，这时，JVM 标记那块包含有改变对象的区域为*脏区域*（这项技术称为*卡片标记*）。

![g1-08-591x187](/images/2018-12-08-g1-08-591x187.png)

在*预清理*阶段，会考虑这些脏对象, 并且从它们出发的可达对象也会被*标记*。完成之后卡片会被清理。

![g1-09-591x187](/images/2018-12-08-g1-09-591x187.png)

另外，还会执行一些必须的清理和为*最终标记*阶段的准备工作。

> 2015-05-26T16:23:07.357-0200: 64.460: [CMS-concurrent-preclean-start]
>
>2015-05-26T16:23:07.373-0200: 64.476: [`CMS-concurrent-preclean` : `0.016/0.016 secs`] `[Times: user=0.02 sys=0.00, real=0.02 secs]`
> 
> <br />
>
> 1. `CMS-concurrent-preclean` -- *并发预清理*阶段标识，处理上一阶段依然在变化的那些对象引用。
> 2. `0.016/0.016 secs` -- 本阶段执行时长，系统时间和偏移时间。
> 3. `[Times: user=0.02 sys=0.00, real=0.02 secs]` -- 本阶段并发执行，因此这里统计的时间不那么有意义。

------

### 阶段四：并发可取消式预清理

同样，本阶段为**并发执行阶段**，不会暂停应用线程。这一阶段试图尽可能地为`Stop-the-world`的*最终标记*阶段减轻负担，它的精确执行时长取决于好几个因素，因为它会重复做同样的工作直到满足几个*取消条件*当中的一个，比如重复的次数限制、有效工作量上限、已执行的时长阀值等。

> 2015-05-26T16:23:07.373-0200: 64.476: [CMS-concurrent-abortable-preclean-start]
>
> 2015-05-26T16:23:08.446-0200: 65.550: [`CMS-concurrent-abortable-preclean` : `0.167/1.074 secs`] `[Times: user=0.20 sys=0.00, real=1.07 secs]`
> 
> <br />
>
> 1. `CMS-concurrent-abortable-preclean` -- *并发可取消式预清理*阶段标识。
> 2. `0.167/1.074 secs` -- 本阶段执行时长，user 时间和 real 时间。有趣的是，这里 user 时间比 real 时间小了很多。一般情况下，我们看到的 real 时间总比 user 时间小，那是因为有些工作是并行执行的，因此总耗时小于用户线程的 CPU 占用时长。这里我们的 CPU 占用只有 0.167秒，说明 GC 线程等待了很长一段时间。实际上，这些 GC 线程正在尽可能的延缓执行`Stop-the-world`暂停。默认情况下，最长等待 5 秒。
> 3. `[Times: user=0.20 sys=0.00, real=1.07 secs]` -- 本阶段并发执行，因此这里统计的时间不那么有意义。

这一阶段对下一步*最终标记*阶段`Stop-the-world`的时长影响很大，也有很多的配置参数和失败模式。

------

### 阶段五：最终标记

这是 CMS 算法中第二个也是最后一个`Stop-the-world`的阶段。暂停应用的目的是最终标记*老年代*中所有的存活对象。因为上一阶段是和应用并发执行的，它可能跟不上应用改变对象引用的节奏，还需要一个`Stop-the-world`的暂停来完成最终的存活对象标记。

通常，CMS 算法会在*年轻代*尽可能空闲的情况下去执行*最终标记*阶段，以消除来回多次`Stop-the-world`暂停的可能。

本阶段的日志会比上面几个阶段的看起来更复杂一些：

> 2015-05-26T16:23:08.447-0200: 65.550: [GC (`CMS Final Remark`) [`YG occupancy: 387920 K (613440 K)`]65.550: `[Rescan (parallel) , 0.0085125 secs]` 65.559: `[weak refs processing, 0.0000243 secs] 65.559` : `[class unloading, 0.0013120 secs] 65.560` : `[scrub string table, 0.0001759 secs]` [1 CMS-remark: `10812086K(11901376K)`] `11200006K(12514816K)`, `0.0110730 secs`] `[Times: user=0.06 sys=0.00, real=0.01 secs]`
> 
> <br />
>
> 1. `CMS Final Remark` -- *最终标记*阶段标识，标记*老年代*所有存活对象，包括前几个并发标记阶段中新创建的和修改过的对象引用。
> 2. `YG occupancy: 387920 K (613440 K)` -- *年轻代*的使用量和容量。
> 3. `[Rescan (parallel) , 0.0085125 secs]` -- `Rescan`在应用暂停时完成存活对象标记。这里`Rescan`并行执行，总耗时 0.0085125 秒。
> 4. `[weak refs processing, 0.0000243 secs] 65.559` -- 第一个子阶段，它处理弱引用，耗时 0.0000243 秒，完成时的 JVM 时间偏移 65.559。
> 5. `[class unloading, 0.0013120 secs] 65.560` -- 第二个子阶段，它卸载不再使用的 Java 类，耗时 0.0013120秒，完成时的 JVM 时间偏移 65.560。
> 6. `[scrub string table, 0.0001759 secs]` -- 第三个子阶段，它清理类级别的符号表和内部化的字符串表，耗时 0.0001759 秒。
> 7. `10812086K(11901376K)` -- *老年代*使用量和容量。
> 8. `11200006K(12514816K)` -- 堆使用量和堆大小。
> 9. `0.0110730 secs` -- 本阶段耗时 0.0110730 秒。
> 10. `[Times: user=0.06 sys=0.00, real=0.01 secs]` -- 分类统计的本阶段执行时长。

在上面 5 个标记阶段结束后，*老年代*中所有存活对象都被标记，从现在起，垃圾收集器将会通过清除*老年代*中的无用对象回收空间。

------

### 阶段六：并发清除

本阶段为**并发执行阶段**，不会暂停应用线程。主要目的是清除无用对象，回收空间以待后用。

![g1-10-591x187](/images/2018-12-08-g1-10-591x187.png)

> 2015-05-26T16:23:08.458-0200: 65.561: [CMS-concurrent-sweep-start] 2015-05-26T16:23:08.485-0200: 65.588: [`CMS-concurrent-sweep` : `0.027/0.027 secs`] `[Times: user=0.03 sys=0.00, real=0.03 secs]`
> 
> <br />
>
> 1. `CMS-concurrent-sweep` -- *并发清理*阶段标识，清除未标记的无用对象回收内存。
> 2. `0.027/0.027 secs` -- 本阶段耗时，user 时间和 real 时间。
> 3. `[Times: user=0.03 sys=0.00, real=0.03 secs]` -- 本阶段并发执行，因此这里统计的时间不那么有意义。

------

### 阶段七：并发重置

本阶段为**并发执行阶段**，重置 CMS 算法内部数据结构，为下一次垃圾收集做准备。

> 2015-05-26T16:23:08.485-0200: 65.589: [CMS-concurrent-reset-start] 2015-05-26T16:23:08.497-0200: 65.601: [`CMS-concurrent-reset`: `0.012/0.012 secs`] `[Times: user=0.01 sys=0.00, real=0.01 secs]`
> 
> <br />
>
> 1. `CMS-concurrent-reset` -- *并发重置*阶段标识，本阶段重置 CMS 算法内部数据结构，为下一次垃圾收集做准备。
> 2. `0.012/0.012 secs` -- 本阶段耗时，user 时间和 real 时间。
> 3. `[Times: user=0.01 sys=0.00, real=0.01 secs]` -- 本阶段并发执行，因此这里统计的时间不那么有意义。

------

总而言之，CMS 算法通过把大部分工作放到与应用并发执行的线程中去执行，大大减少了应用暂停时长。但是，它也有缺点，最明显的就是*老年代*空间*碎片化*和在某些场景下，尤其是在堆空间比较大的时候，**应用暂停时长具有不可预测性**。


> 原文地址：[GC Algorithms: Concurrent Mark and Sweep](https://plumbr.io/handbook/garbage-collection-algorithms-implementations#concurrent-mark-and-sweep)。

------

## 相关文章

* [Java 垃圾收集](/garbage-collection-in-java/)
* [Java 垃圾收集算法：基础篇](/garbage-collection-algorithms-basics/)
* [Java 垃圾收集算法：Serial GC](/garbage-collection-algorithms-serial-gc/)
* [Java 垃圾收集算法：Parallel GC](/garbage-collection-algorithms-parallel-gc/)
* [Java 垃圾收集算法：Concurrent Mark and Sweep](/garbage-collection-algorithms-concurrent-mark-and-sweep/)
* [Java 垃圾收集算法：G1](/garbage-collection-algorithms-garbage-first/)