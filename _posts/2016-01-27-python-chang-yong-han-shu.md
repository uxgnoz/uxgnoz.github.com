---
title: Python 常用函数笔记
layout: posts
categories: python
---

# Python 常用函数笔记

---

### * ASCII 转字符

{% highlight python linenos %}
chr(c)
{% endhighlight %}


### * 字符转 ASCII

{% highlight python linenos %}
ord(c)
{% endhighlight %}

### * 数值字符串转数值

{% highlight python linenos %}
# 123
int('123')
# 22
int('10110', 2) # 基数范围 [2, 36]
# 123.987
float('123.987')
{% endhighlight %}

### * 整数转二进制字符串

{% highlight python linenos %}
# '0b10110'
bin(22)
{% endhighlight %}

### * 字符串格式化表达式

{% highlight python linenos %}
# %[(name)][flags][width][.precision]typecode

# '+00123.334'
'%+010.3f' % 123.3335
# '  +123.334'
'%+10.3f' % 123.3335
# '+123.334  '
'%-+10.3f' % 123.3335
# 'jim is 10 years old.'
'%(name)s is %(age)d years old.' % {'name': 'jim', 'age': 10}
{% endhighlight %}