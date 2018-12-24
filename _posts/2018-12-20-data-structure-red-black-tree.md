---
title: 数据结构：红黑树
layout: posts
categories: java, data structure, red black tree
---

# 数据结构：红黑树

------

## 概述

红黑树的性质：

1. 节点或是红色，或是黑色；
2. 根节点是黑色；
3. 叶节点（NIL）是黑色；
4. 如果一个节点是红色，那么它的两个孩子都是黑色；
5. 对任一节点，从该节点到叶节点的所有*简单路径*上包含相同数目的黑色节点。

------

## 添加节点

除了需要做红黑树性质的维护，红黑树的插入算法和普通的二叉树插入算法是一致的。

节点 z 插入之后，如果 z 的父节点是红色的，这时需要做红黑调整，否则节点添加结束。

### 1. 叔节点是红色（左右一致）

此时，A、C、D 是红色，B 为黑色。**目标：x 上移 2 层，指向爷爷节点 B。**

填充 A、C 为黑色，B 为红色，x 指向节点 B。如果 B 的父节点为黑色，问题解决；否则继续下一轮。

![insertion-case-1](/images/2018-12-20-red-black-tree-insertion-case-1.png)

### 2. 叔节点是黑色，x 是右孩子

此时，A、D 为红色，B、C 为黑色。**目标：把 x 节点调整成左孩子。**

对 D 子树做*左旋操作*，x 指向原先的父节点 D。

![insertion-case-2](/images/2018-12-20-red-black-tree-insertion-case-2.png)

### 3. 叔节点是黑色，x 是左孩子

此时，A、D 为红色，B、C 为黑色。**目标：调整完毕。**

交换 A、B 的颜色，对 B 子树做*右旋操作*，问题解决。

![insertion-case-3](/images/2018-12-20-red-black-tree-insertion-case-3.png)

------

## 删除节点

下面是在红黑树中删除一个节点的大概流程，其中：z 为待删除节点；y 要么指向 z，要么指向 z 的直接后继节点；x 指向 y 的右孩子或者左孩子。

1. y 初始化指向 z；
2. 如果 z 没有左孩子，直接用右子树顶替 z，x 指向 z 右孩子；
3. 如果 z 没有右孩子，直接用左子树顶替 z，x 指向 z 左孩子；
4. 如果 z 孩子双全，使用 z 的直接后继 y 替换 z；
   1. 此时，y 位于 z 右子树的最左侧，没有左孩子，x 指向 y 可能的右孩子；
   2. 如果 y 不是 z 的右孩子，用 y 的右子树替换 y 子树；
   3. y 移动到 z 的位置；
5. y 填充 z 的颜色，节点删除完成。


如果 y 本身是黑色，不管是它被删除，还是从原来的位置移动到 z 的位置，都会导致原先的 y 子树，也就是现在的 x 子树少 1 个黑色，因而部分祖先节点*可能*会违反性质 5。

我们把少掉的这一个黑色临时放在 x 节点上，也就是 x 具有*双重颜色*，红-黑，或者，黑-黑，由于 x 多贡献一个黑色，性质 5 也就被满足了。接下来要做的是**把这多出来的一个黑色在 x 的祖先节点上移动，找出一个合适的节点给他填充上**，问题就解决了。

如果 x 是根节点，可能会违背性质 2，直接给填充黑色，问题解决；如果 x 是红色，填充黑色，问题解决；如果 x 是黑色，根据 x 是左孩子、右孩子分别有四种情况。

先来看 x 是左孩子的情况。

> **注意，在整个处理过程当中，x 指向的节点具有双重颜色。**

### 1. 兄弟是红色   

此时，x 的父节点 B 必定为黑色，C 和 E 必定为黑色。**目标：x 拥有黑色的兄弟节点。**
   
交换 B 和 D 的颜色，并对以 B 为根的子树做*左旋操作*。完了之后，x 的父节点 B 成了红色，兄弟为原来兄弟 D 的左孩子，肯定是黑色。红黑树的各项性质依然保持，下一轮转 2、3、4 之一。

![deletion-case-1](/images/2018-12-20-red-black-tree-deletion-case-1.png)

### 2. 兄弟是黑色，其左右孩子均为黑色

此时父节点 B 颜色随意，A、C、D、E 均为黑色。**目标：x 指向父节点。**

上移 x 多出的黑色和兄弟节点 D 的黑色给父节点 B，填充兄弟节 D 点为红色，**x 指向父节点 B**。此时 x 为红-黑或黑-黑，红黑树性质依然保持。

**若 x 为红-黑，也就是说节点 B 原来为红色，填充 x 为黑色，问题解决；**否则继续走下一轮。

![deletion-case-2](/images/2018-12-20-red-black-tree-deletion-case-2.png)

### 3. 兄弟是黑色，其左孩子为红色，右孩子为黑色

此时父节点 B 颜色随意，A、D、E 为黑色，C 为红色。**目标：x 的黑色兄弟拥有红色的右孩子。**

对以 D 为根的子树做*右旋操作*，并交换 C、D 的颜色，红黑性质依然保持，继续第 4 步。
   
![deletion-case-3](/images/2018-12-20-red-black-tree-deletion-case-3.png)

### 4. 兄弟是黑色，其左孩子随意，右孩子为红色

此时，A、D 为黑色，E 为红色，B、C 颜色随意。**目标：问题解决。**

D 的黑色给到 E，B 的颜色给到 D，A 多出来的黑色给到 B，以 B 为根节点执行*左旋操作*，问题解决。

![deletion-case-4](/images/2018-12-20-red-black-tree-deletion-case-4.png)

### #RB-INSERT-FIXUP(T, z)

根据 z 的父节点是左孩子，还是右孩子分成对称的 2 种情况：

* 左孩子
* 右孩子

{% highlight python linenos %}
while z.p.color == RED 
    if z.p == z.p.p.left 
        y = z.p.p.right
        if y.color == RED
            z.p.color = BLACK
            y.color = BLACK
            z.p.p.color = RED
            z = z.p.p
        else 
            if z == z.p.right
                z = z.p
                LEFT-ROTATE(T, z)
            z.p.color = BLACK
            z.p.p.color = RED
            RIGHT-ROTATE(T, z.p.p)
    else 
        y = z.p.p.z
        if y.color == RED
            z.p = BLACK
            y.color = BLACK
            z.p.p.color = RED
            z = z.p.p
        else
            if z == z.p
                z = z.p
                RIGHT-ROTATE(T, z)
            color[p[z]] ← BLACK
            color[p[p[z]]] ← RED
            LEFT-ROTATE(T, p[p[z]])
color[root[T]] ← BLACK        
{% endhighlight %}
------

## TreeNode

`TreeNode`继承自`LinkedHashMap.Entry`，代表了一个红黑树节点。

{% highlight java linenos %}
TreeNode<K,V> parent;  // 父节点
TreeNode<K,V> left;    // 左孩子
TreeNode<K,V> right;    // 右孩子
TreeNode<K,V> prev;    // needed to unlink next upon deletion
boolean red;    //  节点颜色标记
{% endhighlight %}

### #root

从任意节点查询红黑树根节点。

{% highlight java linenos %}
final TreeNode<K,V> root() {
    for (TreeNode<K,V> r = this, p;;) {
        if ((p = r.parent) == null)
            return r;
        r = p;
    }
}
{% endhighlight %}

### #find

从当前节点开始查找符合条件的节点。

{% highlight java linenos %}
// 从当前节点开始查找符合条件的节点。
final TreeNode<K,V> find(int h, Object k, Class<?> kc) {
    TreeNode<K,V> p = this;
    do {
        int ph, dir; K pk;
        TreeNode<K,V> pl = p.left, pr = p.right, q;
        if ((ph = p.hash) > h)
            p = pl;
        else if (ph < h)
            p = pr;
        else if ((pk = p.key) == k || (k != null && k.equals(pk)))
            return p;
        else if (pl == null)
            p = pr;
        else if (pr == null)
            p = pl;
        else if ((kc != null ||
                    (kc = comparableClassFor(k)) != null) &&
                    (dir = compareComparables(kc, k, pk)) != 0)
            p = (dir < 0) ? pl : pr;
        else if ((q = pr.find(h, k, kc)) != null)
            return q;
        else
            p = pl;
    } while (p != null);
    return null;
}

// 从 root 节点开始查找符合条件的节点。
final TreeNode<K,V> getTreeNode(int h, Object k) {
    return ((parent != null) ? root() : this).find(h, k, null);
}
{% endhighlight %}

### #treeify

{% highlight java linenos %}
final void treeify(Node<K,V>[] tab) {
    TreeNode<K,V> root = null;
    for (TreeNode<K,V> x = this, next; x != null; x = next) {
        next = (TreeNode<K,V>)x.next;
        x.left = x.right = null;
        if (root == null) {
            x.parent = null;
            x.red = false;
            root = x;
        }
        else {
            K k = x.key;
            int h = x.hash;
            Class<?> kc = null;
            for (TreeNode<K,V> p = root;;) {
                int dir, ph;
                K pk = p.key;
                if ((ph = p.hash) > h)
                    dir = -1;
                else if (ph < h)
                    dir = 1;
                else if ((kc == null &&
                            (kc = comparableClassFor(k)) == null) ||
                            (dir = compareComparables(kc, k, pk)) == 0)
                    dir = tieBreakOrder(k, pk);

                TreeNode<K,V> xp = p;
                if ((p = (dir <= 0) ? p.left : p.right) == null) {
                    x.parent = xp;
                    if (dir <= 0)
                        xp.left = x;
                    else
                        xp.right = x;
                    root = balanceInsertion(root, x);
                    break;
                }
            }
        }
    }
    moveRootToFront(tab, root);
}

/**
    * Ensures that the given root is the first node of its bin.
    */
static <K,V> void moveRootToFront(Node<K,V>[] tab, TreeNode<K,V> root) {
    int n;
    if (root != null && tab != null && (n = tab.length) > 0) {
        int index = (n - 1) & root.hash;
        TreeNode<K,V> first = (TreeNode<K,V>)tab[index];
        if (root != first) {
            Node<K,V> rn;
            tab[index] = root;
            TreeNode<K,V> rp = root.prev;
            if ((rn = root.next) != null)
                ((TreeNode<K,V>)rn).prev = rp;
            if (rp != null)
                rp.next = rn;
            if (first != null)
                first.prev = root;
            root.next = first;
            root.prev = null;
        }
        assert checkInvariants(root);
    }
}
{% endhighlight %}
{% highlight java linenos %}
{% endhighlight %}
{% highlight java linenos %}
{% endhighlight %}
{% highlight java linenos %}
{% endhighlight %}
{% highlight java linenos %}
{% endhighlight %}