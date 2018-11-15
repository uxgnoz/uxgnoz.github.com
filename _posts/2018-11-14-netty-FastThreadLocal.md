---
title: Netty 之线程本地变量 FastThreadLocal
layout: posts
---

# Netty 之线程本地变量 FastThreadLocal

------

## 综述

Netty 中`FastThreadLocal`用来代替`ThreadLocal`存放*线程本地变量*，从`FastThreadLocalThread`类型的线程中访问*本地变量*时，比使用`ThreadLocal`会有更好的性能。

`FastThreadLocal`使用`InternalThreadLocalMap`存放实际的数据。和`ThreadLocal`实现方式类似，`FastThreadLocalThread`中有一个`InternalThreadLocalMap`类型的字段`threadLocalMap`，这样一个线程对应一个`InternalThreadLocalMap`实例，该线程下所有的*线程本地变量*都会放`threadLocalMap`中的数组`indexedVariables`中。

> *线程本地变量*有时会简写为`TLV`，Thread Local Variables。

------

## InternalThreadLocalMap

`InternalThreadLocalMap`继承了`UnpaddedInternalThreadLocalMap`。

{% highlight java linenos %}
// 普通线程时，使用 ThreadLocal 存放当前线程的 InternalThreadLocalMap 实例
static final 
ThreadLocal<InternalThreadLocalMap> 
slowThreadLocalMap = new ThreadLocal<InternalThreadLocalMap>();
{% endhighlight %}

如果线程类型是`FastThreadLocalThread`，那么直接从线程中获取字段`threadLocalMap`；如果是普通线程，那么从默认的`ThreadLocal`实例`slowThreadLocalMap`中获取当前线程的`InternalThreadLocalMap`实例。

`InternalThreadLocalMap`中使用数组`indexedVariables`来存放*线程本地变量*。构造函数在初始化时，会开辟一个 32 元素的空间，并填充`UNSET`。由`FastThreadLocal`全局 ID `index`的分配特性，*线程本地变量*在数组中**不一定**是连续存放的。

{% highlight java linenos %}
// 数组，FastThreadLocalThread 类线程用来存放本地变量
Object[] indexedVariables;
// 占位符，说明该位置没有被设置过 tlv
public static final Object UNSET = new Object();

private InternalThreadLocalMap() {
    super(newIndexedVariableTable());
}

private static Object[] newIndexedVariableTable() {
    // 初始容量 32
    Object[] array = new Object[32];
    // 填充占位符
    Arrays.fill(array, UNSET);
    return array;
}
{% endhighlight %}

下面这段代码是为了防止*伪共享*。通常 CPU 的*缓存行*一般是 64 或 128 字节，为了防止`InternalThreadLocalMap`的不同实例被加载到同一个*缓存行*，我们需要多余填充一些字段，使得每个实例的大小超出*缓存行*的大小。

{% highlight java linenos %}
// Cache line padding (must be public)
// With CompressedOops enabled, an instance of this class should occupy at least 128 bytes.
public long rp1, rp2, rp3, rp4, rp5, rp6, rp7, rp8, rp9;
{% endhighlight %}

### @getIfSet

静态方法`@getIfSet`从当前线程中拿出`InternalThreadLocalMap`实例，没有则返回`null`。

{% highlight java linenos %}
public static InternalThreadLocalMap getIfSet() {
    // 获取当前线程
    Thread thread = Thread.currentThread();
    if (thread instanceof FastThreadLocalThread) {
        // 线程为 FastThreadLocalThread 类型时，直接返回字段 threadLocalMap
        return ((FastThreadLocalThread) thread).threadLocalMap();
    }
    // 普通线程，从默认的 ThreadLocal 中获取 InternalThreadLocalMap 实例
    return slowThreadLocalMap.get();
}
{% endhighlight %}

### @get

静态方法`@get`从当前线程中拿出`InternalThreadLocalMap`实例，没有初始化一个再返回。

{% highlight java linenos %}
public static InternalThreadLocalMap get() {
    // 获取当前线程
    Thread thread = Thread.currentThread();
    if (thread instanceof FastThreadLocalThread) {
        // 从线程实例中直接获取，没有初始化一个再返回
        return fastGet((FastThreadLocalThread) thread);
    } else {
        // 从 ThreadLocal 中拿，没有初始化一个再返回
        return slowGet();
    }
}
// 从线程实例中直接获取，没有初始化一个再返回
private static InternalThreadLocalMap fastGet(FastThreadLocalThread thread) {
    // 从线程实例中直接获取
    InternalThreadLocalMap threadLocalMap = thread.threadLocalMap();
    if (threadLocalMap == null) {
        // 没有初始化一个
        thread.setThreadLocalMap(threadLocalMap = new InternalThreadLocalMap());
    }
    return threadLocalMap;
}
// 从 ThreadLocal 中拿，没有初始化一个再返回
private static InternalThreadLocalMap slowGet() {
    ThreadLocal<InternalThreadLocalMap> slowThreadLocalMap 
            = UnpaddedInternalThreadLocalMap.slowThreadLocalMap;
    // 从 ThreadLocal 中拿
    InternalThreadLocalMap ret = slowThreadLocalMap.get();
    if (ret == null) {
        // 没有初始化一个
        ret = new InternalThreadLocalMap();
        slowThreadLocalMap.set(ret);
    }
    return ret;
}
{% endhighlight %}

### @nextVariableIndex

返回 JVM 全局唯一递增索引，最大`Integer.Max_Value`。

{% highlight java linenos %}
// in UnpaddedInternalThreadLocalMap
static final AtomicInteger nextIndex = new AtomicInteger();
// InternalThreadLocalMap@nextVariableIndex
public static int nextVariableIndex() {
    int index = nextIndex.getAndIncrement();
    if (index < 0) {
        //  悲剧，溢出了
        nextIndex.decrementAndGet();
        throw new IllegalStateException("too many thread-local indexed variables");
    }
    return index;
}
{% endhighlight %}

### #indexedVariable

从数组`indexedVariables`中获取下标为`index`的元素，下标越界，则返回`UNSET`。

{% highlight java linenos %}
public Object indexedVariable(int index) {
    Object[] lookup = indexedVariables;
    return index < lookup.length ? lookup[index] : UNSET;
}
{% endhighlight %}

### #setIndexedVariable

在指定下标`index`处存放数据，如果原先已经有数据，返回 FALSE，否则说明是第一次存放，返回 TRUE。 当`index`越界时，以大于`index`的*最小 2 的 N 次幂*扩容。

> * 因为初始容量是 32，实际上就是翻倍扩容。
> * 由于`index`的全局唯一性，导致在同一线程中的`FastThreadLocal`实例 ID 不一定连续，因此`index`越界不代表数组就没有空间了，只是这些空间不能被使用。

{% highlight java linenos %}
public boolean setIndexedVariable(int index, Object value) {
    Object[] lookup = indexedVariables;
    if (index < lookup.length) {
        Object oldValue = lookup[index];
        lookup[index] = value;
        // 是否已经有数据
        return oldValue == UNSET;
    } else {
        // 扩容并存放数据
        expandIndexedVariableTableAndSet(index, value);
        // 这种情况下，index 处肯定没有数据
        return true;
    }
}
// 最小 2 的 n 次幂扩容，并在 index 处存放数据
private void expandIndexedVariableTableAndSet(int index, Object value) {
    Object[] oldArray = indexedVariables;
    final int oldCapacity = oldArray.length;
    // 计算最小 2 的 n 次幂
    int newCapacity = index;
    newCapacity |= newCapacity >>>  1;
    newCapacity |= newCapacity >>>  2;
    newCapacity |= newCapacity >>>  4;
    newCapacity |= newCapacity >>>  8;
    newCapacity |= newCapacity >>> 16;
    newCapacity ++;
    // 扩容并拷贝原数据
    Object[] newArray = Arrays.copyOf(oldArray, newCapacity);
    // 无数据部分填充占位符 UNSET
    Arrays.fill(newArray, oldCapacity, newArray.length, UNSET);
    // 存放本次数据
    newArray[index] = value;
    // 设置新数组
    indexedVariables = newArray;
}
{% endhighlight %}

### #removeIndexedVariable

置数组`indexVariables`指定下标`index`处的数据为占位符`UNSET`，并返回原数据。相当于从数组中删除了`index`处的数据。

{% highlight java linenos %}
public Object removeIndexedVariable(int index) {
    Object[] lookup = indexedVariables;
    if (index < lookup.length) {
        Object v = lookup[index];
        lookup[index] = UNSET;
        return v;
    } else {
        return UNSET;
    }
}
{% endhighlight %}

------

## FastThreadLocal

每个`FastThreadLocal`实例在初始化的时候都会被分配一个 JVM 全局唯一 ID：`index`。在获取*线程本地变量*时，使用这个索引。

{% highlight java linenos %}
private static final 
int variablesToRemoveIndex = InternalThreadLocalMap.nextVariableIndex();

public FastThreadLocal() {
    index = InternalThreadLocalMap.nextVariableIndex();
}
{% endhighlight %}

`variablesToRemoveIndex`指定用来存放`FastThreadLocal`实例的集合`variablesToRemove`在`indexedVariables`数组中的位置。集合`variablesToRemove`一般是数组第一个元素，或第一个非`UNSET`元素。

### #get

获取*线程本地变量*，没有就初始化一个值再返回，并把本`FastThreadLocal`实例加入`variablesToRemoveindex`索引的`variablesToRemove`集合。

{% highlight java linenos %}
public final V get() {
    return get(InternalThreadLocalMap.get());
}
// 从 threadLocalMap 获取线程本地变量，threadLocalMap 必须属于当前线程
public final V get(InternalThreadLocalMap threadLocalMap) {
    // 用本 FastThreadLocal 实例的 index 去 indexedVariables 数组中取数据
    Object v = threadLocalMap.indexedVariable(index);
    if (v != InternalThreadLocalMap.UNSET) {
        // 非占位符数据，返回
        return (V) v;
    }
    // 初始化一个返回
    return initialize(threadLocalMap);
}

private V initialize(InternalThreadLocalMap threadLocalMap) {
    V v = null;
    try {
        // 调用子类实现初始化一个值或 null
        v = initialValue();
    } catch (Exception e) {
        PlatformDependent.throwException(e);
    }
    // 放入 indexedVariables 数组
    threadLocalMap.setIndexedVariable(index, v);
    // 添加本实例到 variablesToRemove 集合
    addToVariablesToRemove(threadLocalMap, this);
    return v;
}

// threadLocalMap 必须属于当前线程
private static void addToVariablesToRemove(
        InternalThreadLocalMap threadLocalMap, FastThreadLocal<?> variable) {
    // 从 variablesToRemoveIndex 下标处获取 variablesToRemove 集合
    Object v = threadLocalMap.indexedVariable(variablesToRemoveIndex);
    Set<FastThreadLocal<?>> variablesToRemove;
    if (v == InternalThreadLocalMap.UNSET || v == null) {
        // 本线程第一次添加 tlv，创建 Set 存放本 FastThreadLocal 实例
        variablesToRemove = 
            Collections.newSetFromMap(new IdentityHashMap<FastThreadLocal<?>, Boolean>());

        // Set 本身存放在 variablesToRemoveIndex 指定的位置处
        threadLocalMap.setIndexedVariable(variablesToRemoveIndex, variablesToRemove);
    } else {
        // 非首次添加 tlv
        variablesToRemove = (Set<FastThreadLocal<?>>) v;
    }
    // 加入 FastThreadLocal 实例
    variablesToRemove.add(variable);
}
// 子类可以具体实现初始值
protected V initialValue() throws Exception {
    return null;
}
{% endhighlight %}

### #set

设置*线程本地变量*，并把相关联的`FastThreadLocal`实例放入`indexVariables`数组`variablesToRemoveIndex`下标处的集合中。

当设置的变量为`UNSET`时，删除*线程本地变量*，并把自身从`variablesToRemove`集合中移除。

{% highlight java linenos %}
public final void set(V value) {
    if (value != InternalThreadLocalMap.UNSET) {
        // 非占位符数据
        set(InternalThreadLocalMap.get(), value);
    } else {
        remove();
    }
}
// threadLocalMap 必须属于当前线程
public final void set(InternalThreadLocalMap threadLocalMap, V value) {
    if (value != InternalThreadLocalMap.UNSET) { // 非占位符数据
        // 在 index 出存放 value
        if (threadLocalMap.setIndexedVariable(index, value)) {
            // 第一次存放
            addToVariablesToRemove(threadLocalMap, this);
        }
    } else {
        // 删除*线程本地变量*，并把自身从`variablesToRemove`集合中移除
        remove(threadLocalMap);
    }
}
{% endhighlight %}


### #remove

删除*线程本地变量*，并把自身从`variablesToRemove`集合中移除。

{% highlight java linenos %}
public final void remove() {
    remove(InternalThreadLocalMap.getIfSet());
}

// threadLocalMap 必须属于当前线程
public final void remove(InternalThreadLocalMap threadLocalMap) {
    if (threadLocalMap == null) {
        return;
    }
    // 删除变量
    Object v = threadLocalMap.removeIndexedVariable(index);
    // 删除自身实例
    removeFromVariablesToRemove(threadLocalMap, this);

    if (v != InternalThreadLocalMap.UNSET) {
        try {
            // 移除通知
            onRemoval((V) v);
        } catch (Exception e) {
            PlatformDependent.throwException(e);
        }
    }
}

// 从 threadLocalMap 删除 FastThreadLocal 实例
private static void removeFromVariablesToRemove(
        InternalThreadLocalMap threadLocalMap, FastThreadLocal<?> variable) {

    Object v = threadLocalMap.indexedVariable(variablesToRemoveIndex);

    if (v == InternalThreadLocalMap.UNSET || v == null) {
        // 还没有初始化 variablesToRemove 集合
        return;
    }

    Set<FastThreadLocal<?>> variablesToRemove = (Set<FastThreadLocal<?>>) v;
    // 删除 FastThreadLocal 实例
    variablesToRemove.remove(variable);
}
{% endhighlight %}


