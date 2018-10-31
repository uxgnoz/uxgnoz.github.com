---
title: Java 8：Lambda表达式（三）
layout: posts
categories: java, Lambda
---

# Java 8：Lambda表达式（三）

---

*Java 8中，最重要的一个改变让代码更快、更简洁，并向FP（函数式编程）打开了方便之门。下面我们来看看，它是如何做到的。*

## 变量作用域

你经常会想，如果可以在Lambda表达式里访问外部方法或类中变量就好了。看下面的例子：

{% highlight java linenos %}
public static void repeatMessage(String text, int count) {
     Runnable r = () -> {
        for (int i = 0; i < count; i++) {
           System.out.println(text);
           Thread.yield();
        }
     };
     new Thread(r).start();
}
  
// Prints Hello 1,000 times in a separate thread
repeatMessage("Hello", 1000);
{% endhighlight %}

现在我们来看看Lambda中的变量：count和text。它们不是在Lambda中定义的，而是repeatMessage方法的参数。

如果你仔细瞧瞧，这里发生的事情并不是那么容易能看出来。Lambda表达式中的代码，可能会在repeatMessage方法返回之后很久才会被调用，这时候，参数变量已经不存在了。那么text和count是如何保留下来的呢？

为了理解这段代码，我们需要进一步的了解Lambda表达式。Lambda表达式有三个组成部分：

1. 代码块
2. 参数
3. 自由变量值（自由变量不是参数，也不是在语句体中定义的变量）

在我们的例子中，Lambda表达式有两个自由变量：text和count。表示Lambda表达式的数据结构，必须保存自由变量的值，在这里，就是“Hello”和“1000”。我们说这些值被Lambda表达式捕获了。（怎么做到的，那是实现的细节问题。例如，我们可以把Lambda表达式转化成拥有单个方法的对象，这样的话，自由变量的值就可以拷贝到对象的实例变量中去。）

拥有自由变量值的代码块的专业术语叫闭包。如果有人很得意的告诉你，他们的语言拥有闭包，那么本文其余的部分会向你保证，Java同样也有。在Java中，Lambda表达式就是闭包。事实上，内部类一直就是闭包啊！而Java 8也给了我们拥有简洁语法的闭包。

就像已经看到的，Lambda表达式可以捕获外部作用域的变量值。在Java中，为了保证被捕获的变量值是定义良好的，它有一个很重要的约束。在Lambda表达式里，只能引用值不变的变量。比如，下面的用法就不对：

{% highlight java linenos %}
public static void repeatMessage(String text, int count) {
     Runnable r = () -> {
        while (count > 0) {
           count--; // Error: Can't mutate captured variable
           System.out.println(text);
           Thread.yield();
        }
     };
     new Thread(r).start();
}
{% endhighlight %}

这样做，是有原因的。因为，在Lambda表达式中改变自由变量的值，不是线程安全的。比如，考虑一系列的并发任务，每一个都更新共享的计数器matches：

{% highlight java linenos %}
int matches = 0;
for (Path p : files) {
    // Illegal to mutate matches
    new Thread(() -> { if (p has some property) matches++; }).start();
}
{% endhighlight %}

如果上面的代码是合法的，那就非常非常糟糕了！“matches++”不是一个原子操作，当多个线程并发执行它的时候，我们不可能知道，到底会发生什么样的事情。
内部类同样也可以捕获外部作用域的自由变量值。Java 8之前，内部类只能访问被final修饰的本地变量。现在，这个规则被放宽到跟Lambda表达式一样，内部类可以访问事实上的final变量，也就是那些值不会改变的变量。

不要指望编译器去捕获所有的并发访问错误。禁止改变的规则是使用于本地变量。如果matches是外部类的实例变量，或者静态变量，就算你得到的结果是不确定的，编译器也不会告诉你任何错误。

同样的，尽管不正确，并发改变共享变量的值是相当合法的。下面的例子就是合法但不正确的：

{% highlight java linenos %}
List< Path > matches = new ArrayList<>();
for (Path p : files)
    new Thread(() -> { if (p has some property) matches.add(p); }).start();
    // Legal to mutate matches, but unsafe
{% endhighlight %}    
    
注意，matches是事实上的final变量。（事实上的final变量是指，在它初始化以后，再也没有改变它的值。）在这里，matches总是引用同一个ArrayList对象，并没有改变。但是，matches引用的对象以线程不安全的方式，被改变了，因为如果多个线程同时调用add方法，结果就是不可预测的！
值的计数和搜集是存在线程安全的方式的。你可能想要用stream来收集特定属性的值。在其他情形下，你可能会使用线程安全的计数器和集合。
跟内部类相似，有一个变通的方式，可以让Lambda表达式更新外部本地作用域的计数器的值。比如，用一个长度为一的数组：

{% highlight java linenos %}
int[] counter = new int[1];
button.setOnAction(event -> counter[0]++);
{% endhighlight %}

当然，这样的代码不是线程安全的。也许，对一个按钮的回调方法来说，是无所谓的。但通常，使用这种方式之前，你应该多考虑考虑。
Lambda表达式的语句体和嵌套代码块的作用域是一样的。变量名冲突和隐藏规则同样适用。在Lambda表达式里声明的参数或本地变量跟外部本地变量同名，是非法的。

{% highlight java linenos %}
Path first = Paths.get("/usr/bin");
Comparator< String > comp =
    (first, second) -> Integer.compare(first.length(), second.length());
    // Error: Variable first already defined
{% endhighlight %}
    
在方法里，你不能有两个同名的本地变量。Lambda表达式同样如此。在Lambda表达式里，当你使用“this”时，你引用的是创建Lambda表达式方法的this参数。例如：

{% highlight java linenos %}
public class Application() {
     public void doWork() {
        Runnable runner = () -> {
            // . . .
            System.out.println(this.toString());
            // . . .
        };
        // . . .
     }
}
{% endhighlight %}

这里的this.toString调用的是Application对象的，不是Runnable实例的。在Lambda中使用this并没有什么特别的。Lambda的作用域嵌套在doWork方法里，this的含义在方法中哪里都一样。

---

## 默认方法
很多编程语言在它们的集合类库中集成了函数表达式。这导致它们的代码，比使用外循环更短，更易于理解。例如：

{% highlight java linenos %}
for (int i = 0; i < list.size(); i++)
    System.out.println(list.get(i));
{% endhighlight %}
    
有一个更好的方法。类库的设计者们可以提供一个forEach方法，它把函数应用到所包含的每一个元素上。然后我们就可以简单的调用：

{% highlight java linenos %}
list.forEach(System.out::println);
{% endhighlight %}

这样很好，如果类库从一开始就是这样设计的话。但是Java集合类库是很多年前设计的，这就有一个问题。如果Collection接口多了一个新的方法，比如forEach，那么，所有实现了Collection的程序，都会编译出错，除非它们也实现多出来的那个方法。这在Java中肯定是不能接受的。

Java的设计者们决定一劳永逸的解决这个问题：他们允许接口中的方法拥有具体实现（称为默认方法）！这些方法可以安全的加进现存接口中。下面我们来看看默认方法的细节。在Java 8里，forEach方法被加进了Collection的父接口Iterable接口中，现在我来说说这样做的机制。
看如下的接口：

{% highlight java linenos %}
interface Person {
    long getId();
    default String getName() { return "John Q. Public"; }
}
{% endhighlight %}

接口中有两个方法，抽象方法getId和默认方法getName。实现Person的具体类当然必须提供getId方法的实现，但可以选择保留getName方法的实现，或者重载它。

默认方法的出现，终结了一个经典的模式：提供一个接口和实现了它的部分或全部方法的抽象类，比如Collection/AbstractCollection，或WindowListener/WindowAdapter。现在你可以直接在接口中实现方法了。

如果相同的方法在一个接口中被定义为默认方法，在超类或另一个接口中被定义为方法，会怎么样呢？像Scala和C++都用复杂的规则来解决这种歧义性。幸好，在Java中，规则就简单多了。它们是：

* 超类优先。如果超类提供了具体的方法，接口中的默认方法将被简单的忽略。
* 接口冲突。如果父接口提供了默认方法，另一个接口有相同的方法（默认的或抽象的），那么你需要自己重载这个方法来解决冲突。

让我们看看第二条规则。比如拥有getName方法的另一个接口：

{% highlight java linenos %}
interface Named {
    default String getName() { return getClass().getName() + "_" + hashCode(); }
}
{% endhighlight %}

如果你写一个实现接口Person和Named的类，会发生什么呢？

{% highlight java linenos %}
class Student implements Person, Named {
     // . . .
}
{% endhighlight %}

Student类继承了两个实现不一致的getName方法。Java编译器会报错，并把它留给开发者去解决冲突，而不是随便选一个来使用。在Student类中，简单的提供一个getName方法就可以了。至于方法里的实现，你可以在冲突的方法中任选一个。

{% highlight java linenos %}
class Student implements Person, Named {
     public String getName() { returnPerson.super.getName(); }
     // . . .
}
{% endhighlight %}

现在假设接口Named没有提供getName方法的默认实现：

{% highlight java linenos %}
interface Named {
     String getName();
}
{% endhighlight %}

那么Student类会继承Person的默认方法吗？这也许是合理的，但Java的设计者们决定坚持一致性原则：接口之间怎么冲突不重要，只要至少有一个接口提供了默认方法，编译器就报错，开发人员必须自己去解决冲突。

如果接口都没有提供相同方法的默认实现，那么这跟Java 8之前的时代是一样的，没有冲突。实现类有两个选择：实现这个方法，或者不实现它。后一种情形下，实现类本身就会是一个抽象类。
我刚刚讨论了接口之间的方法冲突。现在看看一个类继承了一个父类，并且实现了一个接口。它从两者继承了同一个方法。例如，Person是一个类，Student被定义成：

{% highlight java linenos %}
class Student extends Person implements Named { … }
{% endhighlight %}

这种情况下，只有父类的方法会生效，接口中任何的默认方法都会被简单的忽略。在我们的例子中，Student会继承Person中的getName方法，Named接口提不提供默认getName的实现没有任何区别。这就是“父类优先”的规则，它保证了与Java 7的兼容性。在默认方法出现之前的正常工作的代码里，如果你给接口添加一个默认方法，它并没有任何效果。但是小心：你绝不能写一个默认方法，它重新定义Object类里的任何方法。比如，你不能定义toString或equals方法的默认实现，就算这样做对有些接口（比如List）来说很有诱惑力，因为”父类优先“原则会导致这样的方法不可能胜过Object.toString或Object.equals。

--- 

## 接口中的静态方法

在Java 8里，你可以在接口中添加静态方法。从来都没有一个技术上的原因说这样是非法的：它只是简单的看起来与接口作为抽象规范的精神相违背。
到目前为止，把静态方法放在伴生的类中是一个通常的做法。在标准类库中，你会看到成对的接口和工具类，比如Collection/Collections，或者Path/Paths。

看看Paths类，它只有几个工厂方法。你可以从一系列的字符串中，创建一个路径，比如Paths.get(“jdk1.8.0″, “jre”, “bin”)。在Java 8中，你可以把这个方法加到Path接口中：

{% highlight java linenos %}
public interface Path {
    public static Path get(String first, String… more) {
        return FileSystems.getDefault().getPath(first, more);
    }
    // . . .
}
{% endhighlight %}

这样，Paths接口就不需要了。

当你在看Collections类的时候，你会看到两类方法。一类这样的方法：

{% highlight java linenos %}
public static void shuffle(List< ? > list);
{% endhighlight %}

将会作为List接口的默认方法工作的很好：

{% highlight java linenos %}
public default void shuffle();
{% endhighlight %}

你就可以在任何列表上简单的调用list.shuffle()。
对工厂方法来说，那样是不行的，因为你没有调用方法的对象。这时候接口中的静态方法就有用武之地了。例如：

{% highlight java linenos %}
public static < T > List< T > nCopies(int n, T o)
// Constructs a list of n instances of o
{% endhighlight %}

可以作为List的静态方法。那么，你就可以调用List.nCopies(10, “Fred”)，而不是Collections.nCopies(10, “Fred”)。这样，阅读代码的人就很清楚，结果一定是个List。

尽管如此，基本上，要Java集合类库以上面这种方式去重构是不可能的。但是当你实现你自己的接口时，没有理由去为工具方法提供单独的伴生类了吧。
在Java 8中，很多接口都被添加了静态方法。比如，Comparator接口有一个非常有用的静态方法comparing，它接收一个”键抽取“函数，并产生一个比较抽取出来的键的比较器。要根据name比较Person对象，用Comparator.comparing(Person::name)就行了。

--- 

## 总结

本文中，我先用Lambda表达式

{% highlight java linenos %}
(first, second) -> Integer.compare(first.length(), second.length());
{% endhighlight %}

来比较字符串的长度。但我们可以做得更好，简单的使用Comparator.compare(String::length)就行。这是一个很好的结束本文的方式，因为它展示了用函数开发的力量。compare方法把一个函数（键抽取器）变成了另一个更复杂的函数（基于键的比较器）。在我的书中，以及各种网上资料里面，就有关于”高阶函数“更多细节的讨论。

> 原文地址：[Lambda Expressions in Java 8](http://www.drdobbs.com/jvm/lambda-expressions-in-java-8/240166764?pgno=3)