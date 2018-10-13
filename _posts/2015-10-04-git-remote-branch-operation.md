---
title: Git创建远程分支的相关指令
layout: posts
category: 笔记
---

# Git创建远程分支的相关指令

---

## Git创建远程Branch

{% highlight bash linenos %}
git clone git@github.com:user/project.git
cd project
git checkout -b new_branch # 建立local branch
git push -u origin new_branch # 建立远程 branch (將new_branch建立到远程)
git fetch
vim index.html # 修改
git commit -m 'test' -a # commit
git push
{% endhighlight %}

> 注： new_branch 要换成你要的branch name，以上所有new_branch都要对应着修改成同样名称。  

---

## Git使用远程分支

{% highlight bash linenos %}
git clone git@github.com:user/project.git
cd project
git branch -r # 查看远程有哪些分支
git checkout origin/new_branch -b new_branch # 建立local new_branch 并与远程分支关联
vim index.html # 修改
git commit -m 'test' -a # commit
git push
{% endhighlight %}

> 注： new_branch 要换成你要的 branch name，以上所有 new_branch 都要对应着修改成同样名称。

---

## Git刪除远程分支

{% highlight bash linenos %}

git push origin:new_branch # 刪除遠端的 branch

{% endhighlight %}

---

## Git分支合并

{% highlight bash linenos %}
git branch new_branch # 建立 branch
git checkout new_branch # 切到 new_branch，git checkout -b new_branch 可以同时建立 + 切換
vim index.html # 修改
git commit -m 'test' -a # commit
git checkout master # 切回 master
git merge new_branch # 將 new_branch merge 到 master
git branch -d new_branch # 若砍不掉就用 -D
{% endhighlight %}

---

## 更新所有Repository branch

{% highlight bash linenos %}
git remote update
{% endhighlight %}