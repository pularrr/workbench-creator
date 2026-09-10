# MVP 生成提示词

输入：{{topic}}、{{profile_json}}、{{references}}。输出：{topic,profile,network}，network 包含 nodes、cardBlocks、relations，可有 evidence。

为主题生成最小可评审网络，优先展示范围与组织方向。根和域沿用 Profile；若 Profile.hierarchy 启用，先按其 intermediateNodeTypes 设计中间导航层，再放入具体概念、方法或问题。先输出无卡片的层级骨架并逐父节点检查宽度，再补 definition。一个节点只放一个实体不等于把所有实体直接挂在父节点下。15–30节点是参考，不是硬性通过条件。前2–3轮结束，不继续逐节点深挖；只做少量浅搜索并明确来源是否核验。

节点字段：id/canonicalName/shortFact/nodeType/parentId，可有 domainId/order；根 parentId=""。卡片块字段：nodeId/type/title/text，MVP 只写 definition。关系字段：sourceId/targetId/type/rationale，PART_OF 指向整体（子→父）。保持所有引用可解析。

摘要建议80字内，名称20字内。每个父节点最好不超过 Profile 的 maxPrimaryChildren（默认8）；超限先建立有意义的类别，禁止“第一组/第二组”。高度相关节点先判断包含、从属、组成、前置或产出关系，再判断是否需要共同上位类别，最后才考虑同级关系。多方法拆成独立节点，problem 不混入方法。

给用户展示域树、各父节点子节点数、2–3张卡和未确定范围，同时展示完整开发预算：默认预计25–35分钟、扩展80–300个非叶父主题、模型调用保险丝4096次；明确说明拓扑叶子不计入主题数。请求用户同时验收网络方向和三项预算；不得只询问“是否继续”。
