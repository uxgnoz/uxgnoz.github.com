---
title: 对象和数组： JVM 中，处理对象和数组的字节码介绍
layout: posts
categories: java, jvm
---

# 对象和数组： JVM 中，处理对象和数组的字节码介绍

---

欢迎来到“Under The Hood”第五期。本期我们来看看 [JVM 中处理对象和数组的字节码](/objects-and-arrays/)。你可能需要阅读往期的文章才能更好的理解本文。

## 面向对象的机器

JVM中的数据有3种形式：对象（object），对象引用（object reference）和原始类型（primitive type）。对象存放在垃圾收集堆中；对象引用和原始类型，根据它们作用域范围的不同，分别存放在不同的地方：作为本地变量，存放在Java栈中；作为实例变量，存放在垃圾收集堆上；作为类变量，存放在方法区上。

在JVM中，垃圾收集堆上只能给对象分配内存空间。原始类型，除了作为对象的一部分，没有其他方式可以给它在堆上分配空间。在需要对象引用的地方，如果你想使用原始类型，你可以给原始类型分配java.lang包中相应的包装对象。只有对象引用和原始类型可以作为本地变量，存放在Java栈中，对象是不可能存放在栈中的。

JVM中，对象和原始类型在架构上的分离，体现在Java编程语言中就是：对象不能被声明成本地变量，只有对象引用才行。在声明时，对象引用不会指向具体对象，只有引用被显式的初始化之后（指向已存在对象，或者通过new关键字创建新对象），引用才会指向实际对象。

在JVM指令集中，除了数组，所有的对象都通过相同的操作符集来实例化和访问。在Java中，数组也是对象，并且就像Java程序中任何其他对象一样，是动态创建的。数组引用可以用在任何需要Object类型的引用的地方，Object中的任何方法，都可以在数组上调用。但是，在JVM里，数组是使用有别于对象的特殊字节码来处理的。

就像任何其他对象一样，数组不能被声明为本地变量；只有数组引用可以。数组对象本身，总是包含一组原始类型或者一组对象引用。如果你声明一个对象数组，你会得到一组对象引用。对象们自己必须用new显式创建，并被赋值给数组的元素。

## 处理对象的字节码

实例化新对象是通过操作码new来实现的，它需要2个单字节的操作数。这2个单字节操作数合并成16位的常量池索引。常量池中对应的元素给出了新对象的类型信息。就像下面所展示的，JVM在堆上创建新的对象实例，并把它的引用压入栈中。

| OPCODE        | OPERAND(S)     | DESCRIPTION |  
| :--------     | :-----    | :-----    | 
 | new	 | indexbyte1, indexbyte2 | 	creates a new object on the heap, pushes reference | 

接下来的表格，列出了存取对象字段（field）的字节码。操作符putfield和getfield只负责处理实例变量。静态变量使用putstatic和getstatic访问，这个我们待会再说。操作符putfield和getfield都有2个单字节操作数，它们合并成16位的常量池索引。相应的常量池位置上存放着关于字段的类型，大小和偏移量的信息。putfield和getfield都会从栈中取得操作对象的引用。putfield从栈上获取所要赋给实例变量的值，而getfield则把取到的实例变量的值压进栈中。


| OPCODE        | OPERAND(S)     | DESCRIPTION |  
| :--------     | :-----    | :-----    | 
 | putfield | 	indexbyte1, indexbyte2 | 	set field, indicated by index of object to value (both taken from stack)   | 
 | getfield | 	indexbyte1, indexbyte2 | 	pushes field, indicated by index of object (taken from stack)              | 
 
如下表所示，静态变量通过putstatic和getstatic来访问。它们所拥有的2个单字节的操作数，会由JVM合并成16位的常量池索引。对应的常量池位置上存有静态变量的相关信息。由于静态变量不跟任何对象关联，putstatic和getstatic也不会使用对象引用。putstatic从栈中取得所要附给静态变量的值，而getstatic则把静态变量的值压入栈中。

| OPCODE        | OPERAND(S)     | DESCRIPTION |  
| :--------     | :-----    | :-----    | 
 | putstatic | 	indexbyte1, indexbyte2 | 	set field, indicated by index, of object to value (both taken from stack)    | 
 | getstatic | 	indexbyte1, indexbyte2 | 	pushes field, indicated by index, of object (taken from stack)               | 

下面的操作码用来检查栈顶的对象引用，是不是指向由操作数所索引的类或接口的实例。

当对象不是指定类或接口的实例时，checkcast指令会抛出CheckCastException异常；反之，checkcast什么也不做，对象引用仍保留在栈顶，继续执行下一个指令。checkcast指令保证了运行时的类型转换是安全的，它是JVM安全系统的一部分。

instanceof指令弹出栈顶的对象引用，最后把true或false压入栈中。如果对象确实是指定类或接口的实例，则把true入栈；反之，false入栈。instanceof指令实现了Java语言中的instanceof关键字，它允许程序员测试一个对象是不是某个类或接口的实例。

| OPCODE        | OPERAND(S)     | DESCRIPTION |  
| :--------     | :-----    | :-----    | 
 | checkcast | 	indexbyte1, indexbyte2	    |  Throws ClassCastException if objectref on stack cannot be cast to class at index         | 
 | instanceof | 	indexbyte1, indexbyte2 | 	Pushes true if objectref on stack is an instanceof class at index, else pushes false    | 

## 处理数组的字节码

可以通过指令newarray，anewarray，和multianewarray实例化数组。

newarray用来创建原始类型的数组，具体类型由它的单字节操作数指定。它可以创建的数组类型有byte，short，char，int，long，float，double和boolean。

anewarray创建对象引用数组，它的2个单字节操作数合并成16位常量池索引，由此获取到要创建的包含在数组中的对象类型信息。anewarray为数组中的对象引用分配控件，并把它们都设置为null。

multianewarray用来分配多维数组（数组的数组），可以通过重复调用newarray和anewarray来实现。multianewarray指令只是简单的把创建多维数组的多条字节码压缩成一个指令。它的开头2个单字节操作数合并成常量池索引，由此获取多维数组中的对象类型。第3个单字节操作数指明了多维数组的维数。至于每维的数组大小需从栈上获取。该指令为多维数组中所有的数组分配空间。

| OPCODE        | OPERAND(S)     | DESCRIPTION |  
| :--------     | :-----    | :-----    | 
 | newarray	       |  atype	                                |  pops length, allocates new array of primitive types of type indicated by atype, pushes objectref of new array                                                        | 
 | anewarray	   | indexbyte1, indexbyte2	                |  pops length, allocates a new array of objects of class indicated by indexbyte1 and indexbyte2, pushes objectref of new array                                         | 
 | multianewarray | 	indexbyte1, indexbyte2, dimensions | 	pops dimensions number of array lengths, allocates a new multidimensional array of class indicated by indexbyte1 and indexbyte2, pushes objectref of new array      | 

下表列出的指令把栈顶的数组引用弹出，把它的长度压入栈中。

| OPCODE        | OPERAND(S)     | DESCRIPTION |  
| :--------     | :-----    | :-----    | 
 | arraylength | 	(none)	 | pops objectref of an array, pushes length of that array     | 

下面的操作码获取数组中的元素。数组索引和数组引用从栈上弹出，数组中指定索引处的值被压入栈中。

| OPCODE        | OPERAND(S)     | DESCRIPTION |  
| :--------     | :-----    | :-----    | 
 | baload | 	(none) | 	pops index and arrayref of an array of bytes, pushes arrayref[index]         | 
 | caload | 	(none) | 	pops index and arrayref of an array of chars, pushes arrayref[index]         | 
 | saload | 	(none) | 	pops index and arrayref of an array of shorts, pushes arrayref[index]        | 
 | iaload | 	(none) | 	pops index and arrayref of an array of ints, pushes arrayref[index]          | 
 | laload | 	(none) | 	pops index and arrayref of an array of longs, pushes arrayref[index]         | 
 | faload | 	(none) | 	pops index and arrayref of an array of floats, pushes arrayref[index]        | 
 | daload | 	(none) | 	pops index and arrayref of an array of doubles, pushes arrayref[index]       | 
 | aaload | 	(none) | 	pops index and arrayref of an array of objectrefs, pushes arrayref[index]    | 

下表列出了把值存入数组元素中的操作码。值、索引和数组引用均从栈顶弹出。

| OPCODE        | OPERAND(S)     | DESCRIPTION |  
| :--------     | :-----    | :-----    | 
 | bastore | 	(none) | 	pops value index, and arrayref of an array of bytes, assigns arrayref[index] = value      | 
 | castore | 	(none) | 	pops value index, and arrayref of an array of chars, assigns arrayref[index] = value      | 
 | sastore | 	(none) | 	pops value index, and arrayref of an array of shorts, assigns arrayref[index] = value     | 
 | iastore | 	(none) | 	pops value index, and arrayref of an array of ints ,assigns arrayref[index] = value       | 
 | lastore | 	(none) | 	pops value index, and arrayref of an array of longs, assigns arrayref[index] = value      | 
 | fastore | 	(none) | 	pops value index, and arrayref of an array of floats, assigns arrayref[index] = value     | 
 | dastore | 	(none) | 	pops value index, and arrayref of an array of doubles, assigns arrayref[index] = value    | 
 | aastore | 	(none) | 	pops value index, and arrayref of an array of objectrefs, assigns arrayref[index] = value | 

> 原文地址：[Objects and Arrays](http://www.javaworld.com/article/2077305/learn-java/objects-and-arrays.html)。

