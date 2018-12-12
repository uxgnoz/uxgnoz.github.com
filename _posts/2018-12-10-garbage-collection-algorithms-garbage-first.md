---
title: Java 垃圾收集算法：G1
layout: posts
categories: java, garbage collection, gc
---

# Java 垃圾收集算法：G1

------

## 概述

设计 G1 的核心目标之一就是，GC 的时长和 GC 导致的应用暂停的分布要可控：可预期、可配置。事实上，G1 是一个*软实时*垃圾收集算法，这意味着我们可以设置它的性能指标，比如，1 秒内的 GC 暂停时长不超过 5 毫秒。G1 会努力以大概率达到这个要求，但不是一定，否则就是*硬实时*了。

为了这个目标，G1 有一些独特的实现方式。首先，堆空间不必分割成物理上连续的*年轻代*和*老年代*，而是被分成了多块（通常是2048）存放对象的小区域，每块区域都可能是*伊甸区*，*存活区*或者*老年区*。所有在逻辑上是*伊甸区*和*存活区*的区域集合就是*年轻代*，所有*老年区*的集合就是*老年代*。

![g1-011-591x187.png](/images/2018-12-10-g1-011-591x187.png)

这样，GC 时不需要一次性收集整个堆，而是增量式的去做垃圾收集：一次只处理一部分区域，也就是收集区集合`CSet`。每次暂停都会收集所有*年轻区*，也**可能**会收集部分*老年区*。

![g1-02-591x187.png](/images/2018-12-10-g1-02-591x187.png)

在并发阶段，G1 的另一个创新之处在于它会猜测每块区域中存活对象的数量。在创建`CSet`时候，这点就派上用场了：**包含最多垃圾对象的区域优先被收集**，这也是它名字的由来，Garbage First。

你可以像下面这样为你的 JVM 使用 G1 垃圾收集器。
{% highlight console linenos %}
java -XX:+UseG1GC com.mypackages.MyExecutableClass
{% endhighlight %}

------

## 疏散暂停：年轻模式（Evacuation Pause: Fully Young）

应用启动的初始阶段，G1 还没有从*并发阶段*收集来的附加信息，所以它只能工作在*年轻模式*。当*年轻代*被占满，**应用线程被暂停**，所有*年轻区*中的存活对象被复制到一个或多个*存活区*，或者说数据复制到的空闲区都变成了*存活区*。

复制的过程被称为*疏散*（Evacuation），这和以前*年轻代*的垃圾收集器的工作方式是类似的。*疏散暂停*的全部日志是很大的，简单起见，我们省去部分与*年轻模式*下的*疏散暂停*不相关的部分，在了解过*并发阶段*细节之后，我们再来看它们。此外，我们从日志中抽出*并行阶段*和*其他阶段*的细节到单独的部分去说：

>    `0.134: [GC pause (G1 Evacuation Pause) (young), 0.0144119 secs]` <br />
>    `[Parallel Time: 13.9 ms, GC Workers: 8]` <br />
>        `…` <br />
>    `[Code Root Fixup: 0.0 ms]` <br />
>    `[Code Root Purge: 0.0 ms]` <br />
>    [Clear CT: 0.1 ms] <br />
>    `[Other: 0.4 ms]` <br />
>        `…` <br />
>    `[Eden: 24.0M(24.0M)->0.0B(13.0M)`  `Survivors: 0.0B->3072.0K` `Heap: 24.0M(256.0M)->21.9M(256.0M)]` <br />
>    `[Times: user=0.04 sys=0.04, real=0.02 secs]` <br />
>
>    <br />
>
> 1. `0.134: [GC pause (G1 Evacuation Pause) (young), 0.0144119 secs]` -- 只清理*年轻代*所属区的 G1 *暂停*。*暂停*在 JVM 启动后 0.134 毫秒开始，耗时挂钟时间 0.0144119 秒。
> 2. `[Parallel Time: 13.9 ms, GC Workers: 8]` -- 以下的活动由 8 个工作线程并行执行，耗时挂钟时间 13.9毫秒。
> 3. `…` -- 为了简单，省去了此部分。详情见后文。
> 4. `[Code Root Fixup: 0.0 ms]` -- 清理用来管理并行活动的数据结构，耗时应该总是接近 0 的，串行执行。
> 5. `[Code Root Purge: 0.0 ms]` -- 清理更多的数据结构，也应该很快，但耗时不总是接近 0，串行执行。
> 6. `[Other: 0.4 ms]` -- 其他乱七八糟的活动，很多是并行执行的。
> 7. `…` -- 详情看后文。
> 8. `[Eden: 24.0M(24.0M)->0.0B(13.0M)` -- GC 前后*伊甸区*的使用量和容量。
> 9. `Survivors: 0.0B->3072.0K` -- GC 前后*存活区*所属的区块使用量。
> 10. `Heap: 24.0M(256.0M)->21.9M(256.0M)]` -- GC 前后堆的使用量和容量。
> 11. `[Times: user=0.04 sys=0.04, real=0.02 secs]` -- 分类统计的垃圾收集时长：
    * user：垃圾收集中的线程占用的 CPU 总时间
    * sys：系统调用和等待系统事件占用的 CPU 时间
    * real：应用暂停时长。GC 是并行执行的，$$real \approx (user + sys)\ /\ countOfThreadsUsedInGC$$，本次 GC 中使用了 8 个线程。要注意，GC 中总有一些操作是不能并行执行的，因此，实际的`real`值一般会比计算出来的值大一些。

几个专用的线程执行了大部分的繁重任务，它们的活动看下面的日志描述：

>    `[Parallel Time: 13.9 ms, GC Workers: 8]` <br />
>    `[GC Worker Start (ms)` : Min: 134.0, Avg: 134.1, Max: 134.1, Diff: 0.1] <br />
>    `[Ext Root Scanning (ms)` : Min: 0.1, Avg: 0.2, Max: 0.3, Diff: 0.2, Sum: 1.2] <br />
>    [Update RS (ms): Min: 0.0, Avg: 0.0, Max: 0.0, Diff: 0.0, Sum: 0.0] <br />
>    [Processed Buffers: Min: 0, Avg: 0.0, Max: 0, Diff: 0, Sum: 0] <br />
>    [Scan RS (ms): Min: 0.0, Avg: 0.0, Max: 0.0, Diff: 0.0, Sum: 0.0] <br />
>    `[Code Root Scanning (ms)` : Min: 0.0, Avg: 0.0, Max: 0.2, Diff: 0.2, Sum: 0.2] <br />
>    `[Object Copy (ms)` : Min: 10.8, Avg: 12.1, Max: 12.6, Diff: 1.9, Sum: 96.5] <br />
>    `[Termination (ms)` : Min: 0.8, Avg: 1.5, Max: 2.8, Diff: 1.9, Sum: 12.2] <br />
>    `[Termination Attempts` : Min: 173, Avg: 293.2, Max: 362, Diff: 189, Sum: 2346] <br />
>    `[GC Worker Other (ms)` : Min: 0.0, Avg: 0.0, Max: 0.0, Diff: 0.0, Sum: 0.1] <br />
>    `[GC Worker Total (ms)` : Min: 13.7, Avg: 13.8, Max: 13.8, Diff: 0.1, Sum: 110.2] <br />
>    `[GC Worker End (ms)` : Min: 147.8, Avg: 147.8, Max: 147.8, Diff: 0.0] <br />
>
>  <br />
> 
> 1. `[Parallel Time: 13.9 ms, GC Workers: 8]` -- 以下的活动由 8 个工作线程并行执行，耗时挂钟时间 13.9 毫秒。
> 2. `[GC Worker Start (ms)` -- 各线程启动活动的时间，跟*暂停*的时间是一致的。如果`Min`和`Max`相差太多，说明 GC 线程太多，或者机器上有其他进程在抢占 JVM 的 CPU 执行时间。
> 3. `[Ext Root Scanning (ms)` -- 扫描外部（非堆）*根对象*花费的时间，比如类加载器、JNI 引用、JVM 系统根对象等等。除了`Sum`，其他都为挂钟时间。
> 4. `[Code Root Scanning (ms)` -- 扫描应用代码中的*根对象*花费的时间，比如局部变量等等。
> 5. `[Object Copy (ms)` -- 从`CSet`复制存活对象花费的时间。
> 6. `[Termination (ms)` -- 工作线程为了确保它们可以安全结束，且工作都已完成，然后退出执行所花费的时间。
> 7. `[Termination Attempts` -- 工作线程尝试退出执行的次数。尝试退出失败是指，如果工作线程发现实际上还有工作没有做完，退出失败。
> 8. `[GC Worker Other (ms)` -- 其他乱七八在的小活动，不值一提。
> 9. `[GC Worker Total (ms)` -- 工作线程总耗时。
> 10. `[GC Worker End (ms)` -- 工作线程完成工作的时间。一般它们应该差不太多，否则说明 GC 线程太多，或者机器上有其他进程在抢占 JVM 的 CPU 执行时间。

另外，此阶段还有些`乱七八糟`的处理活动，下面只提了其中一部分，其他的见后文。

>    `[Other: 0.4 ms]` <br />
>    [Choose CSet: 0.0 ms] <br />
>    `[Ref Proc: 0.2 ms]` <br />
>    `[Ref Enq: 0.0 ms]` <br />
>    [Redirty Cards: 0.1 ms] <br />
>    [Humongous Register: 0.0 ms] <br />
>    [Humongous Reclaim: 0.0 ms] <br />
>    `[Free CSet: 0.0 ms]` <br />
> 
> <br />
>
> 1. `[Other: 0.4 ms]` -- 其他小活动耗时，大部分也是并行执行的。
> 2. `[Ref Proc: 0.2 ms]` -- 处理*非强引用*耗时：清理或不清理它们。
> 3. `[Ref Enq: 0.0 ms]` -- 把剩余*非强引用*加入合适的`ReferenceQueue`的耗时。
> 4. `[Free CSet: 0.0 ms]` -- 从`CSet`中返还空闲区域耗时。返还的空闲区域可重新为对象分配空间。

------

## 并发标记（Concurrent Marking）

G1 算法建立在很多 CMS 的概念之上，所以先了解下 [CMS 算法](/garbage-collection-algorithms-concurrent-mark-and-sweep/) 是个不错的主意。虽然它与 CMS 有很多不同，但*并发标记*的目标是相似的。*G1*的*并发标记*使用*初期快照*的方式标记在标记阶段开始时的存活对象--即使它们在标记时已不再存活。基于这些信息，CMS 为每个区域建立存活对象统计，这样就能够在将来更高效地选择`CSet`了。

这些信息可以用来帮助接下来的*老年代*垃圾搜集过程。在两种情况下是完全地并发执行的：一种是如果标记时能确定某些区中全是垃圾时；一种是在处理同时包含垃圾和存活对象的*老年区*的应用暂停期间,。

当堆使用率达到一定数值时，就会触发*并发标记*。默认值为 45%， 但也可以通过 JVM 参数来设置。和 CMS一样, G1 的并发标记也是由多个阶段组成，其中一些是完全并发的，还有一些阶段需要暂停应用线程。

### 阶段一：初始标记（Initial Mark）

本阶段标记所有从*GC 根对象*的直接可达对象。在 CMS 算法中，**初始标记需要暂停应用**，但 G1 通常在*年轻模式* GC 时捎带执行本阶段，因此，开销非常小。你会看到，在*年轻模式*的首行 GC 日志中多了`(initial-mark)`标识：

> 1.631: [GC pause (G1 Evacuation Pause) (young) (initial-mark), 0.0062656 secs]

### 阶段二：根区扫描（Root Region Scan）

本阶段标记从*根区*可达的所有存活对象，所谓*根区*，就是那些在*并发标记*过程中必须执行 GC 的非空区域。因为在*并发标记*的同时移动对象会造成很多麻烦，因此本阶段必须在下一个*年轻模式*暂停到来前结束。如果*年轻模式* GC 必须要提前开始，它会请求提前终止*根区扫描*，并待之结束。在当前实现中，**根区就是所有的存活区**，它们是*年轻代*中的一小部分，在一下个*年轻模式* GC 到来时时肯定执行垃圾收集。

> 1.362: [GC concurrent-root-region-scan-start]   <br />
> 1.364: [GC concurrent-root-region-scan-end, 0.0028513 secs]

### 阶段三：并发标记（Concurrent Mark）

本阶段和 CMS 的相应阶段类似，简单的遍历对象图，在一个特殊的位图中标记访问过的对象。为了确保*初期快照*的语义被满足，G1 要求，应用在对象图上的所有并发更新必须为标记目的保留先前的引用。这是通过使用*写前屏障*（不要与后文的*写后屏障*和并发编程时的*内存屏障*搞混了）实现的。*写前屏障*的功能是，在*并发标记*过程中，当应用线程要修改某个字段引用时，把原先的引用存储到所谓的*日志缓冲区*，并发标记线程会处理这个缓冲区中的数据。

> 1.364: [GC concurrent-mark-start]   <br />
> 1.645: [GC concurrent-mark-end, 0.2803470 secs]

### 阶段四：重新标记（Remark）

**本阶段会暂停应用**，最终完成存活对象标记工作。G1 需要短暂的暂停应用线程，停止往*日志缓冲区*中写入引用更新日志，然后处理缓冲区中现有的日志，标记仍未标记的那些在*并发标记*启动时的存活的对象。本阶段还执行一些附带的清理工作，比如引用处理（见*疏散暂停*日志）或者卸载 Java 类。

> 1.645: [GC remark 1.645: [Finalize Marking, 0.0009461 secs] 1.646: [GC ref-proc, 0.0000417 secs] 1.646: [Unloading, 0.0011301 secs], 0.0074056 secs]
> [Times: user=0.01 sys=0.00, real=0.01 secs]

### 阶段五：清理（Cleanup）

本阶段为下一个*疏散*阶段打基础，统计堆中区域的所有存活对象，并按照期望的 GC 效率排序这些区域。*清理*阶段还要处理所有的为下一个*并发标记*周期维护内部状态所必须的内务工作。

最后，但同样重要的，**本阶段会回收哪些没有存活对象的区域。**

本阶段的部分工作可以和应用并发执行，比如回收空闲区域，大部分的存活对象统计工作，但它也需要一个**短暂的应用暂停**来完成其他所有任务而不受应用线程的影响。暂停的日志类似下面这样的：

> 1.652: [GC cleanup 1213M->1213M(1885M), 0.0030492 secs] [Times: user=0.01 sys=0.00, real=0.00 secs]

如果在堆中发现了一些全是垃圾的区域，日志会有点不同：

> 1.872: [GC cleanup 1357M->173M(1996M), 0.0015664 secs] [Times: user=0.01 sys=0.00, real=0.01 secs]<br />
> 1.874: [GC concurrent-cleanup-start]<br />
> 1.876: [GC concurrent-cleanup-end, 0.0014846 secs]

------

## 疏散暂停：混合模式（Evacuation Pause: Mixed）

*并发标记*的*清理阶段*能够整块整块地释放*老年区*是最理想的情形，但现实很残酷。*并发标记*完成之后，G1 会安排一次*混合模式*的 GC，不只清理*年轻代*，还将清理部分*老年区*。

*并发标记*完成之后，并不一定会立即进行*混合模式*的 GC。有很多规则和启发式算法会影响*混合模式*的启动时机，比如，在*老年代*中，如果可以并发地回收大量的*老年区*（上文中的*阶段五*），那么也就没有必要开启*混合模式*了。

因此，在*并发标记*与*混合模式*之间，很可能会出现多次的*年轻模式*。

添加到`CSet`的*老年区*的具体数目及顺序也同样受到很多规则的约束，包括应用指定的软实时性能指标、*老年区*的活跃度、并发标记时 GC 的表现数据，还有一些可配置的 JVM 选项等等。*混合模式*的 GC 大部分过程和前面的*年轻模式*是一样的，但这里我们还要引入一个概念：`RSet`。

`RSet`让 G1 在不同的区域上可以独立的进行 GC。例如，在 GC 区域 A、B、C 时，我们必须要知道是否有其区域中的对象持有指向其中的引用, 以确定对象的存活状态。但是遍历整个堆很费时，也违背了增量 GC 的初衷，因此必须采取某种优化手段。类似有些 GC 算法的*卡片标记*中使用`Card Table`来支持对年轻代进行独立垃圾收集，G1 中使用的是`RSet`。

如下图所示, 每个区域都有一个`RSet`，包含了从外部指向本区的所有引用。这些引用将被视为附加的*GC 根对象*。要注意，在*并发标记*过程中，*老年代*中被确定为垃圾的对象会被忽略，即使有外部引用指向他们：此时引用对象自身也是垃圾。

![g1-03-591x187](/images/2018-12-11-g1-03-591x187.png)

接下来和其他垃圾收集器一样，多个 GC 线程并行地找出哪些是存活对象，哪些是垃圾对象：

![g1-04-591x187](/images/2018-12-11-g1-04-591x187.png)

最后, 存活对象被移动到*存活区*, 在必要时会为*存活区*加入新的区域。然后空闲区域被释放，可以再次存放新的对象。

![g1-05-v2-591x187](/images/2018-12-11-g1-05-v2-591x187.png)

在应用运行的过程中，为了维护`RSet`，只要应用线程更新某个字段，就会产生一个*写后屏障*。如果更新后的引用是跨区域的，就会在目标区的`RSet`中增加一个对应的卡片。为了降低*写后屏障*的开销，使用异步的方式将卡片放入`RSet`，并且做了很多优化。但基本流程如下: *写后屏障*把脏卡信息存放到本地缓冲区，由专门的 GC 线程负责将之传递给目标区的`RSet`。

*混合模式*下的日志，和*年轻模式*相比，可以发现一些有趣的地方：

> [`Update RS (ms)` : Min: 0.7, Avg: 0.8, Max: 0.9, Diff: 0.2, Sum: 6.1] <br />
> [`Processed Buffers` : Min: 0, Avg: 2.2, Max: 5, Diff: 5, Sum: 18] <br />
> [`Scan RS (ms)`: Min: 0.0, Avg: 0.1, Max: 0.2, Diff: 0.2, Sum: 0.8] <br />
> [`Clear CT: 0.2 ms`] <br />
> [`Redirty Cards: 0.1 ms`] <br />
>
> <br />
>
> 1. `Update RS (ms)` -- 因为`RSet`是并发处理的，要确保在实际的垃圾收集之前，必须先处理完缓冲区中的卡片。如果卡片数量很多，则 GC 并发线程可能因为负载太高而处理不完。这种情况可能由于修改的字段过多，或者 CPU 资源不足而导致的。
> 2. `Processed Buffers` -- 每个工作线程处理本地缓冲区的数目。
> 3. `Scan RS (ms)` -- 扫描`RSet`中的引用花费的时间。
> 4. `Clear CT: 0.2 ms` -- 清理卡片脏状态花费时间。只是简单的修改状态。
> 5. `Redirty Cards: 0.1 ms` -- 标记卡表适当位置状态为脏花费的时间。合适的位置是由 GC 导致的堆内变动所决定的，比如，GC 时把引用加入引用队列。

> 原文地址：[GC Algorithms: Garbage First](https://plumbr.io/handbook/garbage-collection-algorithms-implementations#g1)。

------

## 相关文章

* [Java 垃圾收集](/garbage-collection-in-java/)
* [Java 垃圾收集算法：基础篇](/garbage-collection-algorithms-basics/)
* [Java 垃圾收集算法：Serial GC](/garbage-collection-algorithms-serial-gc/)
* [Java 垃圾收集算法：Parallel GC](/garbage-collection-algorithms-parallel-gc/)
* [Java 垃圾收集算法：Concurrent Mark and Sweep](/garbage-collection-algorithms-concurrent-mark-and-sweep/)
* [Java 垃圾收集算法：G1](/garbage-collection-algorithms-garbage-first/)