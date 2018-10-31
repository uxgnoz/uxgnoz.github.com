---
title: JVM 中的异常处理
layout: posts
categories: java, jvm
---

# JVM 中的异常处理

---

欢迎来到“Under The Hood”第六期。本期我们介绍 [JVM 处理异常的方式](/how-the-Java-virtual-machine-handles-exceptions/)，包括如何抛出和捕获异常及相关的字节码指令。但本文不会讨论finally子句，这是下期的主题。你可能需要阅读往期的文章才能更好的理解本文。

## 异常处理

在程序运行时，异常让你可以平滑的处理意外状况。为了演示JVM处理异常的方式，考虑NitPickyMath类，它提供对整数进行加，减，乘，除以及取余的操作。
NitPickyMath提供的这些操作和Java语言的“+”，“-”，“*”，“/”和“%”是一样的，除了NitPickyMath中的方法在以下情况下会抛出检查型（checked）异常：上溢出，下溢出以及被0除。0做除数时，JVM会抛出ArithmeticException异常，但是上溢出和下溢出不会引发任何异常。NitPickyMath中抛出异常的方法定义如下：

{% highlight java linenos %}
class OverflowException extends Exception {
}
class UnderflowException extends Exception {
}
class DivideByZeroException extends Exception {
}
{% endhighlight %}

NitPickyMath类中的remainder()方法就是一个抛出和捕获异常的简单方法。

{% highlight java linenos %}
static int remainder(int dividend, int divisor)
    throws DivideByZeroException {
    try {
        return dividend % divisor;
    }
    catch (ArithmeticException e) {
        throw new DivideByZeroException();
    }
}
{% endhighlight %}

remainder()方法，只是简单的对当作参数传递进来的2个整数进行取余操作。如果取余操作的除数是0，会引发ArithmeticException异常。remainder()方法捕获这个异常，并重新抛出DivideByZeroException异常。

DivideByZeroException和ArithmeticException的区别是，DivideByZeroException是检查型（checked）异常，而ArithmeticException是非检查（unchecked）型异常。由于ArithmeticException是非检查型异常，一个方法就算会抛出该异常，也不必在其throw子句中声明它。任何Error或RuntimeException异常的子类异常都是非检查型异常。（ArithmeticException就是RuntimeException的子类。）通过捕获ArithmeticException和抛出DivideByZeroException，remainder()方法强迫它的调用者去处理除数为0的可能性，要么捕获它，要么在其throw子句中声明DivideByZeroException异常。这是因为，像DivideByZeroException这种在方法中抛出的检查型异常，要么在方法中捕获，要么在其throw子句中声明，二者必选其一。而像ArithmeticException这种非检查型异常，就不需要去显式捕获和声明。

javac为remainder()方法生成的字节码序列如下：

{% highlight java linenos %}
// The main bytecode sequence for remainder:
0 iload_0               // Push local variable 0 (arg passed as divisor)
1 iload_1               // Push local variable 1 (arg passed as dividend)
2 irem                  // Pop divisor, pop dividend, push remainder
3 ireturn               // Return int on top of stack (the remainder)
// The bytecode sequence for the catch (ArithmeticException) clause:
4 pop                   // Pop the reference to the ArithmeticException
                        // because it is not used by this catch clause.
5 new #5 < Class DivideByZeroException >
                        // Create and push reference to new object of class
                        // DivideByZeroException.
8 dup                   // Duplicate the reference to the new
                        // object on the top of the stack because it
                        // must be both initialized
                        // and thrown. The initialization will consume
                        // the copy of the reference created by the dup.
9 invokenonvirtual #9 < Method DivideByZeroException.< init >()V >
                        // Call the constructor for the DivideByZeroException
                        // to initialize it. This instruction
                        // will pop the top reference to the object.
12 athrow               // Pop the reference to a Throwable object, in this
                        // case the DivideByZeroException,
                        // and throw the exception.
{% endhighlight %}   

remainder()方法的字节码有2个单独的部分。第一部分是该方法的正常执行路径，这部分从第0行开始，到第3行结束。第二部分是从第4行开始，到12行结束的catch子句。

主字节码序列中的irem指令可能会抛出ArithmeticException异常。如果异常发生了，JVM通过在异常表中查找匹配的异常，它会知道要跳转到相应的异常处理的catch子句的字节码序列部分。每个捕获异常的方法，都跟类文件中与方法字节码一起交付的异常表关联。每一个捕获异常的try块，都是异常表中的一行。每行4条信息：开始行号（from）和结束行号（to），要跳转的字节码序列行号（target），被捕获的异常类的常量池索引（type）。remainder()方法的异常表如下所示：

| FROM        | TO     | TARGET |  TYPE |
| :--------     | :-----    | :-----    | :-----    |
 | 0	 | 4 | 	4	 | < Class java.lang.ArithmeticException > | 
 
上面的异常表表明，行号1到3范围内，ArithmeticException将被捕获。异常表中的“to”下面的结束行号始终比异常捕获的最大行号大1，上表中，结束行号为4，而异常捕获的最大行号是3。行号0到3的字节码序列对应remainder()方法中的try块。“target”列中，是行0到3的字节码发生ArithmeticException异常时要跳转到的目标行号。

如果方法执行过程中产生了异常，JVM会在异常表中查找匹配行。异常表中的匹配行要符合下面的条件：当前pc寄存器的值要在该行的表示范围之内，[from, to)，且产生的异常是该行所指定的异常类或其子类。JVM按从上到下的次序查找异常表。当找到了第一个匹配行，JVM把pc寄存器设为新的跳转行号，从此行继续往下执行。如果找不到匹配行，JVM弹出当前栈帧，并重新抛出同一个异常。当JVM弹出当前栈帧时，它会终止当前方法的执行，返回到调用该方法的上一个方法那里。这时，在上一个方法里，并不会继续正常的执行过程，而是抛出同样的异常，促使JVM重新查找该方法的异常表。

Java程序员可以用throw语句抛出像remainder()方法的catch子句中的异常，DivideByZeroException。下表列出了抛出异常的字节码：

| OPCODE        | OPERAND(S)     | DESCRIPTION |  
| :--------     | :-----    | :-----    | 
 | athrow	 | (none) | 	pops Throwable object reference, throws the exception | 
 
athrow指令把栈顶元素弹出，该元素必须是Throwable的子类或其自身的对象引用，而抛出的异常类型由栈顶弹出的对象引用所指明。

> 原文地址：[How the Java virtual machine handles exceptions](http://www.javaworld.com/article/2076868/learn-java/how-the-java-virtual-machine-handles-exceptions.html)。