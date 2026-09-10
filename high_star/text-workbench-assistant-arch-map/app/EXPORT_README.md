# FMCW 雷达知识图谱源码导出说明

此压缩包包含当前站点的完整可移植源码，导出自提交 `6003403440c3`。

## 本地运行

要求：Node.js 22.13 或更高版本。

```bash
npm ci
npm run dev
```

生产构建：

```bash
npm run build
```

## 主要文件

- `app/knowledge.ts`：FMCW 雷达知识图谱节点与关系数据。
- `app/page.tsx`：渐进披露式知识图谱界面与交互逻辑。
- `app/globals.css`：明暗主题、画布、节点和响应式样式。
- `package.json`、`package-lock.json`：依赖及运行脚本。
- `.openai/hosting.json`：ChatGPT Sites 托管配置；部署到其他平台时可忽略或删除。

## 导出边界

为确保压缩包便于复用，未包含 `node_modules`、构建产物、Git 历史、Sites 运行时缓存、日志或本地密钥。依赖可通过 `npm ci` 完整恢复。
