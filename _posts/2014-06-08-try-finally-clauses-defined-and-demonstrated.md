---
title: JVM 中 finally 子句介绍
layout: posts
categories: java, jvm
---

# JVM 中 finally 子句介绍

---

欢迎来到“Under The Hood”第七期。本期我们介绍 JVM 处理 finally 子句的方式及相关字节码。你可能需要阅读往期的文章才能更好的理解本文。

## finally 子句

JVM执行Java字节码时，它有几种方式可以退出一个代码块（花括号中间的语句）。其中之一，就是简单的执行完其中所有的语句，然后退出代码块。第二种，JVM可能会在代码块中间的任何一处，遇到像break，continue，return之类的语句，强制它跳出该代码块。第三种，JVM可能会在执行过程中，出现了异常，然后它跳转到匹配的catch子句，或者没有找到相应的catch子句，直接退出当前线程。由于单个代码块有如此多的潜在退出点（exit point），拥有一个简单的方式来表达“无论代码块以什么方式退出，有些事情总能发生”是很值得的。然后就有了try-finally子句。
try-finally子句的用法：

* 把拥有多个退出点的代码块放在try块中，并且
* 把无论try块怎么退出，始终能被执行的代码放在finally块中。

例如：

{% highlight java linenos %}
try {
    // Block of code with multiple exit points
}
finally {
    // Block of code that is always executed when the try block is exited,
    // no matter how the try block is exited
}
{% endhighlight %}

如果try块有多个catch子句与之关联，你就必须把finally子句放在所有catch子句的后面：

{% highlight java linenos %}
try {
    // Block of code with multiple exit points
}
catch (Cold e) {
    System.out.println("Caught cold!");
}
catch (APopFly e) {
    System.out.println("Caught a pop fly!");
}
catch (SomeonesEye e) {
    System.out.println("Caught someone's eye!");
}
finally {
    // Block of code that is always executed when the try block is exited,
    // no matter how the try block is exited.
    System.out.println("Is that something to cheer about?");
}
{% endhighlight %}

在try块的代码执行过程中，先由catch子句负责处理抛出的异常，然后再执行finall子句中的代码。例如，如果上述代码中的try块抛出Cold异常，控制台将会输出如下信息：

{% highlight java linenos %}
Caught cold!
Is that something to cheer about?
{% endhighlight %}

## 字节码中的try-finally子句

在字节码中，finally子句扮演着方法中子程序的角色。在try块和它所关联的catch子句中的每个退出点，代表finally子句的子程序会被调用。一旦最后一条语句执行完成，且没有抛出异常，没有执行return、continue、和break，则finally子句调用结束，子程序返回。JVM从调用子程序的指令后下一条指令继续执行，这样try块就能以适当的方式退出了。

让JVM跳转到子程序的操作码是jsr指令。jsr指令有2个单字节操作数，它们组成子程序入口地址到jsr跳转指令的偏移量。jsr_w指令是jsr的变种，功能和jsr相同，但有4个单字节操作数。当JVM遇到jsr或jsr_w指令，它把返回地址（return address，即jsr或jsr_w指令的下一条指令地址）压入栈中，然后从子程序的入口处继续往下执行。

JVM在子程序完成之后，调用ret指令，从子程序返回。ret指令拥有一个操作数，它是一个索引，指向存储返回地址的本地变量。处理finally子句的操作码总结如下：

| OPCODE        | OPERAND(S)     | DESCRIPTION |  
| :--------     | :-----    | :-----    | 
 | jsr	   |   branchbyte1, branchbyte2	                        |  pushes the return address, branches to offset            | 
 | jsr_w | 	branchbyte1, branchbyte2, branchbyte3, branchbyte4 | 	pushes the return address, branches to wide offset      | 
 | ret	   |   index	                                        |  returns to the address stored in local variable index    | 

不要把子程序和Java里的方法搞混了，Java中的方法会使用不同于子程序的指令集。invokevirtual或invokeonvirtual指令用来处理方法调用，而return，areturn或ireturn指令用来处理方法返回。jsr指令不会导致方法被调用，而会使JVM跳转到同一方法中不同的指令处。类似的，ret指令不会从方法中返回，它让JVM从子程序返回到jsr指令的下一条指令处。实现finally子句的字节码之所以被称为子程序，是因为它们看起来像是单个方法的字节码流中的很小的子程序。

你可能会认为ret指令应该把返回地址从栈中弹出，因为那里是它被jsr指令压入的地方。但是，你错了。

每个子程序的开始，返回地址就被从栈顶弹出，并保存到本地变量中。ret指令会从同一个本地变量获得子程序的返回地址。这种不对称的返回地址使用方式是必须的，因为finall子句（子程序）本身可以抛出异常，或者包含return，break或continue语句。由于这种可能性，被jsr指令压入栈中的返回地址必须立即从栈顶移除，这样当JVM由于break，continue，return语句或抛出的异常而从finally子句中退出时，返回地址就不会依旧保存在栈中。因此，返回地址在子程序执行的开始，就被保存到本地变量中。

作为示例，参考下面的代码，它包含一个拥有break语句的finally子句。无论传给surpriseTheProgrammer()方法的参数是什么，这段代码的结果总是false。

{% highlight java linenos %}
static boolean surpriseTheProgrammer(boolean bVal) {
    while (bVal) {
        try {
            return true;
        }
        finally {
            break;
        }
    }
    return false;
}
{% endhighlight %}

上面的例子显示了，为什么要在子程序的开始处，就把返回地址保存到本地变量中。因为finally子句从break返回，它不会执行ret指令。结果就是JVM不会执行“return true”语句，它会执行break语句，并继续往下执行，结束while循环，执行“return false”。

以break语句退出finally子句的方式，跟以return，continue或者抛出异常的方式退出是一样的。如果finally子句以这四种方式之一退出，子句中的ret指令永远都不会被执行到。鉴于此，ret指令不能保证肯定会被执行，JVM不能指望它去移除栈中的返回地址。因此，返回地址在子程序执行的开始，就被保存到本地变量中。

作为一个完整的例子，请看如下方法，它包含一个有2个退出点的try块。

{% highlight java linenos %}
static int giveMeThatOldFashionedBoolean(boolean bVal) {
    try {
        if (bVal) {
            return 1;
        }
        return 0;
    }
    finally {
        System.out.println("Got old fashioned.");
    }
}
{% endhighlight %}

它的字节码如下：

{% highlight java linenos %}
// The bytecode sequence for the try block:
0 iload_0               // Push local variable 0 (arg passed as divisor)
1 ifeq 11               // Push local variable 1 (arg passed as dividend)
4 iconst_1              // Push int 1
5 istore_3              // Pop an int (the 1), store into local variable 3
6 jsr 24                // Jump to the mini-subroutine for the finally clause
9 iload_3               // Push local variable 3 (the 1)
10 ireturn               // Return int on top of the stack (the 1)
11 iconst_0              // Push int 0
12 istore_3              // Pop an int (the 0), store into local variable 3
13 jsr 24                // Jump to the mini-subroutine for the finally clause
16 iload_3               // Push local variable 3 (the 0)
17 ireturn               // Return int on top of the stack (the 0)
// The bytecode sequence for a catch clause that catches any kind of exception
// thrown from within the try block.
18 astore_1              // Pop the reference to the thrown exception, store
                         // into local variable 1
19 jsr 24                // Jump to the mini-subroutine for the finally clause
22 aload_1               // Push the reference (to the thrown exception) from
                           // local variable 1
23 athrow                // Rethrow the same exception
// The miniature subroutine that implements the finally block.
24 astore_2              // Pop the return address, store it in local variable 2
25 getstatic #8          // Get a reference to java.lang.System.out
28 ldc #1                // Push < string "Got old fashioned." > from the constant pool
30 invokevirtual #7      // Invoke System.out.println()
33 ret 2                 // Return to return address stored in local variable 2
{% endhighlight %}

try块的字节码中含有2个jsr指令，另外一个jsr指令在catch子句中。catch子句是由编译器自动添加的，因为如果在try块执行过程中抛出异常，finally块必须任然被执行。因此catch子句仅仅调用代表finally块的子程序，然后抛出相同的异常。下面所示的giveMeThatOldFashionedBoolean() 方法的异常表说明，0到17行所抛出的任何异常，都由从18行开始的catch子句来处理。

| FROM        | TO     | TARGET |  TYPE |
| :--------     | :-----    | :-----    | :-----    |
 | 0 | 	18 | 	18 | 	any | 

可以看出，finally子句的字节码，以弹出并保存栈顶返回地址到本地变量开始，以从本地变量2中取得返回地址的ret指令返回。

> 译者注：基于字节码校验方面的考量，JVM中的jsr/ret指令在Java 6.0时，已经被移除。

> 原文地址：[Try-finally clauses defined and demonstrated](http://www.javaworld.com/article/2077609/core-java/try-finally-clauses-defined-and-demonstrated.html)。

