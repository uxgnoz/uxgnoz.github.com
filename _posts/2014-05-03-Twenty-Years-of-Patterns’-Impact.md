---
title: 模式影响之20年
layout: posts
category: 设计模式
---


# 模式影响之20年

---

本文首次发布在[IEEE软件](http://www.computer.org/portal/web/computingnow/software)杂志，由[InfoQ](http://www.infoq.com/articles/twenty-years-of-patterns-impact)和IEEE计算机社会为您呈现。

在软件开发中，好的建议是可遇不可求的。通用设计原则可以指导我们，但现实总是逼着我们，在看起来相互冲突的目标之间妥协，比如，可扩展性和可维护性与规模和复杂性。同样的，现有代码库可以在很大程度上让我们避免重复造轮子，但想要初级开发者轻松组合那些现有组件来做项目，依然不现实。

设计模式帮助我们缩小了这种差距：对特定情形下重复出现的问题，它记录了不错的解决方案。设计模式讨论影响方案设计的主要因素，而不提供现成复制粘贴的代码片段。Web应用的性能和安全就是这样的例子：加解密算法增强了安全性，但引入了处理开销。就如你兄长教你如何做正确的事情一般，Ward Cunningham曾经描述了最佳的设计模式。

尽管模式很流行，但作为设计手法的影响，比作为特殊的软件产品的影响更加难以定量描述。本文主要阐述了模式汇编会议20年后，可用模式的广泛性和部分模式对开源软件的影响深度。

--- 

## 模式起源

受建筑师和哲学家Christopher Alexander启发， 在1987年，Kent Beck和Ward Cunningham共同编写了设计Smalltak窗口程序的小模式语言。
1993年，Beck和Grady Booch发起的一次科罗拉多山区度假，发展成了非盈利性Hillside组织。而该组织通过一系列的PLoP（编程模式语言大会），推动了模式汇编工作。PLoP已成功举办了20年，在这个过程中，诞生了很多成功的模式论文和书籍。

1994年，Erich Gamma和他的同事合著的《设计模式》一书，把模式的概念宣传给更广泛的人群；到目前为止，该书已经以13种语言，卖出了50万本。两年以后，Frank Buschmann和他的同事合著了《面向模式的软件架构》系列第一卷；紧接着，Martin Fowler出版了他的《分析模式》。“模式形式“的成功，甚至令一些作者和出版商无故给书的标题上加上“模式”二字，我们觉得这是成功的代价。2013年的亚马逊网站上，在计算机和技术类图书中，搜索关键词“模式”，结果产生了超过5500个不同的条目（包括少数不相关的视觉模式检测条目）。

围绕模式的早期炒作已经尘埃落定，人们意识到，模式既不能代替设计技巧，也不能解决所有问题。尽管如此，根据实际经验精心提炼的模式，能提供很有价值的相关建议。因为现做现学，往往不是现实项目的可选项，而模式提供了学习别人经验的一种方式。

---

## 没有模式疲劳的迹象

模式领域的普遍多样性，使得有记载的模式的数目很难确定。Linda Rising的《模式年鉴2000》列出了超过1000种模式。由Hillside组织赞助的PLoP大会已经接受了超过1500篇模式论文。大会论文的提交率一直稳定在每年100份左右。保守估计每篇论文4种模式，再加上所有的书籍和封面设计，移动应用开发，自适应系统，可持续架构，领域特定模式，元架构，工作流，容错系统和安全。

大多数人认可的模式定义为：特定上下文中，某问题的成熟解决方案。在《建筑的永恒之道》中，Christopher Alexander阐明道：“简而言之，模式是，在同一时间，世界上发生的事物，创建这个事物的规则以及必须创建该事物的时刻。”模式给出了可复用的解决方案，也提供了方案的好处和它的权衡，并封装了成熟的最佳实践的知识。

例如，很多集成体系架构都使用Broker模式，它扮演客户端和服务端中间人的角色，负责处理消息路由，包括序列化和反序列化消息内容。Web的通讯基础架构就实现了这种模式；类似YAWL的工作流引擎也包含了丰富的实现。

很多模式只是模式库的一部分，例如[雅虎的UI库](http://developer­.yahoo.com/patterns)和[安全模式网站](http://www.securitypatterns.org)。很多公司，包括亚马逊，谷歌，IBM，Lucent，微软，甲骨文和西门子，都写有相似的模式集合，它们中的部分可从书籍或网站获取。IBM的电子商务分类编目模式就是模式集合的一个例子。
除许多其他重复设计以外，IBM的WebSphere产品系中的ESB（企业服务总线）实现还以它为特色。基于彼此构建的、相互关联的模式的集合可形成模式语言，它能支撑具有生产力的，领域特定的开发过程。甚至还有一个编写模式的模式语言。

---

## 企业集成模式

模式在软件架构和设计上的成功，激励了人们尝试把它们更紧密的集成到编程工具中以提高生产力，更紧密的整合进设计和实现的思维方式中。不幸的是，大部分尝试都失败了，因为模式原本只是人类之间记录和传递知识的媒介，不是一个编程结构。尽管如此，有些模式语言确实直接影响了软件方案的建立过程。

大约在2003年，ESB这个术语，由于描述SOA（面向服务的体系结构）集成平台获得了人们的关注。ESB产品在不同服务之间路由、过滤和转换XML消息；它们代表的是实现Broker模式的传统企业应用集成产品的演变。讽刺的是，尽管ESB产品的目标是整合不同的企业应用，但是缺乏描述这种方案设计的共同词汇。

![图1 Apache Camel核心代码随时间增长情况](/images/1Fig2-small.png)

图1 Apache Camel核心代码随时间增长情况。Java代码库的线性增长意味着稳定的提交者社区和可持续的发展。JavaScript的代码量在2009年跳跃式增长之后，开始放缓；同样的情况也发生在JavaScript类库和框架的可用性上。

开源ESB实现的开发者们想要填补这种空缺，但很快就发现，EIP（企业集成模式）提供了从集成风格到消息路由和转换的、条理清楚的65个模式词汇。而这些词汇能够描述大部分有意义的ESB解决方案。因此，在缺乏ESB工业标准的情形下，开源项目把EIP词汇作为了事实上的标准。

---

## 开源ESB产品

在2005年，随着开源ESB产品的出现，几乎有一打的开源ESB产品，已经在它们的产品级领域特定语言或编程模型中，嵌入了EIP语言。最广泛使用的例子有Mule，Apache Camel，WSO2 ESB，Spring Integration和OpenESB。

开源项目的性质使得跟踪它的代码量相对容易很多。但是，跟踪市场占有率却相对比较困难，因为销售数据并不存在，下载次数也被镜像站点、缓存或者自动下载所扭曲。Apache Camel包含大约89万行代码，由62个提交者，6年时间，18000次个人提交所创建。Java代码库一直呈现惊人的线性增长（图1），这意味着稳定的提交者群体始终如一的参与。在开源核心部分的商业版本（如Red Hat版，Talend版）中，添加的设计或运行时管理工具也显著的扩大了代码库。

Apache Camel由Maven Central提供的下载量平均每月大概25000次，2013年7月达到峰值，超过30000次。这个数字高于YAWL，它的下载量在2010年大约每月1000次。Mule报告说，在它的官方站点有360万次下载，但并不能说明这都是由个人用户发起的下载。

社区参与给开源的成功提供了另外一个深刻的度量。Apache Camel在2007年首次发布后，它的社区发帖量呈直线上升，稳定在每月大概2500贴。这表明它是一个协作解决问题和促进产品演变的健康社区。与此相比，Mule社区首页显示，它拥有15万成员，但论坛发帖总量却只有26600份。

---

## 作为设计工具的模式

融入产品的EIP词汇流行开来之后，有些ESB项目更进一步，在他们的设计工具中，采用EIP模式骨架作为其中的可视语言。例如，在Redhat Fuse集成开发环境或Mule Studio中，开发者可以使用EIP图标语言。跟以前不同，对异步消息解决方案的简单管道过滤器架构风格，努力“可视化编程”的尝试，使模式这种可视化组合显得很自然。图2显示了可视化的Camel路由：它通过消息路由器，把传入的消息转发给两个可能的消息端点之一。现在，ESB开发者可以使用EIP词汇来思考、设计、交流和实现他们的解决方案。

![图2 在Redhat Fuse集成开发环境中](/images/Fig3.jpg)

图2 在Redhat Fuse集成开发环境中，使用可视化模式语言创建消息解决方案。消息从基于文件的消息端点发出；在基于内容的路由器中，根据消息内容所指明的城市，转发给两个消息端点之一。基于内容的路由器模式，描述了一种可复用设计：根据消息内容，把消息路由给正确的接受者，

![图3 玩印有EIP的扑克](/images/1Fig4.jpg)

图3 玩印有EIP的扑克。可视化模式语言允许交互式的、近乎好玩的模式用法。每张牌上都印有模式图标、名称和解决方案。

在首届CamelOne大会上赠送的EIP扑克牌（图3），可能是迄今为止最有创意的模式改编了。每张牌上都印有模式语言中的一个模式和方案陈述。很高兴能看到，为增进人们交流和合作而创建的设计模式，能以这种平易近人的、有用方式来到架构师和工程师的手中。

我们以上介绍的统计数据表明，在过去的20年里，模式语言对软件设计社区有着广泛的影响。然而，很多模式研究的问题都还没有答案。例如，好的模式并不总是那么容易找到，它需要做更多的工作，去组织和分类大量现有模式。我们还设想，也许使用语义维基技术，模式语言能够制作工具。最终，以模式为中心的设计工具，能保证比单纯的组件和连接器的画图工具，对软件工程师更有吸引力。

模式社区会失去动力吗？我们不这样认为：现存的模式语言，就像EIP一样，将会继续被实现为领域特定语言。而没有发现模式的领域还依然存在。例如，应用之间（通过技术协议）和人类之间（如通过社交网络）的典型会话，都应能以模式的形式予以保存。模式的未来是光明的，我们诚邀您来塑造它，不管是通过促进模式工具的开发，还是以模式的形式，书写和分享您的设计智慧。

---

## 参考

1. W. Cunningham, “Tips for Editing Patterns,” Dec. 2002.
2. E. Gamma et al., Design Patterns, AddisonWesley Professional, 1994.
3. F. Buschmann et al., PatternOriented Software Architecture, Volume 1: A System of Patterns, John Wiley & Sons, 1996.
4. M. Fowler, Analysis Patterns: Reusable Object Models, AddisonWesley Professional, 1996.
5. J. Kerievsky, Refactoring to Patterns, AddisonWesley Professional, 2004.
6. M. Fowler, Patterns of Enterprise Application Architecture, AddisonWesley Professional, 2002.
7. G. Hohpe and B. Woolf, Enterprise Integration Patterns: Designing, Building, and Deploying Messaging Solutions, AddisonWesley Professional, 2004.
8. E. Evans, Domain Driven Design: Tackling Complexity in the Heart of Software, AddisonWesley Professional, 2003.
9. V. Vernon, Implementing DomainDriven Design, AddisonWesley Professional, 2013.
10. L. Rising, The Pattern Almanac 2000, AddisonWesley, 2000.
11. C. Alexander, The Timeless Way of Building, Oxford Univ. Press, 1979.
12. M. Adams, A.H.M. ter Hofstede, and M. La Rosa, “Open Source Software for Workflow Management: The Case of YAWL,” IEEE Software, vol. 28, no. 3, 2011, pp. 16–19.
13. M. Keen et al, Patterns: Implementing an SOA Using an Enterprise Service Bus, IBM, 2004.
14. F. Buschmann, K. Henney, and D. Schmidt, “Past, Present, and Future Trends in Software Patterns,” IEEE Software, vol. 24, no. 4, 2007, pp. 31–37.
15. G. Meszaros and J. Doble, A Pattern Language for Pattern Writing, Hillside Group.

---

## 关于作者

* Gregor Hohpe是Allianz SE的首席企业家构师和Hillside组织的成员。邮箱：info@enterpriseintegrationpatterns.com。
* Rebecca WirfsBrock是WirfsBrock Associates的主席和Hillside组织的财务主管。邮箱：rebecca@wirfsbrock.com。
* Joseph W. Yoder是The Refactory公司和Hillside组织主席。邮箱：joe@refactory.com。
* Olaf Zimmermann教授是位于Rapperswil的Eastern Switzerland大学应用科学系Institute forSoftware机构的研究合作伙伴。邮箱：ozimmerm@hsr.ch。

> 原文地址：[Twenty Years of Patterns’ Impact](http://www.infoq.com/articles/twenty-years-of-patterns-impact)