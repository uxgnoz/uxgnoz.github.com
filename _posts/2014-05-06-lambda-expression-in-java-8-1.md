---
title: Java 8：Lambda表达式（一）
layout: posts
categories: java, Lambda
---

# Java 8：Lambda表达式（一）

---

*Java 8中，最重要的一个改变使得代码更快、更简洁，并向FP（函数式编程）打开了方便之门。下面我们来看看，它是如何做到的。* 

在上世纪九十年代，Java被设计成了OOP语言，在当时，OOP是软件开发中的标杆。远在OOP还没有出现的时候，已经产生了FP语言，例如Lisp和Scheme，但是它们的益处，并没有受到学术圈外的人重视。最近，FP的重要性被提升了，因为它非常适合并发编程和事件驱动编程。然而，这并不意味着OO不好，相反，好的策略应该是混用OOP和FP。就算你对并发编程不感兴趣，这也很有道理。例如，如果编程语言有一个方便写函数表达式的语法，集合类库就能拥有强大的API。 

Java 8中最主要的增强，就是把FP的概念深度整合进OO。在本文中，我将会展示其基本语法以及，在不同的上下文中，如何使用它。关键点如下： 

* Lambda表达式，就是有参数的代码块。 
* 在任何时候，你想稍后执行一个代码块时，用Lambda表达式。 
* Lambda表达式可以被转型成函数式接口。 
* Lambda表达式可以从封闭作用域有效访问final的变量。 
* 方法和构造器的引用可在不调用它们的情况下引用它们。 
* 你现在可以把default和static方法的具体实现写在接口中。 
* 你必须手动解决不同接口中任何的default方法冲突。  

---

## 为什么需要Lambda表达式？

Lambda表达式是一个代码块，你可以绕过它，因此它能在稍后执行，仅一次或多次。在介绍语法（甚至是奇怪的名称）之前，让我们后退一步，看看一直以来，你在Java中，类似的代码块会在什么地方用到。

当你想在一个独立的线程中执行代码时，你把代码放到Runnable的run方法中，就像这样： 

{% highlight java linenos %}
class Worker implements Runnable {
     public void run() {
         for (int i = 0; i < 1000; i++)
             doWork();
     }
     // …
}
{% endhighlight %}

然后，当你想执行这段代码时，你创建一个Worker实例，把它提交给线程池，或者简单的开始一个新线程：

{% highlight java linenos %}
Worker w = new Worker();
new Thread(w).start();
{% endhighlight %}

这里的关键在于，run方法中包含你想在独立线程中执行的代码。 

想想用自定义的Comparator排序。如果你想以长度，而不以默认的字典顺序对字符串排序，你可以传递一个Comparator对象给sort方法：

{% highlight java linenos %}
class LengthComparator implements Comparator<String> {
     public int compare(String first, String second) {
         return Integer.compare(first.length(), second.length());
     }
}
    
Arrays.sort(strings, new LengthComparator());
{% endhighlight %}

sort方法会持续调用compare方法，重排乱序的元素，直到数组排序完毕。你给sort方法传递一个比较元素的代码片段，这段代码被整合进其余的、你也许不想重新去实现的排序逻辑。注意：如果 x等于y，Integer.compare(x, y)返回0；x < y，返回负数；x > y，返回正数。这个static方法在Java 7中被加入。你千万不能计算x – y来比较它们的大小，那样符号相反的大操作数会导致计算溢出的。 

作为另外一个延后执行的例子，考虑一个按钮回调。你新建一个继承Listener接口的类，把回调动作放进其中，创建它的一个实例，最后把实例注册到按钮。这种场景司空见惯，以至于很多程序员都使用“匿名类的匿名实例”语法： 

{% highlight java linenos %}
button.setOnAction(new EventHandler<ActionEvent>() {
    public void handle(ActionEvent event) {
        System.out.println("Thanks for clicking!");
    }
});
{% endhighlight %}

重要的是handle方法中的代码，任何时候按钮被点击，它就会被执行。 

因为Java 8把JavaFX作为Swing GUI工具包的继任者，我在例子里是使用JavaFX。这些细节并不重要，因为在所有的UI工具包中，不管是Swing，JavaFX，还是Android，都是你给按钮一些代码，在按钮被点击的时候执行。 

在上面的三个例子中，你看到了相同的方式。代码块被传递给某人：线程池，sort方法或按钮，它将在稍后被调用。 到现在为止，在Java中传递代码块并不简单。你不能只是传递代码块，Java是一个OOP语言，因此你必须先创建一个属于某个类的实例，而这个类拥有我们需要传递的代码块。 

在其他语言中，是可能直接使用代码块的。在很长一段时间里，Java的设计者们反对增加这个特性，毕竟，Java的伟大力量在于简单性和一致性。如果一个语言，包含所有的能够产生少量更紧凑代码的特性，它就会变成不可维护的一团糟。经管如此，在其他语言中，它们并不仅仅是可以更简单的启动一个线程，或者注册一个按钮点击的处理程序；它们中的大量API都更加简单，更加一致，更加强大。在Java里，人们本应该能够写出类似的API，它们使用继承特定函数的类的实例，但是，这样的API，让人用起来并不愉快。 

一段时间以来，问题变成，并不是要不要在Java中添加FP，而是怎么去添加。在符合Java的设计出来之前，设计者们花了几年的时间来做试验。在本文下一部分，你将会看到，你是如何在Java 8中使用代码块的。 

---

## Lambda表达式的语法
 
再想想上面排序的例子。我们传递比较字符串长度的代码。我们计算： 
 
{% highlight java linenos %}
Integer.compare(first.length(), second.length());
{% endhighlight %}

fisrt和second是什么？它们都是字符串！Java是强类型语言，我们也必须指明这一点： 

{% highlight java linenos %}
(String first, String second) -> Integer.compare(first.length(), second.length());
{% endhighlight %}

你看到了你的第一个Lambda表达式。它只是简单的代码块和必须传给它的变量说明。 

它的名称Lambda是怎么来的呢？很多年前，还在计算机出现之前，逻辑学家Alonzo Church想要形式化数学函数，让它具有更有效的可计算性。（奇怪的事，人们知道有些函数的存在，却没有人知道怎么计算它们的值。）他用希腊字母lambda（λ）来表示函数参数。如果他懂得Jav API，他可能会这样写： 

{% highlight java linenos %}
λfirst.λsecond.Integer.compare(first.length(), second.length());
{% endhighlight %}

那为什么是字母λ呢？是Church用完了其他所有的字母了吗？实际上，伟大的《数学原理》使用ˆ来表示自由变量，它激发了Church用一个大写的lambda（λ）表示参数的灵感。但是最终，他还是使用了小写版本。自此以后，一个拥有参数的表达式就被称为了“Lambda表达式”。 
 
> 原文地址：[Lambda Expressions in Java 8](http://www.drdobbs.com/jvm/lambda-expressions-in-java-8/240166764?pgno=1)