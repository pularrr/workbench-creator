// 测试 Profile 设计器 API（避免 PowerShell 中文编码问题）
const body = JSON.stringify({
  topic: "激光雷达技术路线",
  taskDescription: "生成激光雷达技术路线知识网络，覆盖原理、光源、接收、信号处理、点云算法、系统集成与应用全链路"
});

console.log("请求体:", body);
console.log("正在调用 /api/profile/design...");

const startTime = Date.now();

fetch("http://localhost:3000/api/profile/design", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body
})
  .then(async (res) => {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`状态码: ${res.status} (耗时 ${elapsed}s)`);

    const text = await res.text();
    if (!res.ok) {
      console.error("错误响应:", text.substring(0, 500));
      process.exit(1);
    }

    const result = JSON.parse(text);
    console.log("\n=== Profile 设计结果 ===");
    console.log("Profile ID:", result.profile.id);
    console.log("名称:", result.profile.name);
    console.log("域数量:", result.profile.domains?.length);
    console.log("视觉分支:", result.profile.visualBranches?.length);
    console.log("节点类型数量:", result.profile.nodeTypes?.length);
    console.log("边类型数量:", result.profile.edgeTypes?.length);
    console.log("栏目数量:", result.profile.cardSections?.length);
    console.log("迭代次数:", result.iterations);
    console.log("校验问题:", result.validationIssues?.length);
    console.log("警告:", result.warnings?.join("; "));

    if (result.profile.domains) {
      console.log("\n=== 域划分 ===");
      result.profile.domains.forEach((d, i) => {
        console.log(`${i + 1}. ${d.id} (${d.name}) - ${d.description?.substring(0, 50)}`);
      });
    }
  })
  .catch((err) => {
    console.error("请求失败:", err.message);
    process.exit(1);
  });
