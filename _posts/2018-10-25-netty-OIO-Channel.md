---
title: Netty 之通道 OIOXXXSocketChannel
layout: posts
---

# Netty 之通道 OIOXXXSocketChannel

------

## OIOServerSocketChannel

OIOServerSocketChannel 的继承树如下：
{% highlight java %}
AbstractChannel 
    <- AbstractOioChannel 
    <- AbstractOioMessageChannel 
    <- OioServerSocketChannel
{% endhighlight %}

## OioSocketChannel

OioSocketChannel 的继承树如下：

{% highlight java %}
AbstractChannel 
    <- AbstractOioChannel 
    <- AbstractOioByteChannel 
    <- OioByteStreamChannel 
    <- OioSocketChannel
{% endhighlight %}


{% highlight java %}
{% endhighlight %}