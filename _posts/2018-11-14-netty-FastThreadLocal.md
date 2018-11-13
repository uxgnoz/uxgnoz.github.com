---
title: Netty 之线程本地变量 FastThreadLocal
layout: posts
---

# Netty 之线程本地变量 FastThreadLocal

------

## 综述

Netty 中`FastThreadLocal`用来代替`ThreadLocal`存放*线程本地变量*，从`FastThreadLocalThread`类型的线程中访问*本地变量*时，比使用`ThreadLocal`会有更好的性能。

`FastThreadLocal`使用`InternalThreadLocalMap`存放实际的数据。和`ThreadLocal`实现方式类似，`FastThreadLocalThread`中有一个`InternalThreadLocalMap`类型的字段`threadLocalMap`，这样一个线程对应一个`InternalThreadLocalMap`实例，该线程下所有的*线程本地变量*都会放`threadLocalMap`里。

> *线程本地变量*有时会简写为`TLV`，Thread Local Variables。

## InternalThreadLocalMap

`InternalThreadLocalMap`继承了`UnpaddedInternalThreadLocalMap`。

{% highlight java linenos %}
// 普通线程时，使用 ThreadLocal 存放当前线程的 InternalThreadLocalMap 实例
static final 
ThreadLocal<InternalThreadLocalMap> 
slowThreadLocalMap = new ThreadLocal<InternalThreadLocalMap>();
{% endhighlight %}

如果线程类型是`FastThreadLocalThread`，那么直接从线程中获取字段`threadLocalMap`；如果是普通线程，那么从默认的`ThreadLocal`实例`slowThreadLocalMap`中获取当前线程的`InternalThreadLocalMap`实例。

`InternalThreadLocalMap`中使用*数组*来存放*线程本地变量*。
{% highlight java linenos %}
// 数组，FastThreadLocalThread 类线程用来存放本地变量
Object[] indexedVariables;
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

静态方法`@get`从当前线程中拿出`InternalThreadLocalMap`实例，没有则返回`null`。

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

### #indexedVariable

从数组`indexedVariables`中获取下标为`index`的元素，下标越界，则返回`UNSET`。

{% highlight java linenos %}
// 占位符，说明没有被初始化
public static final Object UNSET = new Object();

public Object indexedVariable(int index) {
    Object[] lookup = indexedVariables;
    return index < lookup.length ? lookup[index] : UNSET;
}
{% endhighlight %}

### #setIndexedVariable

设置*线程本地变量*。

{% highlight java linenos %}
public boolean setIndexedVariable(int index, Object value) {
    Object[] lookup = indexedVariables;
    if (index < lookup.length) {
        Object oldValue = lookup[index];
        lookup[index] = value;
        return oldValue == UNSET;
    } else {
        expandIndexedVariableTableAndSet(index, value);
        return true;
    }
}

private void expandIndexedVariableTableAndSet(int index, Object value) {
    Object[] oldArray = indexedVariables;
    final int oldCapacity = oldArray.length;
    int newCapacity = index;
    newCapacity |= newCapacity >>>  1;
    newCapacity |= newCapacity >>>  2;
    newCapacity |= newCapacity >>>  4;
    newCapacity |= newCapacity >>>  8;
    newCapacity |= newCapacity >>> 16;
    newCapacity ++;

    Object[] newArray = Arrays.copyOf(oldArray, newCapacity);
    Arrays.fill(newArray, oldCapacity, newArray.length, UNSET);
    newArray[index] = value;
    indexedVariables = newArray;
}
{% endhighlight %}

------

## FastThreadLocal

### #get

{% highlight java linenos %}
public final V get() {
    return get(InternalThreadLocalMap.get());
}

public final V get(InternalThreadLocalMap threadLocalMap) {
    Object v = threadLocalMap.indexedVariable(index);
    if (v != InternalThreadLocalMap.UNSET) {
        return (V) v;
    }

    return initialize(threadLocalMap);
}

private V initialize(InternalThreadLocalMap threadLocalMap) {
    V v = null;
    try {
        v = initialValue();
    } catch (Exception e) {
        PlatformDependent.throwException(e);
    }

    threadLocalMap.setIndexedVariable(index, v);
    addToVariablesToRemove(threadLocalMap, this);
    return v;
}
private static void addToVariablesToRemove(InternalThreadLocalMap threadLocalMap, FastThreadLocal<?> variable) {
    Object v = threadLocalMap.indexedVariable(variablesToRemoveIndex);
    Set<FastThreadLocal<?>> variablesToRemove;
    if (v == InternalThreadLocalMap.UNSET || v == null) {
        variablesToRemove = Collections.newSetFromMap(new IdentityHashMap<FastThreadLocal<?>, Boolean>());
        threadLocalMap.setIndexedVariable(variablesToRemoveIndex, variablesToRemove);
    } else {
        variablesToRemove = (Set<FastThreadLocal<?>>) v;
    }

    variablesToRemove.add(variable);
}
// 子类可以具体实现初始值
protected V initialValue() throws Exception {
    return null;
}
{% endhighlight %}
{% highlight java linenos %}
{% endhighlight %}
{% highlight java linenos %}
{% endhighlight %}
{% highlight java linenos %}
{% endhighlight %}
{% highlight java linenos %}
{% endhighlight %}
{% highlight java linenos %}
{% endhighlight %}

