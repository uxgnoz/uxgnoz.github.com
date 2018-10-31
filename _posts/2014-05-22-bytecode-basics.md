---
title: 字节码基础：JVM 字节码初探
layout: posts
categories: java, jvm
---

# 字节码基础：JVM字节码初探

---

欢迎来到“Under The Hood“第三期。前两期我们分别介绍了 [JVM 的基本结构和功能](/the-lean-mean-virtual-machine/)和[Java类文件的基本结构](/the-java-class-file-lifestyle/)，本期的主要内容有：字节码所操作的原始类型、类型转换的字节码，以及操作JVM栈的字节码。

## 字节码格式

字节码是JVM的机器语言。JVM加载类文件时，对类中的每个方法，它都会得到一个字节码流。这些字节码流保存在JVM的方法区中。在程序运行过程中，当一个方法被调用时，它的字节码流就会被执行。根据特定JVM设计者的选择，它们可以通过解释的方式，即时编译（Just-in-time compilation）的方式或其他技术的方式被执行。

方法的字节码流就是JVM的指令（instruction）序列。每条指令包含一个单字节的操作码（opcode）和0个或多个操作数（operand）。操作码指明要执行的操作。如果JVM在执行操作前，需要更多的信息，这些信息会以0个或多个操作数的方式，紧跟在操作码的后面。

每种类型的操作码都有一个助记符（mnemonic）。类似典型的汇编语言风格，Java字节码流可以用它们的助记符和紧跟在后面的操作数来表示。例如，下面的字节码流可以分解成多个助记符的形式。

{% highlight java linenos %}
// 字节码流: 03 3b 84 00 01 1a 05 68 3b a7 ff f9
// 分解后:
iconst_0      // 03
istore_0      // 3b
iinc 0, 1     // 84 00 01
iload_0       // 1a
iconst_2      // 05
imul          // 68
istore_0      // 3b
goto -7       // a7 ff f9
{% endhighlight %}

字节码指令集被设计的很紧凑。除了处理跳表的2条指令以外，所有的指令都以字节边界对齐。操作码的总数很少，一个字节就能搞定。这最小化了JVM加载前，通过网络传输的类文件的大小；也使得JVM可以维持很小的实现。

JVM中，所有的计算都是围绕栈（stack）而展开的。因为JVM没有存储任意数值的寄存器（register），所有的操作数在计算开始之前，都必须先压入栈中。因此，字节码指令主要是用来操作栈的。例如，在上面的字节码序列中，通过iload_0先把本地变量（local variable）入栈，然后用iconst_2把数字2入栈的方式，来计算本地变量乘以2。两个整数都入栈之后，imul指令有效的从栈中弹出它们，然后做乘法，最后把运算结果压入栈中。istore_0指令把结果从栈顶弹出，保存回本地变量。JVM被设计成基于栈，而不是寄存器的机器，这使得它在如80486寄存器架构不佳的处理器上，也能被高效的实现。

## 原始类型（primitive types）

JVM支持7种原始数据类型。Java程序员可以声明和使用这些数据类型的变量，而Java字节码，处理这些数据类型。下表列出了这7种原始数据类型：

| 类型        | 定义     |        
| :--------     | :-----    | 
 | byte	   | 单字节有符号二进制补码整数      | 
 | short   | 2字节有符号二进制补码整数          | 
 | int	   | 4字节有符号二进制补码整数       | 
 | long	   | 8字节有符号二进制补码整数        | 
 | float   | 4字节IEEE 754单精度浮点数      | 
 | double  | 8字节IEEE 754双精度浮点数  | 
 | char	   | 2字节无符号Unicode字符      | 

原始数据类型以操作数的方式出现在字节码流中。所有长度超过1字节的原始类型，都以大端（big-endian）的方式保存在字节码流中，这意味着高位字节出现在低位字节之前。例如，为了把常量值256（0×0100）压入栈中，你可以用sipush操作码，后跟一个短操作数。短操作数会以“01 00”的方式出现在字节码流中，因为JVM是大端的。如果JVM是小端（little-endian）的，短操作数将会是“00 01”。

{% highlight java linenos %}
// Bytecode stream: 17 01 00
// Dissassembly:
sipush 256;      // 17 01 00
{% endhighlight %}

## 把常量（constants）压入栈中

很多操作码都可以把常量压入栈中。操作码以3中不同的方式指定入栈的常量值：由操作码隐式指明，作为操作数跟在操作码之后，或者从常量池（constant pool）中获取。

有些操作码本身就指明了要入栈的数据类型和常量数值。例如，iconst_1告诉JVM把整数1压入栈中。这种操作码，是为不同类型而经常入栈的数值而定义的。它们在字节码流中只占用1个字节，增进了字节码的执行效率，并减小了字节码流的大小。下表列出了int型和float型的操作码：

| 操作码        | 操作数     |  描述  |
| --------     | :-----   | :----  |
 | iconst_m1 | 	(none) | 	pushes int -1 onto the stack    | 
 | iconst_0 | 	(none) | 	pushes int 0 onto the stack     | 
 | iconst_1 | 	(none) | 	pushes int 1 onto the stack     | 
 | iconst_2 | 	(none) | 	pushes int 2 onto the stack     | 
 | iconst_3 | 	(none) | 	pushes int 3 onto the stack     | 
 | iconst_4 | 	(none) | 	pushes int 4 onto the stack     | 
 | iconst_5 | 	(none) | 	pushes int 5 onto the stack     | 
 | fconst_0 | 	(none) | 	pushes float 0 onto the stack   | 
 | fconst_1 | 	(none) | 	pushes float 1 onto the stack   | 
 | fconst_2 | 	(none) | 	pushes float 2 onto the stack   | 

下面列出的操作码处理的int型和float型都是32位的值。Java栈单元（slot）是32位宽的，因此，每次一个int数和float数入栈，它都占用一个单元。下表列出的操作码处理long型和double型。long型和double型的数值占用64位。每次一个long数或double数被压入栈中，它都占用2个栈单元。下面的表格，列出了隐含处理long型和double型的操作码。

| 操作码        | 操作数     |  描述  |
| --------     | :----    | :----  |
 | lconst_0	 | (none) | 	pushes long 0 onto the stack      | 
 | lconst_1	 | (none) | 	pushes long 1 onto the stack      | 
 | dconst_0	 | (none) | 	pushes double 0 onto the stack    | 
 | dconst_1	 | (none) | 	pushes double 1 onto the stack    | 
 
另外还有一个隐含入栈常量值的操作码，aconst_null，它把空对象（null object）的引用（reference）压入栈中。对象引用的格式取决于JVM实现。对象引用指向垃圾收集堆（garbage-collected heap）中的对象。空对象引用，意味着一个变量当前没有指向任何合法对象。aconst_null操作码用在给引用变量赋null值的时候。

| 操作码        | 操作数     |  描述  |
| --------     | :----    | :----  |
| aconst_null | (none) | 	pushes a null object reference onto the stack   | 
 
有2个操作码需要紧跟一个操作数来指明入栈的常量值。下表列出的操作码，用来把合法的byte型和short型的常量值压入栈中。byte型或short型的值在入栈之前，先被扩展成int型的值，因为栈单元是32位宽的。对byte型和short型的操作，实际上是基于它们扩展后的int型值的。

| 操作码        | 操作数     |  描述  |
| --------     | :----    | :----  |
 | bipush | 	byte1        | 	expands byte1 (a byte type) to an int and pushes it onto the stack              | 
 | sipush | 	byte1, byte2 | 	expands byte1, byte2 (a short type) to an int and pushes it onto the stack      | 
 
有3个操作码把常量池中的常量值压入栈中。所有和类关联的常量，如final变量，都被保存在类的常量池中。把常量池中的常量压入栈中的操作码，都有一个操作数，它表示需要入栈的常量在常量池中的索引。JVM会根据索引查找常量，确定它的类型，并把它压入栈中。

在字节码流中，常量池索引（constant pool index）是一个紧跟在操作码后的无符号值。操作码lcd1和lcd2把32位的项压入栈中，如int或float。两者的区别在于lcd1只适用于1-255的常量池索引位，因为它的索引只有1个字节。（常量池0号位未被使用。）lcd2的索引有2个字节，所以它可以适用于常量池的任意位置。lcd2w也有一个2字节的索引，它被用来指示任意含有64位的long或double型数据的常量池位置。下表列出了把常量池中的

常量压入栈中的操作码：

| 操作码        | 操作数     |  描述  |
| --------     | :----    | :----  |
 | ldc1	   |   indexbyte1	           |   pushes 32-bit constant_pool entry specified by indexbyte1 onto the stack                   | 
 | ldc2	   |   indexbyte1, indexbyte2  |  	pushes 32-bit constant_pool entry specified by indexbyte1, indexbyte2 onto the stack      | 
 | ldc2w | 	indexbyte1, indexbyte2	   |   pushes 64-bit constant_pool entry specified by indexbyte1,indexbyte2 onto the stack        | 

## 把局部变量（local variables）压入栈中

局部变量保存在栈帧的一个特殊区域中。栈帧是当前执行方法正在使用的栈区。每个栈帧包含3个部分：本地变量区，执行环境和操作数栈区。把本地变量入栈实际上包含了把数值从栈帧的本地变量区移动到操作数栈区。操作数栈区总是在栈的顶部，所以，把一个值压到当前栈帧的操作数栈区顶部，跟压到整个JVM栈的顶部是一个意思。

Java栈是一个先进后出（LIFO）的32位宽的栈。所有的本地变量至少占用32位，因为栈中的每个单元都是32位宽的。像long和double类型的64位的本地变量会占用2个栈单元。byte和short型的本地变量会当做int型来存储，但只拥有较小类型的合法值。例如，表示byte型的int型本地变量取值范围总是-128到127。

每个本地变量都有一个唯一索引。方法栈帧的本地变量区，可以当成是一个拥有32位宽的元素的数组，每个元素都可以用数组索引来寻址。long和double型的占用2个单元的本地变量，且用低位元素的索引寻址。例如，对一个占用2单元和3单元的double数值，会用索引2来引用。

有一些操作码可以把int和float型本地变量压入操作数栈。部分操作码，定义成隐含常用本地变量地址的引用。例如，iload_0加载处在位置0的int型本地变量。其他本地变量，通过操作码后跟一个字节的本地变量索引的方式压入栈中。iload指令就是这种操作码类型的一个例子。iload后的一个字节被解释成指向本地变量的8位无符号索引。

类似iload所用的8位无符号本地变量索引，限制了一个方法最多只能有256个本地变量。有一个单独的wide指令可以把8位索引扩展为16位索引，则使得本地变量数的上限提高到64k个。操作码wide只有1个操作数。wide和它的操作数，出现在像iload之类的有一个8位无符号本地变量索引的指令之前。JVM会把wide的操作数和iload的操作数合并为一个16位的无符号本地变量索引。

下表列出了把int和float型本地变量压入栈中的操作码：

| 操作码        | 操作数     |  描述  |
| --------     | :----    | :----  |
 | iload | 	vindex	    |  pushes int from local variable position vindex       | 
 | iload_0 | 	(none) | 	pushes int from local variable position zero        | 
 | iload_1 | 	(none) | 	pushes int from local variable position one         | 
 | iload_2 | 	(none) | 	pushes int from local variable position two         | 
 | iload_3 | 	(none) | 	pushes int from local variable position three       | 
 | fload | 	vindex	    |  pushes float from local variable position vindex     | 
 | fload_0 | 	(none) | 	pushes float from local variable position zero      | 
 | fload_1 | 	(none) | 	pushes float from local variable position one       | 
 | fload_2 | 	(none) | 	pushes float from local variable position two       | 
 | fload_3 | 	(none) | 	pushes float from local variable position three     | 

接下来的这张表，列出了把long和double型本地变量压入栈中的指令。这些指令把64位的数从栈帧的本地变量去移动到操作数区。

| 操作码        | 操作数     |  描述  |
| --------     | :----    | :----  |
 | lload | 	vindex	    |  pushes long from local variable positions vindex and (vindex + 1)       | 
 | lload_0 | 	(none) | 	pushes long from local variable positions zero and one                 | 
 | lload_1 | 	(none) | 	pushes long from local variable positions one and two                  | 
 | lload_2 | 	(none) | 	pushes long from local variable positions two and three                | 
 | lload_3 | 	(none) | 	pushes long from local variable positions three and four               | 
 | dload | 	vindex	    |  pushes double from local variable positions vindex and (vindex + 1)     | 
 | dload_0 | 	(none) | 	pushes double from local variable positions zero and one               | 
 | dload_1 | 	(none) | 	pushes double from local variable positions one and two                | 
 | dload_2 | 	(none) | 	pushes double from local variable positions two and three              | 
 | dload_3 | 	(none) | 	pushes double from local variable positions three and four             | 

最后一组操作码，把32位的对象引用从栈帧的本地变量区移动到操作数区。如下表：

| 操作码        | 操作数     |  描述  |
| --------     | :----    | :----  |
 | aload | 	vindex	    |  pushes object reference from local variable position vindex      | 
 | aload_0 | 	(none) | 	pushes object reference from local variable position zero       | 
 | aload_1 | 	(none) | 	pushes object reference from local variable position one        | 
 | aload_2 | 	(none) | 	pushes object reference from local variable position two        | 
 | aload_3 | 	(none) | 	pushes object reference from local variable position three      | 

## 弹出到本地变量

每一个将局部变量压入栈中的操作码，都有一个对应的负责弹出栈顶元素到本地变量中的操作码。这些操作码的名字可以通过替换入栈操作码名中的“load”为“store”得到。下表列出了将int和float型数值弹出操作数栈到本地变量中的操作码。这些操作码将一个32位的值从栈顶移动到本地变量中。

| 操作码        | 操作数     |  描述  |
| --------     | :----    | :----  |
| istore | 	vindex	    |  pops int to local variable position vindex        | 
| istore_0 | 	(none) | 	pops int to local variable position zero         | 
| istore_1 | 	(none) | 	pops int to local variable position one          | 
| istore_2 | 	(none) | 	pops int to local variable position two          | 
| istore_3 | 	(none) | 	pops int to local variable position three        | 
| fstore | 	vindex	   |  pops float to local variable position vindex      | 
| fstore_0 | 	(none) | 	pops float to local variable position zero       | 
| fstore_1 | 	(none) | 	pops float to local variable position one        | 
| fstore_2 | 	(none) | 	pops float to local variable position two        | 
| fstore_3 | 	(none) | 	pops float to local variable position three      | 

下一张表中，展示了负责将long和double类型数值出栈并存到局部变量的字节码指令，这些指令将64位的值从操作数栈顶移动到本地变量中。

| 操作码        | 操作数     |  描述  |
| --------     | :----    | :----  |
 | lstore | vindex	   |   pops long to local variable positions vindex and (vindex + 1)     | 
 | lstore_0 | (none) | 	pops long to local variable positions zero and one                   | 
 | lstore_1 | (none) | 	pops long to local variable positions one and two                    | 
 | lstore_2 | (none) | 	pops long to local variable positions two and three                  | 
 | lstore_3 | (none) | 	pops long to local variable positions three and four                 | 
 | dstore | vindex	   |   pops double to local variable positions vindex and (vindex + 1)   | 
 | dstore_0 | (none) | 	pops double to local variable positions zero and one                 | 
 | dstore_1 | (none) | 	pops double to local variable positions one and two                  | 
 | dstore_2 | (none) | 	pops double to local variable positions two and three                | 
 | dstore_3 | (none) | 	pops double to local variable positions three and four               | 
 
最后一组操作码，负责将32位的对象引用从操作数栈顶移动到本地变量中。

| 操作码        | 操作数     |  描述  |
| --------     | :----    | :----  |
 | astore	 |  vindex | 	pops object reference to local variable position vindex     | 
 | astore_0	 | (none) | 	pops object reference to local variable position zero       | 
 | astore_1	 | (none) | 	pops object reference to local variable position one        | 
 | astore_2	 | (none) | 	pops object reference to local variable position two        | 
 | astore_3	 | (none) | 	pops object reference to local variable position three      | 

## 类型转换

JVM中有一些操作码用来将一种基本类型的数值转换成另外一种。字节码流中的转换操作码后面不跟操作数，被转换的值取自栈顶。JVM弹出栈顶的值，转换后再将结果压入栈中。下表列出了在int，long，float和double间转换的操作码。这四种类型组合的每一个可能的转换，都有一个对应的操作码。


| 操作码        | 操作数     |  描述  |
| --------     | :----    | :----  |
| i2l	| (none)	| converts int to long | 
| i2f	| (none)	| converts int to float | 
| i2d	| (none)	| converts int to double | 
| l2i	| (none)	| converts long to int | 
| l2f	| (none)	| converts long to float | 
| l2d	| (none)	| converts long to double | 
| f2i	| (none)	| converts float to int | 
| f2l	| (none)	| converts float to long | 
| f2d	| (none)	| converts float to double | 
| d2i	| (none)	| converts double to int | 
| d2l	| (none)	| converts double to long | 
| d2f	| (none)	| converts double to float | 

下表列出了将int型转换为更小类型的操作码。不存在直接将long，float，double型转换为比int型小的类型的操作码。因此，像float到byte这样的转换，需要两步。第一步，f2i将float转换为int，第二步，int2byte操作码将int转换为byte。


| 操作码        | 操作数     |  描述  |
| --------     | :----    | :----  |
| int2byte     |  (none)   |  converts int to byte   |
| int2char     |  (none)   |  converts int to char   |
| int2short    |  (none)   |  converts int to short  |

虽然存在将int转换为更小类型（byte，short，char）的操作码，但是不存在反向转换的操作码。这是因为byte，short和char型的数值在入栈之前会转换成int型。byte，short和char型数值的算术运算，首先要将这些类型的值转为int，然后执行算术运算，最后得到int型结果。也就是说，如果两个byte型的数相加，会得到一个int型的结果，如果你想要byte型的结果，你必须显式地将int类型的结果转换为byte类型的值。例如，下面的代码编译出错：

{% highlight java linenos %}
class BadArithmetic {
    byte addOneAndOne() {
        byte a = 1;
        byte b = 1;
        byte c = a + b;
        return c;
    }
}
{% endhighlight %}

javac会对上面的代码给出如下错误：

{% highlight java linenos %}
BadArithmetic.java(7): Incompatible type for declaration.
Explicit cast needed to convert int to byte.
                byte c = a + b;
                     ^
{% endhighlight %}
Java程序员必须显式的把a + b的结果转换为byte，这样才能通过编译。

{% highlight java linenos %}
class GoodArithmetic {
    byte addOneAndOne() {
        byte a = 1;
        byte b = 1;
        byte c = (byte) (a + b);
        return c;
    }
}
{% endhighlight %}

这样，javac会很高兴的生成GoodArithmetic.class文件，它包含如下的addOneAndOne()方法的字节码序列：

{% highlight asm linenos %}
iconst_1  // Push int constant 1.
istore_1  // Pop into local variable 1, which is a: byte a = 1;
iconst_1  // Push int constant 1 again.
istore_2  // Pop into local variable 2, which is b: byte b = 1;
iload_1   // Push a (a is already stored as an int in local variable 1).
iload_2   // Push b (b is already stored as an int in local variable 2).
iadd      // Perform addition. Top of stack is now (a + b), an int.
int2byte  // Convert int result to byte (result still occupies 32 bits).
istore_3  // Pop into local variable 3, which is byte c: byte c = (byte) (a + b);
iload_3   // Push the value of c so it can be returned.
ireturn   // Proudly return the result of the addition: return c;
{% endhighlight %}

> 原文地址：[Bytecode basics](http://www.javaworld.com/article/2077233/core-java/bytecode-basics.html)。