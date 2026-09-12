# 知识审查提示词

输入：{{profile_json}}、{{network_json}}、{{validation_report}}、可核验来源。

检查事实来源、覆盖范围、粒度、父级、重复概念、关系方向、栏目适用性。先列出每个父节点的直接子节点数和划分维度；重点处理 TOO_MANY_PRIMARY_CHILDREN 与 FLAT_CONCEPT_CLUSTER。对高度相关的同级节点，先验证是否存在包含、从属、组成、前置、输入输出关系或缺失的共同上位类别，再接受同级关系。逐条输出问题的 nodeId、规则、依据、建议修改和影响的引用。共享粒度规则还包括 MULTI_CONCEPT_NODE、NODE_NAME_TOO_LONG、SHORTFACT_TOO_LONG、PROBLEM_NODE_HAS_SOLUTION。

这些规则是启发式 warning，命中“和”“与”等字符不必然表示多个概念。保持专业名称含义；不要机械截断或为了消除 warning 删除事实。问题节点只写现象和原因；方法单独建节点。拆点时同步修正卡片、父级和边，不能留下孤立引用。

保存修复后的 {topic,profile,network} 到新文件并重新运行 validate。只有实际核验的来源才能称为已验证；结构通过不代表知识正确。若改变 Profile 核心设计，重新展示 MVP 获取用户确认；事实修正无需重复请求已授权的文件编辑。
