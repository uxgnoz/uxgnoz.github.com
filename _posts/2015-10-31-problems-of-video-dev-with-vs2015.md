---
title: 各种坑：记第一次VC开发
layout: posts
categories: Visual Stdio
---

# 各种坑：记第一次VC开发

---


## 获取编辑框中的数字

`mVideoServerPort`是一个`CEdit`类型控件，问题是在vs的自动提示中只能看到`GetWindowTextW`这个方法，而这个方法接收2个参数：

* LPTSTR
* 最大长度

然后我这样：

{% highlight c++  linenos %}
LPTSTR portStr;
mVideoServerPort.GetWindowTextW(portStr, 6);
{% endhighlight%}

VS提示`portStr`未初始化。以我的浅见，这是个指向`char`的指针啊，那这样：

{% highlight c++  linenos %}
// "char *" 类型的值不能用于初始化 "LPTSTR" 类型的实体
LPTSTR portStr = new char[6]; 
// 下面2个貌似ok
LPTSTR portStr = _TCHAR[6];
LPTSTR portStr = TCHAR[6];
{% endhighlight %}

我选用了第三种，也就是`LPTSTR portStr = TCHAR[6]`。

接下来字符串转换成数字，我在控件中输入`54321`，它却始终只能转换第一个字符，也就是`5`。但是如果我直接把`portStr`的值写死成`“54321”`，转换后的`port`却是对的。这尼玛什么情况？？

{% highlight c++  linenos %}
int port = atoi((char *) portStr);
{% endhighlight%}

Google了一下，发现了这个 [atoi only returning first digit of char* parameter](http://stackoverflow.com/questions/19233364/atoi-only-returning-first-digit-of-char-parameter)。这是个什么情况，看不懂了啊！！

然后就在一个论坛里面看到类似如下的代码，它调用了`GetWindowText`。抱着试试看的心态，竟然能通过编译，结果还对了。

{% highlight c++ linenos %}
CString portStr ;
mVideoServerPort.GetWindowText(portStr);

USES_CONVERSION;
int port = atoi((char *) W2A(portStr));
{% endhighlight %}

这个，VS的`智能提示`是个神马情况？？？

---

## Microsoft 符号服务器无限读条

调试的时候，每次启动应用程序，都要出现下面窗口，然后就是没完没了的`读条`。

![vs-symbol-loading-dialog](/images/2015-10-31-vs-symbol-loading-dialog.jpg)

咱也不懂啥是个`符号服务器`，直接忽略之，该勾的勾，该删的删，该清的清。

![vs-options-symbol](/images/2015-10-31-vs-options-symbol.jpg)