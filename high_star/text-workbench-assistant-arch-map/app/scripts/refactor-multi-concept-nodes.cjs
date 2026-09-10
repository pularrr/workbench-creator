/**
 * P0-1: 重构多概念节点
 * - 拆分 motion-models → CV / CA / CTRV / CTRA
 * - 拆分 kf-family → KF / EKF / UKF
 * - 拆分 iaa-omp-relax → IAA / OMP / RELAX
 * - 拆分 fdma-cdma → FDMA / CDMA
 * - 缩短过长 shortFact
 * 用法: node scripts/refactor-multi-concept-nodes.cjs
 */
const fs = require("fs");
const path = require("path");

const STATE_PATH = path.join(__dirname, "..", "data", "runtime", "knowledge-state.json");
const raw = fs.readFileSync(STATE_PATH, "utf8");
const state = JSON.parse(raw);
const ds = state.state.dataset;

function makeNode(id, canonicalName, shortFact, nodeType, domainId, visualBranch, parentId, level, order) {
  return {
    id,
    canonicalName,
    shortFact,
    aliases: [],
    nodeType,
    domainId,
    visualBranch,
    primaryParentId: parentId,
    level,
    order,
    tags: [],
    status: "published",
  };
}

function makeCard(nodeId, headline, blocks) {
  return {
    nodeId,
    headline,
    blocks,
    formulaIds: [],
    evidenceIds: [],
    revision: 1,
  };
}

function defBlock(title, text) {
  return { type: "definition", title, text };
}

// ========== 1. motion-models 拆分 ==========
const mmParent = ds.nodes.find((n) => n.id === "motion-models");
mmParent.canonicalName = "运动模型";
mmParent.shortFact = "描述目标机动的状态空间模型";
const mmCard = ds.cards.find((c) => c.nodeId === "motion-models");
mmCard.headline = "CV / CA / CTRV / CTRA 分别描述直行、加速、恒转向率和带切向加速度的转弯机动";
mmCard.blocks = [
  defBlock("定义与原理", "运动模型用状态空间方程描述目标机动。CV 假设速度近似常量；CA 引入加速度；CTRV 保持转向率和速度；CTRA 同时允许切向加速度。模型复杂度增加也会扩大不可观测状态与调参难度。"),
];

const mmChildren = [
  { id: "cv-model", name: "CV 模型", fact: "恒速模型，假设速度近似常量", type: "model", text: "CV（Constant Velocity）假设目标速度近似恒定，状态向量通常为 [x, y, vx, vy]。适用于匀速直行场景，模型简单但在加速或转弯时误差大。" },
  { id: "ca-model", name: "CA 模型", fact: "恒加速模型，引入加速度状态", type: "model", text: "CA（Constant Acceleration）在 CV 基础上引入加速度状态，状态向量扩展为 [x, y, vx, vy, ax, ay]。适用于匀加速场景，能更好跟踪加减速目标，但噪声协方差需仔细调参。" },
  { id: "ctrv-model", name: "CTRV 模型", fact: "恒转向率恒速模型", type: "model", text: "CTRV（Constant Turn Rate and Velocity）假设转向率和速度恒定，状态向量为 [x, y, v, yaw, yawRate]。适用于匀速转弯场景，是非线性模型，通常需 EKF/UKF 处理。" },
  { id: "ctra-model", name: "CTRA 模型", fact: "恒转向率恒加速模型", type: "model", text: "CTRA（Constant Turn Rate and Acceleration）在 CTRV 基础上允许切向加速度，状态向量为 [x, y, v, yaw, yawRate, a]。适用于加速转弯场景，模型最复杂，不可观测状态和调参难度也最大。" },
];
mmChildren.forEach((child, i) => {
  ds.nodes.push(makeNode(child.id, child.name, child.fact, child.type, "estimation", "data", "motion-models", 4, mmParent.order + 1 + i));
  ds.cards.push(makeCard(child.id, child.fact, [defBlock("定义与原理", child.text)]));
});

// ========== 2. kf-family 拆分 ==========
const kfParent = ds.nodes.find((n) => n.id === "kf-family");
kfParent.canonicalName = "卡尔曼滤波族";
kfParent.shortFact = "线性与非线性状态估计算法";
const kfCard = ds.cards.find((c) => c.nodeId === "kf-family");
kfCard.headline = "KF / EKF / UKF 分别处理线性、一阶线性化和 Sigma 点非线性逼近";
kfCard.blocks = [
  defBlock("定义与原理", "卡尔曼滤波族用于状态估计。KF 对线性高斯系统给出闭式递推；EKF 用雅可比线性化；UKF 传播一组 sigma 点逼近非线性变换后的均值和协方差。"),
  { type: "failure_mode", title: "常见误区 / 失效条件", text: "滤波发散常来自模型、时间戳、坐标变换或协方差设置错误，而非矩阵公式本身。" },
];

const kfChildren = [
  { id: "kf", name: "KF 卡尔曼滤波", fact: "线性高斯系统的闭式递推估计", type: "algorithm", text: "KF（Kalman Filter）适用于线性高斯系统，通过预测-更新两步递推给出最小均方误差估计。计算量小，是 EKF/UKF 的基础。" },
  { id: "ekf", name: "EKF 扩展卡尔曼滤波", fact: "用雅可比矩阵对非线性系统一阶线性化", type: "algorithm", text: "EKF（Extended Kalman Filter）在每个时间步用雅可比矩阵对非线性函数做一阶泰勒展开，然后套用 KF 框架。适用于弱非线性系统，强非线性时线性化误差可能导致发散。" },
  { id: "ukf", name: "UKF 无迹卡尔曼滤波", fact: "通过 Sigma 点传播逼近非线性变换", type: "algorithm", text: "UKF（Unscented Kalman Filter）不做线性化，而是选取一组 Sigma 点通过非线性函数传播，再统计均值和协方差。对强非线性系统精度通常优于 EKF，但计算量略大。" },
];
kfChildren.forEach((child, i) => {
  ds.nodes.push(makeNode(child.id, child.name, child.fact, child.type, "estimation", "data", "kf-family", 4, kfParent.order + 1 + i));
  ds.cards.push(makeCard(child.id, child.fact, [defBlock("定义与原理", child.text)]));
});

// ========== 3. iaa-omp-relax 拆分 ==========
const iaaParent = ds.nodes.find((n) => n.id === "iaa-omp-relax");
iaaParent.canonicalName = "超分辨谱估计";
iaaParent.shortFact = "提升近邻目标分辨的迭代/稀疏方法";
const iaaCard = ds.cards.find((c) => c.nodeId === "iaa-omp-relax");
iaaCard.headline = "IAA / OMP / RELAX 分别通过迭代加权、稀疏贪心和逐目标优化提升近邻分辨";
iaaCard.blocks = [
  defBlock("定义与原理", "超分辨谱估计方法用于突破 FFT 瑞利限。IAA 迭代更新谱功率与协方差；OMP 在离散字典上逐次选择原子；RELAX 交替重估各正弦参数。三者都可能提升近邻分辨，但对字典失配、停止条件和算力敏感。"),
];

const iaaChildren = [
  { id: "iaa", name: "IAA 迭代自适应方法", fact: "迭代更新谱功率与协方差的超分辨方法", type: "algorithm", text: "IAA（Iterative Adaptive Approach）通过迭代更新每个频率点的谱功率和干扰协方差，实现自适应波束形成。不依赖稀疏假设，对连续谱场景鲁棒，但计算量较大。" },
  { id: "omp", name: "OMP 正交匹配追踪", fact: "离散字典上逐次选择原子的稀疏贪心方法", type: "algorithm", text: "OMP（Orthogonal Matching Pursuit）在过完备字典上逐次选择与残差最相关的原子，然后正交化更新残差。适用于稀疏目标场景，但对字典失配和停止条件敏感。" },
  { id: "relax", name: "RELAX 算法", fact: "交替重估各正弦参数的超分辨方法", type: "algorithm", text: "RELAX 通过交替重估每个正弦分量的幅度、频率和相位，逐步消去已估计分量的干扰。适用于多正弦信号分离，收敛性好但目标数较多时计算量增加。" },
];
iaaChildren.forEach((child, i) => {
  ds.nodes.push(makeNode(child.id, child.name, child.fact, child.type, "spectral-rva", "signal", "iaa-omp-relax", 4, iaaParent.order + 1 + i));
  ds.cards.push(makeCard(child.id, child.fact, [defBlock("定义与原理", child.text)]));
});

// ========== 4. fdma-cdma 拆分 ==========
const fdmaParent = ds.nodes.find((n) => n.id === "fdma-cdma");
fdmaParent.canonicalName = "MIMO 波形复用";
fdmaParent.shortFact = "用频率或码区分发射天线";
const fdmaCard = ds.cards.find((c) => c.nodeId === "fdma-cdma");
fdmaCard.headline = "FDMA / CDMA 分别用频率和码序列区分不同 TX";
fdmaCard.blocks = [
  defBlock("定义与原理", "MIMO 雷达中需区分不同发射天线的信号。FDMA 给不同 TX 分配载频/子带，可能引入不同波长和距离耦合；CDMA 用码序列分离，需要低互相关码和匹配处理。"),
];

const fdmaChildren = [
  { id: "fdma", name: "FDMA 频分多址", fact: "给不同 TX 分配载频或子带", type: "method", text: "FDMA（Frequency Division Multiple Access）为每个发射天线分配不同的载频或子带，接收端通过频率滤波分离。实现简单但不同载频引入不同波长，可能导致距离-角度耦合。" },
  { id: "cdma", name: "CDMA 码分多址", fact: "用正交码序列区分不同 TX", type: "method", text: "CDMA（Code Division Multiple Access）为每个发射天线分配不同的码序列，接收端通过匹配滤波分离。所有 TX 共享同一频段，避免波长差异，但需要低互相关码和额外的匹配处理算力。" },
];
fdmaChildren.forEach((child, i) => {
  ds.nodes.push(makeNode(child.id, child.name, child.fact, child.type, "system-hardware", "system", "fdma-cdma", 4, fdmaParent.order + 1 + i));
  ds.cards.push(makeCard(child.id, child.fact, [defBlock("定义与原理", child.text)]));
});

// ========== 5. 缩短过长 shortFact ==========
const markovNode = ds.nodes.find((n) => n.id === "node-c18448a7");
if (markovNode) {
  markovNode.canonicalName = "马尔可夫转移矩阵";
  markovNode.shortFact = "IMM 中运动模式间的跳变概率";
  const markovCard = ds.cards.find((c) => c.nodeId === "node-c18448a7");
  if (markovCard) {
    markovCard.headline = "IMM 中运动模式间的跳变概率矩阵";
    markovCard.blocks = [defBlock("定义与边界", "马尔可夫转移概率矩阵表示目标在不同运动模型（如 CV/CA/CTRV）之间跳变的概率，决定 IMM 的混合权重与模型概率更新。")];
  }
}

// ========== 6. 同步节点也缩短 ==========
const syncNode = ds.nodes.find((n) => n.id === "sync");
if (syncNode) {
  syncNode.canonicalName = "同步误差";
  syncNode.shortFact = "时间不同步导致的位置错位";
}

// 更新 contentRevision
state.state.contentRevision = (state.state.contentRevision || 0) + 1;

// 无 BOM 写入
fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), "utf8");
console.log("重构完成！");
console.log("节点总数:", ds.nodes.length, "(+12 子节点)");
console.log("卡片总数:", ds.cards.length, "(+12 子卡片)");
console.log("拆分的父节点: motion-models, kf-family, iaa-omp-relax, fdma-cdma");
console.log("缩短的节点: node-c18448a7(马尔可夫转移矩阵), sync(同步误差)");
