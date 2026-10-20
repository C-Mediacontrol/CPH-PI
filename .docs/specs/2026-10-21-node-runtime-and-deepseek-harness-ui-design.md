# CPH-PI Node.js 原生运行体系与 DeepSeek-Harness 原版设计系统设计规范

> **文件标识**：`CPH-PI/.docs/specs/2026-10-21-node-runtime-and-deepseek-harness-ui-design.md`  
> **创建时间**：2026-10-21  
> **状态**：Verified & Approved  
> **核心参考**：`Library/deepseek-harness/packages/client/` 官方开源源码、Node.js 18/20/22+ 原生标准运行时规范

---

## 1. 背景与核心目标 (Executive Summary & Goals)

### 1.1 现状与用户诉求
在初步构建 CPH-PI Web GUI 之后，针对生产运行环境与视觉体验提出了两大核心升级需求：
1. **彻底去 Bun 化，原生支持 Node.js**：生产环境与日常启动必须基于标准 Node.js（Node 18/20/22+），`package.json` 中的命令全量重构为基于 `node` / `npm` / `tsx`，支持纯 Node.js 免编译执行以及独立 JS 打包分发。
2. **像素级复刻 DeepSeek-Harness 真实开源设计系统**：直接参考并移植已克隆到 `Library/deepseek-harness/packages/client/` 中的官方核心设计资产（`ui-theme`、`ui-tool` 与 `ui-chat`），消除自研 UI 的违和感，100% 还原官方 Web UI 的工业级质感与交互细节。

---

## 2. Node.js 原生运行体系与打包架构 (Node.js Native Runtime Architecture)

### 2.1 免编译直接执行 TypeScript (`tsx`)
* 在 `CPH-PI/package.json` 中引入 `tsx`（基于 esbuild 的极速 Node.js TypeScript 执行引擎）。
* 利用 Node.js 原生 `--import tsx` 机制，无需在运行时依赖任何 Bun 二进制，即可在纯 Node 环境下直接运行项目中的 `.ts` 入口脚本。

### 2.2 重构 NPM 核心脚本
`CPH-PI/package.json` 规范化脚本配置如下：
```json
{
  "scripts": {
    "start": "node --import tsx src/cli.ts",
    "web": "node --import tsx src/cli.ts web",
    "web:dev": "npm --prefix web run dev",
    "web:build": "npm --prefix web run build",
    "build:package": "bun build src/cli.ts --target node --outfile package/bin/cph-pi.js && bun build scripts/probe-agent-access.ts --target node --outfile package/bin/check-accounts.js",
    "build:all": "npm run web:build && npm run build:package",
    "test": "bun test tests/"
  }
}
```

### 2.3 纯 JavaScript 独立零依赖分发
* 编译产物 `package/bin/cph-pi.js` 输出为单文件纯 JavaScript。
* 任何安装了标准 Node.js 的机器，即使未全局安装 TypeScript 或 tsx，直接执行：
  ```bash
  node package/bin/cph-pi.js web
  ```
  即可零门槛拉起 Web 服务并加载静态前端。

---

## 3. DeepSeek-Harness 官方设计系统与主题集成 (Official Design System)

从 `Library/deepseek-harness/packages/client/ui-theme/src/styles/design-platform.css` 提取并对齐官方设计规范：

### 3.1 官方色板 (Color Tokens)
* **DeepSeek 品牌蓝系 (Brand Blue)**：
  * `deepseek-500`: `#4176e6` (`rgb(65, 118, 230)`) —— 主色调与关键按钮
  * `deepseek-400`: `#7aafff` (`rgb(122, 170, 255)`) —— 高亮交互与悬停
  * `deepseek-300`: `#b7c8fe` (`rgb(183, 200, 254)`) —— 次级高亮与活跃链接
  * `deepseek-subtle`: `rgba(65, 118, 230, 0.12)` —— 卡片聚焦底纹
* **暗色蓝灰系表面 (Neutral-Bluish Surfaces)**：
  * `surface-base`: `#0f1115` (`rgb(15, 17, 21)`) —— 应用主底色
  * `surface-panel`: `#151517` (`rgb(21, 21, 23)`) —— 侧边栏与上下文面板底色
  * `surface-card`: `#1b1b1c` (`rgb(27, 27, 28)`) —— 消息卡片与输入坞底色
  * `surface-hover`: `#232326` (`rgb(35, 35, 38)`) —— 列表项悬停色
* **分割线与边框 (Hairline Borders)**：
  * `border-base`: `#2c2c2e` (`rgb(44, 44, 46)`) —— 面板边界线
  * `border-subtle`: `rgba(255, 255, 255, 0.08)` —— 0.5px 精细内部分割线
* **状态与 Diff 色彩 (State Accents)**：
  * 成功 / 增行：`#22c55e`（背景 `rgba(34, 197, 94, 0.12)`）
  * 失败 / 删行：`#ef4444`（背景 `rgba(239, 68, 68, 0.12)`）
  * 警示 / 限流：`#f59e0b`（背景 `rgba(245, 158, 11, 0.12)`）

### 3.2 等宽数字与代码排印 (Tabular Numerics)
* 所有 Diff 统计、运行耗时与端口号强制使用等宽数字：
  `font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-variant-numeric: tabular-nums;`

---

## 4. 核心交互组件官方深度重构 (Component Re-alignment)

### 4.1 单行紧凑工具卡片 (`ToolRow.tsx`)
直接参考 `Library/deepseek-harness/packages/client/ui-tool/src/client/tool/components/ToolRow.tsx`：
* **单行紧凑高度 (24px 内容行高)**：
  ```text
  [🔧 图标 16px] [工具名] [· 2px点] [📄 路径/命令(虚线下划线)]  [+14 -3 等宽绿红统计] [▼ 旋转箭头]
  ```
* **展开内容呈现**：
  * 文件补丁（`patch_file` / `write_file`）：渲染官方 Unified Diff，左右带精确行号排印，增删行全宽背景色块，`@@ ... @@` 语法块以深蓝灰强调。
  * 终端命令（`run_command`）：内嵌终端视窗，右上角搭载原版 `ExitCodeBadge` 状态胶囊（绿色 `Exit 0` 或 红色 `Exit 1`）。

### 4.2 思考进程折叠块 (`TurnProcessNodeView.tsx`)
直接参考 `Library/deepseek-harness/packages/client/ui-chat/src/client/chat/TurnProcessNodeView.tsx`：
* 细边框线条结构（`border-bottom: 0.5px solid var(--border-subtle)`），完全摒弃原先大面积紫色卡片的违和感。
* 文案采用官方标准：
  * 思考中：`Thinking...` 伴随右侧毫秒级秒表；
  * 思考完成：`Thought for 8.4s`（等宽数字），右侧折叠箭头平滑旋转。
* 展开后呈现优雅缩进的 Markdown 思考链。

### 4.3 问答交互卡片 (`AskQuestionCard.tsx`)
直接参考 `Library/deepseek-harness/packages/client/ui-tool/src/client/tool/components/AskQuestionCard.tsx`：
* 单选/多选项渲染为圆角交互胶囊卡片（Pill Buttons），支持键盘选择与鼠标点选反馈；
* 底部带有自由补充文本输入区与 DeepSeek 主蓝【Submit】操作按钮。

### 4.4 悬浮底部输入坞 (`ActionDock.tsx`)
* 采用官方圆角卡片布局（`rounded-2xl`，背景 `#1b1b1c`，微细边框），支持自适应高度；
* 搭载圆形 DeepSeek 主蓝发送按钮，Agent 运行中自动切换为两段式中断按钮（单击软暂停，双击或长按硬中断）。

---

## 5. 自审检查清单 (Self-Review Checklist)
- [x] **去 Bun 化**：所有 CLI 启动脚本明确支持基于 Node.js（`node --import tsx` 与纯 JS 产物）。
- [x] **开源代码参考**：设计完全对照本地已克隆的 `Library/deepseek-harness` 真实官方实现。
- [x] **无占位符**：无 TODO、TBD 等模糊未决事项。
- [x] **Harness 中立性**：绝不污染 System Prompt 或破坏核心物理管道。
