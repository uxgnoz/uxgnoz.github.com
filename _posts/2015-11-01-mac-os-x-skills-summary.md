---
title: Mac OS X 实用技巧汇编
layout: posts
categories: Mac OS X
---

# Mac OS X 实用技巧汇编

---

## 在 Finder 标题栏显示完整路径

终端下输入：

{% highlight bash linenos %}
defaults write com.apple.finder _FXShowPosixPathInTitle -bool YES
{% endhighlight %}

Look，变了吧！

![2015-11-01-mac-os-x-skills-finder-title-path.png](/images/2015-11-01-mac-os-x-skills-finder-title-path.png)

恢复默认：将上述命令换成下面这条即可。

{% highlight bash  linenos %}
defaults write com.apple.finder _FXShowPosixPathInTitle -bool NO
{% endhighlight %}

---

## 在 Finder 中去除不必要的路径前缀

![mac-os-x-skills-finder-path](/images/2015-11-01-mac-os-x-skills-finder-path.jpg)

这个路径栏通常是从磁盘分区开始的，没改过名字的就叫做「Macintosh HD」，接下来是「用户」，可是路径信息的这两个项目几乎没什么作用，我们需要看的一般都是从个人账户开始后面的路径。下面我们就来尝试删除这两个路径选项。

{% highlight bash  linenos %}
defaults write com.apple.finder PathBarRootAtHome -bool TRUE
killall Finder
{% endhighlight %}

![mac-os-x-skills-finder-path-2](/images/2015-11-01-mac-os-x-skills-finder-path-2.png)

Look，前缀不见了！

恢复默认：打开终端，输入如下代码并回车就可以恢复原样：

{% highlight bash  linenos %}
defaults delete com.apple.finder PathBarRootAtHome
killall Finder
{% endhighlight %}

--- 

## 显示 Finder 隐藏文件

终端下输入：

{% highlight bash  linenos %}
defaults write com.apple.finder AppleShowAllFiles -boolean true
killall Finder
{% endhighlight %}

恢复默认：将上述命令换成下面这条即可。

{% highlight bash  linenos %}
defaults write com.apple.finder AppleShowAllFiles -boolean false
killall Finder
{% endhighlight %}