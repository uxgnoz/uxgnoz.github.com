---
title: KMP算法及其正确性证明
layout: posts
categories: python, java, kmp, algorithm
---

# KMP算法及其正确性证明

---

找出 P 的所有前缀集合 CP，找出 P 的所有后缀集合 CS，求 CP 和 CS 的交集中长度最大的元素，称之为 P 的『最长前后缀』。

---

## 算法实现及分析

下面的代码实现了前缀计算函数：

{% highlight python %}
def COMPUTE_PREFIX(P):
    pi = []
    pi.insert(0, 0)

    k = 0
    for q in range(1, len(P)):
        while k > 0 and P[k] != P[q]:
            k = pi[k - 1]

        if P[k] == P[q]:
            k += 1

        pi.insert(q, k)

    return pi
{% endhighlight%}

下面的代码实现了 KMP 算法主体部分：

{% highlight python %}
def KMP_MATCHER(T, P):
    pi = COMPUTE_PREFIX(P)
    q = 0   # 已匹配的字符数

    for i in range(0, len(T)):
        while q > 0 and P[q] != T[i]:
            q = pi[q - 1]

        if P[q] == T[i]:
            q += 1  # 下一个字符也匹配

        if q == len(P):
            print("Pattern occurs from index %s" % (i - len(P) + 1))
            # q = 0 # T 中已匹配的字符不可重复匹配
            q = pi[q - 1]   # T 中已匹配的字符可重复匹配
{% endhighlight%}
---

## 正确性证明

### * 引理 32.5（前缀函数迭代引理）

> **给定长度为 m 的模式 P，其前缀函数 π。证明：对 $$q = 1，2，\ldots，m$$，有 $$π^*[q]=\{k:k<q\ ， \ P_k \sqsupset P_q\}$$ 。**

证： 我们先证明 $$π^*[q]\subseteq\{k:k<q\ ，\ P_k \sqsupset P_q\}$$，也就是要证明对于 $$π^*[q]$$ 中的每一个元素 $$π^i[q]$$，$$π^i[q]\in\{k:k<q\ ，\ P_k \sqsupset P_q\}$$ 。

当 $$i=1$$时，$$π^i[q]=π^1[q]=π[q]$$，  
$$\because$$ 由定义 $$π[q]=max\ \{k:k<q\ ，\ P_k \sqsupset P_q\}$$  
$$\therefore $$ $$π[q]\in\{k:k<q\ ，\ P_k \sqsupset P_q\}$$

假设，当 $$i=n-1$$ 时，$$π^{n-1}\ [q]\in\{k:k<q\ ，\ P_k \sqsupset P_q\}$$；
 
当 $$i=n$$ 时，  
$$\because$$ $$ P_{π^n\ [q]}=P_{π[π^{n-1\ }\ [q]]}\ \sqsupset P_{π^{n-1\ }\ [q]}\ \sqsupset P_q$$  
$$\therefore$$ $$ P_{π^n\ [q]}\sqsupset P_q$$  
$$\therefore$$ $$ π^n[q]\in\{k:k<q\ ，\ P_k \sqsupset P_q\}$$  
$$\therefore$$ $$ π^*[q]\subseteq\{k:k<q\ ，\ P_k \sqsupset P_q\}$$ 成立。  

接下来我们用反正法证明 $$\{k:k<q\ ，\ P_k \sqsupset P_q\}\subseteqπ^*[q]$$ 。

假设 $$\{k:k<q\ ，\ P_k \sqsupset P_q\}\nsubseteqπ^*[q]$$，我们取非空集合 $$\{k:k<q\ ，\ P_k \sqsupset P_q\}-π^*[q]$$ 中最大的元素 m，  
取 $$n=min\ \{k:k\inπ^*[q]\ ，\ k > m\}$$  
由上面的证明，我们知道 $$n\in\{k:k<q\ ，\ P_k \sqsupset P_q\}$$  
$$\therefore$$ $$ P_n \sqsupset P_q$$  
$$\because$$ $$ P_m \sqsupset P_q\ ，\ n > m$$  
$$\therefore$$ $$ P_m \sqsupset P_n $$  
$$\therefore$$ $$ m \leq π[n]$$  
$$\because$$ $$ m \notin π^*[q]$$，$$π[n] \in π^*[q]$$  
$$\therefore$$ $$m \neq π[n]，  m < π[n]$$  
$$\because $$ $$π[n] < n$$  
$$\therefore$$ $$ m < π[n] < n$$，这与 $$n$$ 和 $$m$$ 的取法相矛盾（要么 m 不是非空集合 $$\{k:k<q\ ，\ P_k \sqsupset P_q\}-π^*[q]$$ 中最大的，要么 n 不是 $$\{k:k\inπ^*[q]\ ，\ k > m\}$$ 中最小的）   
$$\therefore$$ 假设不成立，即 $$ \{k:k<q\ ，\ P_k \sqsupset P_q\}\subseteq π^*[q]$$

综上所述，引理结论成立，证毕。

---

### * 引理 32.6

> **给定长度为 m 的模式 P，其前缀函数 π。证明：对 $$q = 1，2，\ldots，m$$，如果 $$π[q] > 0$$，那么 $$π[q]-1 \in π^*[q-1]$$。**

证： 令 $$r=π[q]$$，那么 $$r < q$$， $$r-1 < q-1$$，$$P_r \sqsupset P_q$$  
$$\because $$ $$ r=π[q] > 0 $$  
$$\therefore$$ $$P_{r-1} \sqsupset P_{q-1}$$（通过把 $$P_r$$, $$P_q$$ 的最后一个字符去掉）  
$$\therefore$$ $$π[q]-1=r-1 \ \in \{k:k<q-1\ ，\ P_k \sqsupset P_{q-1}\}$$ 
 
由引理 32.5 可得 $$π[q]-1 \ \in π^*[q-1]$$  

证毕。

--- 

### * 定义

> **对 $$q = 2，3，\ldots，m$$，定义 $$π^*[q-1]$$ 的子集 $$E_{q-1}$$ 如下：  
$$
\begin{split}
E_{q-1} & = \{\ k \in π^*[q-1]：P[k+1]=P[q] \ \}\\
& = \{\ k:k<q-1，P_k \sqsupset P_{q-1}，P[k+1]=P[q]\ \} \text{（引理 32.5）}\\
& =\{\ k:k<q-1,P_{k+1} \sqsupset P_q\ \}
\end{split}
$$**

----

### * 推论 32.7

> **给定长度为 m 的模式 P，其前缀函数 π，那么对 $$q = 2，3，\ldots，m$$，有 $$
π[q] =
\begin{cases}
0  & \text{当}\ E_{q-1}=\emptyset
\\1+max\ \{k \in E_{q-1}\} & \text{当}\ E_{q-1}\not=\emptyset\ 
\end{cases}
$$。**

证： 当 $$E_{q-1}=\emptyset$$ 时，由$$E_{q-1}=\{\ k:k<q-1,P_{k+1} \sqsupset P_q\ \}$$ 知，不存在 $$k < q-1$$，$$k + 1 < q$$ ，使得 $$P_{k+1} \sqsupset P_q$$  
$$\therefore$$ $$π[q]=0$$

当 $$E_{q-1}\ne\emptyset$$ 时，  
$$\because$$ $$\forall \  k \ \in\  E_{q-1}$$，有 $$P_{k+1} \sqsupset P_q$$  
$$\therefore$$ $$π[q] \geq k + 1 \geq max \ \{k \in E_{q-1}\} + 1$$  
即 $$π[q] \geq max \ \{k \in E_{q-1}\} + 1\ \ \ \ \ \ \cdots \ \ \ \ \ \ (1)$$

另一方面，由上我们知道 $$π[q] > 0$$，令 $$r=π[q]-1$$，由引理 32.6，得 $$r \in π^*[q-1] \ \ \ \ \ \ \cdots \ \ \ \ \ \ (2)$$  
$$\because$$ $$r+1=π[q]$$  
$$\therefore$$ $$P_{r+1} \sqsupset P_q\ \ \ \ \ \ \cdots \ \ \ \ \ \ (3)$$  

由 $$(2)$$，$$(3)$$ 两式，我们得到 $$r \in E_{q-1}$$  
$$\therefore$$  $$r \leq max \ \{k \in E_{q-1}\}$$  
$$\therefore$$ $$π[q]-1 \leq max \ \{k \in E_{q-1}\}$$  
即 $$π[q] \leq max \ \{k \in E_{q-1}\} + 1\ \ \ \ \ \ \cdots \ \ \ \ \ \ (4)$$

由 $$(1)$$，$$(4)$$ 两式，可得 $$π[q] = max \ \{k \in E_{q-1}\} + 1$$

综上所述，推论得证。

---

## 参考资料

1.《算法导论》