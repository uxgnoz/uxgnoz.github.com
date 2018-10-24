---
title: Netty 之通道 OIOXXXSocketChannel
layout: posts
---

# Netty 之通道 OIOXXXSocketChannel

------

## OIOServerSocketChannel

OIOServerSocketChannel 的继承树如下：

    AbstractChannel 
        <- AbstractOioChannel 
        <- AbstractOioMessageChannel 
        <- OioServerSocketChannel

## OioSocketChannel

OioSocketChannel 的继承树如下：

AbstractChannel 
    <- AbstractOioChannel 
    <- AbstractOioByteChannel 
    <- OioByteStreamChannel 
    <- OioSocketChannel



{% highlight java %}
{% endhighlight %}