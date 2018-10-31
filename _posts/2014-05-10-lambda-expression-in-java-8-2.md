---
title: Java 8：Lambda表达式（二）
layout: posts
categories: java, Lambda
---

# Java 8：Lambda表达式（二）

---

*Java 8中，最重要的一个改变让代码更快、更简洁，并向FP（函数式编程）打开了方便之门。下面我们来看看，它是如何做到的。*

[上一篇中](/lambda-expression-in-java-8-1/)，你看到了Java中Lambda表达式的一种形式：参数 + “->” + 表达式。如果代码实现的逻辑一条语句完成不了，你可以写成类似方法的形式：代码写在“{}”中，再加上显式的return语句。例如：

{% highlight java linenos %}
(String first, String second) -> {
     if (first.length() < second.length()) return -1;
     else if (first.length() > second.length()) return 1;
     else return 0;
}
{% endhighlight %}

就算一个Lambda表达式没有参数，你也需要保留空的小括号，就像没有参数的方法一样：

{% highlight java linenos %}
() -> { for (int i = 0; i < 1000; i ++) doWork(); }
{% endhighlight %}

如果一个Lambda表达式的参数类型，可以根据上下文推断出来，你可以省略它们。例如：
{% highlight java linenos %}
Comparator<String> comp
     = (first, second) // Same as (String first, String second)
        -> Integer.compare(first.length(), second.length());
{% endhighlight %}

这里，编译器能够推断出first和second肯定是字符串类型，因为，这个Lambda表达式被赋值给了字符串Comparator。
如果Lambda表达式只有一个单独的、可以推断出的参数，你甚至可以省略两边的小括号：

{% highlight java linenos %}
EventHandler<ActionEvent> listener = event ->
     System.out.println("Thanks for clicking!");
     // Instead of (event) -> or (ActionEvent event) ->
{% endhighlight %}

就像你可以给方法的参数加上注解或final修饰符一样，Lambda表达式也可以：

{% highlight java linenos %}
(final String name) -> ...
(@NonNull String name) -> ...
{% endhighlight %}

你永远不能指定Lambda表达式的返回值类型，它只能从上下文去推断出来。例如，表达式

{% highlight java linenos %}
(String first, String second) -> Integer.compare(first.length(), second.length());
{% endhighlight %}

可以用在需要int类型的上下文中。

注意，只在部分分支中有返回值，而在其他分支中没有返回值的Lambda表达式是非法的。例如，

{% highlight java linenos %}
(int x) -> { if (x >= 0) return 1; }
// invalid Lambda expression
{% endhighlight %}

## 函数式接口

正如我们讨论过的，Java中存在很多只包含代码块的接口，例如Runnable或Comparator。Lambda表达式向后兼容这些接口。

任何在需要只包含一个抽象方法的接口的实例的时候，你都可以用Lambda表达式。这些接口被称为“函数式接口”。

你可能会想，为什么一个函数式接口必须只包含一个抽象方法呢？接口中所有的方法不都是抽象的吗？实际上，接口一直都是可以重新声明Object类中包含的方法的，比如toString或者clone，而这样的重新声明并不会使这些方法变成抽象的。（有些接口，为了在生成的javadoc中添加自己的注释，而重新声明了Object中的方法，例如可以去翻翻Comparator接口的API。）更重要的是，你马上就会看到，在Java 8中，接口可以声明非抽象的方法。

为了展示到成函数式接口的转换，看看Arrays.sort方法。它的第二个参数需要一个只包含一个方法的Comparator接口的实例。简单的给它提供一个Lambda表达式：

{% highlight java linenos %}
Arrays.sort(words,
     (first, second) -> Integer.compare(first.length(), second.length()));
{% endhighlight %}

在幕后，Arrays.sort方法会接收到一个实现了Comparator
接口的某个类的实例，调用它的compare方法就会执行Lambda表达式。管理这些实例和类是完全依赖于实现的，它比使用传统的内部类更加有效率。最好是把Lambda表达式当成函数来看，而不是对象，并认可，它可以被赋值给一个函数式接口。     

这种到接口的转换，令Lambda表达式如此的引人注目，语法很短，很简单。下面是另外一个例子：

{% highlight java linenos %}
button.setOnAction(event ->
     System.out.println("Thanks for clicking!"));
{% endhighlight %}

这读起来太简单了！

实际上，转型成函数式接口，是你在Java中唯一可以对Lambda表达式做的事情。在其他支持函数字面量的语言里，你可以声明函数类型，比如(String, String) -> int，声明这种函数类型的变量，使用这些变量保存函数表达式。在Java中，你甚至不能把Lambda表达式赋值给一个Object类型的变量，因为Object不是一个函数式接口。Java的设计者们决定严格坚持熟悉的接口概念，而不是在语言中添加新的函数类型。

Java API的java.util.function中定义了几个范型的函数式接口。其中一个接口，BiFunction，描述了拥有参数T和U，返回值是R的函数。你可以把我们字符串比较的Lambda表达式保存在这种类型的变量中：

{% highlight java linenos %}
BiFunction< String, String, Integer > comp
     = (first, second) -> Integer.compare(first.length(), second.length());
{% endhighlight %}

但是，那样并不能帮你做排序，因为Arrays.sort方法不接受BiFunction类型的变量作为参数。如果你以前使用过FP语言，你会发现这很奇怪。 但是对Java开发者来说，这很自然。一个接口，例如Comparator，拥有一个特定的目的，而不只是一个给定参数和返回值类型的方法。Java 8保留了这种特色。当你想用Lambda表达式做事情的时候，你依然要牢记表达式的目的，并给它一个特定的函数式接口。

几个Java 8 的API用到了java.util.function中的函数式接口，将来，你也许能看到，其他地方也会用到它们。但是，请要记住，你可以很好的把Lambda表达式转型成函数式接口，这是现今你使用的API的一部分。你也可以给任何函数式接口加上@FunctionalInterface注解，这样做有两个好处。一是编译器会去检查被注解的接口，是不是只有一个抽象方法。另一个是，在生成的javadoc页面中，会包含类似这样的一句话：本接口是函数式接口。这个注解不是必须的，因为根据定义，任何只有一个抽象方法的接口都是函数式接口。但使用@FunctionalInterface注解会是个不错的主意。

最后，检查型异常，会影响Lambda表达式转型成函数式接口实例。如果Lambda表达式语句体中抛出了检查型异常，这个异常需要在目标接口中的抽象方法里声明。例如，下面的代码就有问题：

{% highlight java linenos %}
Runnable sleeper = () -> { System.out.println("Zzz"); Thread.sleep(1000); };
// Error: Thread.sleep can throw a checkedInterruptedException
{% endhighlight %}

这个赋值是非法的，因为Runnable.run方法不能抛出任何异常。要修改它，你有两个选择。你可以在Lambda表达式语句体中捕获这个异常。或者，你可以把这个表达式，赋值给一个抽象方法能抛出异常的接口实例。例如，Callable的call方法可以抛出任何异常，因此，你可以把上面的表达式赋值给Callable（如果你增加一个返回null的return语句）。

---

## 方法引用

有时候，已经有方法实现了你想要传递给其他代码的逻辑。比如，假定任何时候按钮被点击，你只是想要打印事件对象，你肯定会这样做：

{% highlight java linenos %}
button.setOnAction(event -> System.out.println(event));
{% endhighlight %}

如果能够只把println方法传递给setOnAction方法，那就更好了。下面就是这样做的：

{% highlight java linenos %}
button.setOnAction(System.out::println);
{% endhighlight %}

表达式System.out::println就是一个方法引用，它等价于x -> System.out.println(x)。

另外一个例子，假如你想忽略大小写的给字符串排序。你可以这样：

{% highlight java linenos %}
Arrays.sort(strings, String::compareToIgnoreCase);
{% endhighlight %}

正如你看到的，“::”操作符把对象名或类名跟方法名分隔开来。主要有三种情况：

1. 对象::实例方法
2. 类::静态方法
3. 类::实例方法

前两种，方法引用等价于提供方法参数的Lambda表达式。正如上文提到的，System.out::println等价于x -> System.out.println(x)。同样的，Math::pow等价于(x, y) -> Math.pow(x, y)。最后一种情况里，第一个参数为方法的调用目标。比如，String::compareToIgnoreCase跟(x,y) -> x.compareToIgnoreCase(y)等价。

当出现多个重载的同名方法时，编译器会根据上下文，尝试找出你实际想用的那一个。例如，Math.max方法有两个版本，一个的参数类型是整型，一个是双精度型。哪一个会被用到，取决于Math::max会转型成拥有哪种方法参数的函数式接口。和Lambda表达式一样，方法引用并不是单独存在的，它们总是被转型为函数式接口。

在方法引用中，可以使用this关键字。例如，this::equals等价于x -> this.equals(x)。super也一样。表达式supper::instanceMethod使用this作为目标，调用指定方法的父类版本。下面的代码故意写成那样，来展示工作机制：

{% highlight java linenos %}
class Greeter {
     public void greet() {
        System.out.println("Hello, world!");
     }
}
    
class ConcurrentGreeter extends Greeter {
     public void greet() {
        Thread t = new Thread(super::greet);
        t.start();
     }
}
{% endhighlight %}

当线程启动时，它的Runnable被调用，super::greet执行父类Greeter的greet方法。（注意在内部类中，你可以像这样使用this来指代内部类的实例：EnclosingClosing.this::method或者EnclosingClass.super::method。）

---

## 构造方法引用

除了把方法名改成new以外，构造方法引用基本和方法引用一样。例如，Button::new是一个Button的构造方法引用。哪一个构造方法被调用，取决于上下文。想象一下，你有一个字符串列表。那么通过用每一个字符串去调用Button的构造方法，你可把字符串列表转换成一个按钮数组。

{% highlight java linenos %}
List<String> labels = ...;
Stream<Button> stream = labels.stream().map(Button::new);
List<Button> buttons = stream.collect(Collectors.toList());
{% endhighlight %}

stream、map和collect方法的细节不在本文范围之内。现在，重要的是，map方法为每一个字符串，调用构造方法Button(String)。Button类有很多构造方法，但是编译器会选择用字符串为参数的那一个，因为它从上下文中推断出，构造方法会被使用一个字符串参数来调用。

你可以用数组类型来组成创建方法引用。例如，int[]::new就是构造方法引用，它有一个参数：数组长度。它等价于x -> new int[x]。

数组的构造方法引用，对克服Java的限制很有用。我们不能创建一个以范型类型T为元素的数组。表达式new T[n]是不对的，因为它在编译时，被擦除为new Object[n]。对类库的作者来说，这是一个问题。例如，我们想拥有一个按钮的数组。Stream接口有一个返回Object数组的方法，toArray：

{% highlight java linenos %}
Object[] buttons = stream.toArray();
{% endhighlight %}

然而，这并不能令人满意。我们想要的是按钮数组，而不是Object数组。stream库用构造方法引用解决了这个问题。把Button[]::new传递给toArray方法：

{% highlight java linenos %}
Button[] buttons = stream.toArray(Button[]::new);
{% endhighlight %}

toArray方法调用构造方法得到正确的数组类型，然后填充并返回数组。

> 原文地址：[Lambda Expressions in Java 8](http://www.drdobbs.com/jvm/lambda-expressions-in-java-8/240166764?pgno=2)