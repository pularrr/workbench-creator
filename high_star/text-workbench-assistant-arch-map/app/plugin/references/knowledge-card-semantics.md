# 知识卡语义与内容判定

知识卡不是节点摘要的扩写，也不是固定栏目清单。先判断节点表达的单一知识实体，再按下列语义选择栏目。凡是选中的栏目，都必须给出可检查的实质内容；只有标题、同义改写、宣传性描述或“可用于很多领域”不算覆盖。

## 理论知识

理论知识回答“它是什么、为什么成立、在什么条件下成立、如何形式化”。

- `definition`（概念/定义/边界）：给出上位类别、区分该对象的必要特征、包含与排除范围，以及至少一个容易混淆的近邻对象及区别。概念节点应说明术语指代的对象或关系；参数节点还要给单位、取值域；指标节点还要给测量对象和方向性。只写用途、历史或把节点名换一种说法，不是定义。
- `principle`（原理/机理/理论依据）：给出从输入或条件，经关键机制/因果链/数学关系，到结果的连续解释，并回答“为什么会得到该结果”。方法和算法应解释每个关键步骤所利用的性质；组件应解释物理或逻辑机制；问题节点应解释成因和影响链。只列步骤、功能或结论，不是原理。
- `assumptions`（成立条件）：逐条写出可检查的前提、近似、边界条件和被忽略因素，并说明违反后会影响哪个结论。不得只写“理想情况下”。
- 理论公式：公式不是独立空栏目；放在 `principle`，必要时关联 formula。必须包含 LaTeX、公式表达的结论、每个符号的物理/数学含义与单位（若有）、适用前提、推导主线或来源、极端/特殊情形检查。只贴公式或只解释变量不算理论公式。
- `comparison`（同类理论/方案比较）：只比较解决同一问题、处于同一抽象层级的对象；明确共同目标、统一评价维度、差异来源和各自适用条件。罗列优缺点但没有统一条件，不算比较。

理论栏目之间不得互相代替：definition 回答“是什么”，principle 回答“为什么”，assumptions 回答“何时成立”，formula 形式化结论，comparison 回答“同类对象如何取舍”。

## 应用知识

应用知识围绕“任务场景—输入输出—落地流程—工程约束—失效与验证”展开，回答如何把该知识用于真实问题。

- `application`（任务与场景）：说明具体参与者/系统、待解决任务、该节点在完整链路中的位置、使用方式、产生的可观察收益，以及不适用场景。禁止“广泛应用于工业、医疗、科研”等领域枚举。
- `inputs_outputs`：说明输入和输出的语义、数据类型/形状、单位、坐标系或接口契约，以及必要的前后置依赖。
- `procedure`：给出有顺序、可执行、可复现的步骤；每步包含操作、所需输入、关键参数或判断条件、产出。只写“采集—处理—输出”不够具体。
- `engineering_tradeoff`：在精度、鲁棒性、时延、算力、存储、能耗、成本等至少两个冲突目标间说明变量如何改变结果，并给出选择条件；孤立参数值不算取舍。
- `failure_mode`：同时写触发条件、可观察症状、根因、后果和检测/缓解入口。只列“噪声影响结果”或直接推荐另一算法不算失效模式。
- `validation`：给出验证问题、数据/实验设置、基线、指标、通过标准和失败后的定位方向；“仿真验证有效”不算验证方法。
- `code`：提供表达核心机制的最小可运行代码或精确伪代码，正文写入 `block.code`，并说明输入、输出和关键依赖。代码不能代替原理或步骤。

## 按节点类型选择最低内容

- concept：definition + principle；有数学关系时 assumptions/公式。
- method / algorithm：definition + principle + inputs_outputs + procedure + engineering_tradeoff + validation；存在典型退化条件时加 failure_mode。
- model：definition + principle + assumptions + 公式（若模型由数学关系定义）+ validation。
- problem：definition + principle（成因/影响链）；解决方案拆成独立节点并用 `MITIGATES` 连接。
- parameter / metric：definition + principle（为何影响/为何可度量）；含计算式时补 assumptions/公式；用于选型时加 engineering_tradeoff 或 validation。
- component：definition + principle + inputs_outputs + engineering_tradeoff + validation；具体集成流程适合时加 procedure。
- application：definition + application + inputs_outputs + procedure + engineering_tradeoff + failure_mode + validation。
- artifact：definition + inputs_outputs；只有确有操作流程时加 procedure。
- domain / category：它们是导航节点，definition 只需说明分类边界、划分维度和成员准入规则，不机械填原理或应用。

这是完整开发的最低语义覆盖，不要求每张卡机械填满所有栏目。若某栏目确实不适用，省略并在审查缺口中说明；若适用则不能因模型保守而省略。
