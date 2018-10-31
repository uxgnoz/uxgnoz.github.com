---
title: PostgreSql 常见问题汇总 
layout: posts
categories: 笔记, mysql
---

# PostgreSql 常见问题汇总 

---

### 设置角色/用户可链接数

{% highlight sql linenos%}
alter role xxx_role connection limit 80;
{% endhighlight %}

### 查看当前数据库连接情况

{% highlight sql linenos%}
select * from pg_stat_activity;
{% endhighlight %}