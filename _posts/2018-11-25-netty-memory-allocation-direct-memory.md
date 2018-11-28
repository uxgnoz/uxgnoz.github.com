---
title: Netty 之内存分配：堆外内存分配与释放
layout: posts
categories: netty, 内存分配，直接对内存
---

# Netty 之内存分配：堆外内存分配与释放

------

*堆外内存*（也称*直接内存*）的管理是通过`PlatformDependent`类提供的一系列静态方法来实现的，而`PlatformDependent`又依赖于`PlatformDependent0`类提供的方法。

------

## @allocateDirectNoCleaner

通过反射的方式，创建`DirectByteBuffer`实例，并增加分配出去的*直接内存*大小。

使用本方法实例化的`DirectByteBuffer`实例，必须通过`@freeDirectNoCleaner`释放内存，因为没有自带 cleaner 嘛。

{% highlight java linenos %}
public static ByteBuffer allocateDirectNoCleaner(int capacity) {
    // 断言直接内存没有自带的 cleaner 释放
    assert USE_DIRECT_BUFFER_NO_CLEANER;
    // 增加直接内存使用量，超出限制抛 OODM
    incrementMemoryCounter(capacity);
    try {
        return PlatformDependent0.allocateDirectNoCleaner(capacity);
    } catch (Throwable e) {
        // 减少直接内存使用量
        decrementMemoryCounter(capacity);
        throwException(e);
        return null;
    }
}
// 增加直接内存使用量，超出限制抛 OODM
private static void incrementMemoryCounter(int capacity) {
    // 没有自带 cleaner
    if (DIRECT_MEMORY_COUNTER != null) {
        // 自旋，成功或异常为止
        for (;;) {
            // 已使用大小
            long usedMemory = DIRECT_MEMORY_COUNTER.get();
            // 修改后的大小
            long newUsedMemory = usedMemory + capacity;
            // 超出直接内存大小限制，抛出 OODM，GG
            if (newUsedMemory > DIRECT_MEMORY_LIMIT) {
                throw new OutOfDirectMemoryError(...);
            }
            // cas 修改直接内存使用量
            if (DIRECT_MEMORY_COUNTER.compareAndSet(usedMemory, newUsedMemory)) {
                break;
            }
        }
    }
}
// 减少直接内存使用量
private static void decrementMemoryCounter(int capacity) {
    if (DIRECT_MEMORY_COUNTER != null) {
        long usedMemory = DIRECT_MEMORY_COUNTER.addAndGet(-capacity);
        assert usedMemory >= 0;
    }
}
// PlatformDependent0@allocateDirectNoCleaner
// 通过反射，创建直接内存 DirectByteBuffer 实例
static ByteBuffer allocateDirectNoCleaner(int capacity) {
    return newDirectBuffer(UNSAFE.allocateMemory(capacity), capacity);
}
// PlatformDependent0@newDirectBuffer
// 通过反射，创建直接内存 DirectByteBuffer 实例
static ByteBuffer newDirectBuffer(long address, int capacity) {
    // capacity 大于等于 0，否则抛出异常
    ObjectUtil.checkPositiveOrZero(capacity, "capacity");

    try {
        // 通过反射，创建DirectByteBuffer 实例
        return (ByteBuffer) DIRECT_BUFFER_CONSTRUCTOR.newInstance(address, capacity);
    } catch (Throwable cause) {
        // 基本上不会走到这一个不，否则 JVM 就真 GG 了!
        if (cause instanceof Error) {
            throw (Error) cause;
        }
        throw new Error(cause);
    }
}
// DirectByteBuffer 的私有构造函数
// addr: 内存地址
// cap: 内存大小
private DirectByteBuffer(long addr, int cap) {
    super(-1, 0, cap, cap);
    address = addr;
    // 没有 cleaner
    cleaner = null;
    att = null;
}
{% endhighlight %}

------

## @freeDirectNoCleaner

释放通过`@allocateDirectNoCleaner`创建的`DirectByteBuffer`实例。

{% highlight java linenos %}
public static void freeDirectNoCleaner(ByteBuffer buffer) {
    assert USE_DIRECT_BUFFER_NO_CLEANER;

    int capacity = buffer.capacity();
    // 释放给定首地址的内存空间
    PlatformDependent0.freeMemory(PlatformDependent0.directBufferAddress(buffer));
    // 减少直接内存使用量
    decrementMemoryCounter(capacity);
}
// PlatformDependent0@freeMemory
static void freeMemory(long address) {
    // 释放给定首地址的内存空间
    UNSAFE.freeMemory(address);
}
{% endhighlight %}

------

## @freeDirectBuffer

 释放`DirectByteBuffer`实例。如果不是`DirectByteBuffer`实例，啥也不干。

 Java 9之前，使用`DirectByteBuffer`中的`cleaner`释放内存；Java 9+ 之后需要调用`Unsafe`中的`invokeCleaner`方法来释放直接内存。

{% highlight java linenos %}
public static void freeDirectBuffer(ByteBuffer buffer) {
    CLEANER.freeDirectBuffer(buffer);
}
// Before Java 9
private static void freeDirectBuffer0(ByteBuffer buffer) throws Exception {
    final Object cleaner;
    // If CLEANER_FIELD_OFFSET == -1 we need to use reflection to access the cleaner, 
    // otherwise we can use sun.misc.Unsafe.
    if (CLEANER_FIELD_OFFSET == -1) {
        cleaner = CLEANER_FIELD.get(buffer);
    } else {
        cleaner = PlatformDependent0.getObject(buffer, CLEANER_FIELD_OFFSET);
    }
    if (cleaner != null) {
        CLEAN_METHOD.invoke(cleaner);
    }
}
// Java 9+
public void freeDirectBuffer(ByteBuffer buffer) {
    // Try to minimize overhead when there is no SecurityManager present.
    // See https://bugs.openjdk.java.net/browse/JDK-8191053.
    if (System.getSecurityManager() == null) {
        try {
            INVOKE_CLEANER.invoke(PlatformDependent0.UNSAFE, buffer);
        } catch (Throwable cause) {
            PlatformDependent0.throwException(cause);
        }
    } else {
        freeDirectBufferPrivileged(buffer);
    }
}
{% endhighlight %}

------

## @directBufferAddress

通过`Unsafe`获取*直接内存*首地址。`DirectByteBuffer`中的私有变量`address`中存放的是*直接内存*的首地址，我们通过`Unsafe#getLong`去读取`address`的值。

{% highlight java linenos %}
public static long directBufferAddress(ByteBuffer buffer) {
    return PlatformDependent0.directBufferAddress(buffer);
}
// PlatformDependent0@directBufferAddress
static long directBufferAddress(ByteBuffer buffer) {
    // 获取 address 字段中的值，也就是直接内存首地址
    return getLong(buffer, ADDRESS_FIELD_OFFSET);
}
// PlatformDependent0@getLong
private static long getLong(Object object, long fieldOffset) {
    // 获取 fiedlOffset 所代表的字段中的值
    return UNSAFE.getLong(object, fieldOffset);
}
{% endhighlight %}

------ 

## @getByte

获取给定内存地址`address`处的字节数据。其他`@getXXX`类方法都类似。

{% highlight java linenos %}
public static byte getByte(long address) {
    return PlatformDependent0.getByte(address);
}
// PlatformDependent0@getByte
static byte getByte(long address) {
    // 获取内存地址 address 处的字节
    return UNSAFE.getByte(address);
}
{% endhighlight %}

------ 

## @copyMemory

内存复制。从源地址`srcAddr`到目标地址`dstAddr`，复制长度为`length`字节的数据。

Java 9 之前的`Unsafe#copyMemory`没有做`SafePoint`轮询，需要我们主动处理，因此，把整个拷贝分成多次，每次默认最多复制 1MB。Java 9+ 就简单了，因为它内置了`SafePoint`检查。

{% highlight java linenos %}
public static void copyMemory(long srcAddr, long dstAddr, long length) {
    PlatformDependent0.copyMemory(srcAddr, dstAddr, length);
}
// PlatformDependent0@ copyMemory
static void copyMemory(long srcAddr, long dstAddr, long length) {
    if (javaVersion() <= 8) {
        copyMemoryWithSafePointPolling(srcAddr, dstAddr, length);
    } else {
        UNSAFE.copyMemory(srcAddr, dstAddr, length);
    }
}
// PlatformDependent0@copyMemoryWithSafePointPolling
private static 
void copyMemoryWithSafePointPolling(long srcAddr, long dstAddr, long length) {
    while (length > 0) {
        long size = Math.min(length, UNSAFE_COPY_THRESHOLD);
        UNSAFE.copyMemory(srcAddr, dstAddr, size);
        length -= size;
        srcAddr += size;
        dstAddr += size;
    }
}
{% endhighlight %}
{% highlight java linenos %}
{% endhighlight %}
{% highlight java linenos %}
{% endhighlight %}

