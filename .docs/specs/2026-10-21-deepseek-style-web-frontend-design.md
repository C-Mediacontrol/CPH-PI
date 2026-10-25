# CPH-PI Web 前端架构与 DeepSeek-Harness 风格复刻设计规约

- **创建日期**：2026-10-21
- **状态**：Approved (已确认)
- **文档编号**：`2026-10-21-deepseek-style-web-frontend-design`
- **实施目标**：为 CPH-PI 项目设计并构建基于 Node.js 的 Web 交互与实时监控前端，1:1 照搬 `Library/deepseek-harness` 的三栏 GUI 视觉质感、设计 Token 与核心交互元素，并深度融合 CPH-PI 的工程治理特性（Ledger WAL 账本与上下文指纹探查）。

---

## 1. 目标与设计原则

1. **视觉与交互像素级对齐 (1:1 Visual & Interaction Parity)**：
   * 照搬 DeepSeek-Harness 的三栏栅格视口（`AppFrame`：左侧边栏 56px 折叠轨道 / 展开态，中栏对话执行流，右侧多标签协同 DockKit 面板）。
   * 复刻原生 Design Tokens（DeepSeek Blue `#4176e6`、底色 `#0f1115`、卡片 `#15171b`、发丝分割线 `0.5px solid rgba(255,255,255,0.08)`、Montserrat 字体栈与思维链扫光 `TextShimmer`）。
2. **CPH-PI 核心特色深度定制 (Customized Alignment with CPH-PI)**：
   * 在右侧协同面板中，保留 DeepSeek 原生的工作区文件树（Files）、实时终端（Terminal）与差异预览（Doc/Diff）。
   * 专有集成 **持久化账本监视器 (`LedgerWALViewer`)** 与 **上下文与指纹探查器 (`ContextInspector`)**，直观呈现物理磁盘预写日志（`.cph/state/`）与工作内存分配。
3. **微单体同构与零额外重型依赖 (Clean Embedded Node.js Architecture)**：
   * 前端使用 React 18 + Vite + TypeScript 构建于 `CPH-PI/web`。
   * 服务端扩展于 `CPH-PI/src/web`，基于 Node.js 原生 `node:http` 与 CPH-PI 现有的 `ws` 库构建轻量服务，支持通过 `cph-pi web` 命令一键拉起并自动打开浏览器。
4. **严格遵从《AGENTS.md》治理铁律**：
   * 严禁向工作区根目录写入任何文件，所有代码、配置与文档均严格限定在 `CPH-PI/` 目录下。
   * 遵循“状态持久化与工作内存正交分层”准则与“黑盒抽象”原则。

---

## 2. 系统整体架构与目录结构

```
CPH-PI/
├── web/                             # 前端工程 (Vite + React 18 + TypeScript)
│   ├── index.html                   # 注入 #root、Montserrat 字体栈与品牌图标
│   ├── package.json                 # 前端依赖 (react, react-dom, clsx, lucide-react 等)
│   ├── vite.config.ts               # 开发构建配置 (含 WebSocket / API 代理)
│   ├── tsconfig.json                # TypeScript 严格模式配置
│   └── src/
│       ├── main.tsx                 # 客户端入口，挂载 AppFrame
│       ├── styles/
│       │   ├── tokens.css           # 1:1 提取自 DeepSeek design-platform.css 的暗色/蓝调变量
│       │   ├── base.css             # 全局排版、发丝边框、滚动条、代码高亮底色
│       │   └── shimmer.css          # 思维链 (CoT) 专用的流式微光扫光动效
│       ├── types/                   # 前后端共享协议契约定义 (Session, Turn, Tool, WAL, Metrics)
│       │   ├── session.ts
│       │   ├── message.ts
│       │   ├── tool.ts
│       │   ├── ledger.ts
│       │   └── context.ts
│       ├── services/
│       │   ├── client-ws.ts         # WebSocket 客户端连接管理、心跳与断线重连
│       │   └── store.ts             # 响应式状态管理 (当前会话、消息流、右侧面板状态)
│       └── components/
│           ├── layout/              # 整体三栏骨架
│           │   ├── AppFrame.tsx     # 1:1 照搬的左-中-右可拖拽三栏网格容器
│           │   ├── AppFrame.module.css
│           │   ├── Sidebar.tsx      # 左侧会话与工作区导航栏 (56px 轨道 / 展开态)
│           │   ├── Sidebar.module.css
│           │   ├── Rightbar.tsx     # 右侧多标签协同面板宿主
│           │   └── Rightbar.module.css
│           ├── chat/                # 主交互与对话执行流组件
│           │   ├── ChatView.tsx     # 消息流与 Turn 渲染器
│           │   ├── ChatView.module.css
│           │   ├── MessageItem.tsx  # 用户提问卡片与附件展示
│           │   ├── ReasoningRow.tsx # 深度思考折叠条 (Reasoning 微光动效)
│           │   ├── ReasoningRow.module.css
│           │   ├── ToolCard.tsx     # 工具调用卡片 (终端输出、Diff 对比折叠)
│           │   ├── ToolCard.module.css
│           │   ├── StatsPills.tsx   # Token 消耗、TPS、耗时与模型胶囊徽标
│           │   └── Composer.tsx     # 底部交互输入框 (支持 / 命令提示与两段式中断按键)
│           ├── panels/              # 右侧 5 大协同与监控面板
│           │   ├── FileExplorer.tsx # 工作区文件树与 Git 变更状态
│           │   ├── TerminalPanel.tsx# 实时控制台/伪终端流
│           │   ├── DiffViewer.tsx   # 差异审查代码预览器
│           │   ├── LedgerWALViewer.tsx # 持久化账本监视器 (实时流式查看 .cph/state/ 日志)
│           │   └── ContextInspector.tsx# 工作内存探针 (Working Memory / TOC 物理指纹)
│           └── primitives/          # 基础 UI 原语 (Button, Tooltip, Modal, Tabs)
│
└── src/
    └── web/                         # CPH-PI 核心层内置 Web 服务
        ├── server.ts                # 基于 node:http + ws 的轻量服务器 (静态托管 + WS 路由)
        ├── rpc-handler.ts           # 衔接 SessionManager、ExecutionLedger 与前端请求
        └── static-handler.ts        # 生产环境下对 web/dist 静态产物的流式读取与响应
```

---

## 3. UI 布局引擎与设计系统规范 (Tokens)

### 3.1 三栏网格布局 (`AppFrame`)
1. **Grid 定义**：
   ```css
   .frame {
     display: grid;
     grid-template-columns: var(--sidebar-w, 260px) minmax(460px, 1fr) var(--rightbar-w, 420px);
     height: 100vh;
     overflow: hidden;
     background: var(--dsw-alias-bg-base);
   }
   ```
2. **拖拽手柄 (`DragHandle`)**：
   * 在左栏/中栏、中栏/右栏交界处设置 4px 隐式捕获条，悬浮或拖拽时高亮为 DeepSeek 蓝。
   * 基于 `pointerId` 与 `requestAnimationFrame` 节流更新列宽，拖拽进行中给 `.frame` 添加 `[data-dragging]` 禁用动画避免粘连。
3. **左侧栏折叠策略**：
   * 展开态（260px）：完整展示 Logo、新建对话、会话历史列表、工作区信息与设置入口。
   * 收起态（56px Rail）：宽幅文本与列表在 150ms 内平滑淡出，保留居中的图标导轨，释放视口空间。
4. **右侧栏自适应**：
   * 宽度在 320px~720px 间自由拉伸；屏幕宽度 `< 768px` 时自动进入全屏抽屉模式。

### 3.2 DeepSeek 原生色彩与样式规范 (`tokens.css`)
* **品牌蓝 (DeepSeek Brand Colors)**：
  * 主色：`--dsw-static-deepseek-500: #4176e6`
  * 浅亮/悬浮态：`--dsw-static-deepseek-400: #679efe`
  * 焦点微光：`--dsw-static-deepseek-100: rgba(65, 118, 230, 0.15)`
* **暗黑中性背景色 (Neutral Bluish Surfaces)**：
  * 视口主底色：`--dsw-alias-bg-base: #0f1115`
  * 卡片与浮层：`--dsw-surface-base: #15171b` / `#1a1d24`
  * 侧栏磨砂：`--dsw-specific-sidebar-fill: rgba(21, 23, 27, 0.75)` + `backdrop-filter: blur(12px)`
* **发丝级轮廓与排版**：
  * 边框：`0.5px solid rgba(255, 255, 255, 0.08)`
  * 字体栈：`Montserrat, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`
  * 代码等宽：`"Fira Code", "JetBrains Mono", Consolas, monospace`

---

## 4. 核心交互组件详细设计

### 4.1 中央对话流与执行卡片
1. **会话 Header**：
   * 呈现当前会话名称、主导 Agent 徽标（如 `cph-dev-agent`）、右栏展开/折叠切换按钮。
2. **思维链折叠行 (`ReasoningRow`)**：
   * 未展开且正在输出时，带有文本扫光效果（`TextShimmer`），显示当前正在思考的单行摘要。
   * 点击可展开完整 Markdown 思考链，使用次级暗色底板与弱化字号展示。
3. **工具调用卡片 (`ToolCard`)**：
   * 头部展示工具名（`read_file`, `edit`, `run_command` 等）、耗时与状态指示（运行中 Spinner、成功勾选、失败叹号）。
   * 终端类工具展示折叠等宽终端输出；代码修改类工具自动呈现红绿行级 Diff 对比。
4. **度量指标胶囊 (`StatsPills`)**：
   * Turn 结束后展示度量条：`[耗时 3.2s]` `[Token 1,420]` `[速度 45 tps]` `[Copilot M365]`。
5. **输入器 (`Composer`)**：
   * 自动伸缩多行输入框，支持 `Shift+Enter` 换行。
   * 键入 `/` 唤起命令建议（`/plan`, `/handoff`, `/debugmode`）。
   * 发送按钮在执行中自动切换为两段式中断按钮（Stop）。

### 4.2 右侧 5 大协同与监控面板 (DockKit)
1. **Files (`FileExplorer.tsx`)**：工作区文件树，标注 Git 增删改状态。
2. **Terminal (`TerminalPanel.tsx`)**：实时捕获工具 stdout/stderr 输出，支持自动滚动与锁定。
3. **Doc / Diff (`DiffViewer.tsx`)**：代码差异审查与生成文档阅览。
4. **Ledger WAL (`LedgerWALViewer.tsx`) [CPH-PI 核心特色]**：
   * 实时读取 `.cph/state/` 磁盘预写日志。
   * 时间轴视图呈现 Step 序号、工具调用、哈希指纹、状态码与证据路径。
5. **Context (`ContextInspector.tsx`) [CPH-PI 核心特色]**：
   * 内存预算进度条（当前工作内存占用 vs 模型上下文上限）。
   * 轻量物理指纹（TOC / Fingerprint Header）预览与活跃 Skill 清单。

---

## 5. Node.js 服务端与通信协议契约

### 5.1 服务端实现 (`CPH-PI/src/web/server.ts`)
* 采用 `node:http` 处理静态文件托管与 REST API。
* 挂载 `ws` Server 监听 `/ws` 端点。
* 支持 CLI 参数：`--port <port>`（默认 3000）、`--host <host>`（默认 127.0.0.1）、`--no-open`。

### 5.2 全双工 WebSocket 消息结构
```typescript
interface WsPacket<T = unknown> {
  type: string;
  id?: string;
  payload: T;
}
```

* **下行事件 (Server ➔ Client)**：
  * `session:snapshot`：连接初始化快照（会话列表、当前 Turn 历史、工作区路径）。
  * `turn:start`：新轮次开始。
  * `reasoning:chunk`：思维链增量 Token。
  * `assistant:chunk`：回复正文增量 Token。
  * `tool:call` / `tool:output` / `tool:settle`：工具执行生命周期与增量日志。
  * `wal:append`：磁盘 WAL 日志追加广播。
  * `context:metrics`：工作内存与 Token 统计更新。
  * `turn:end`：轮次结束度量胶囊。

* **上行指令 (Client ➔ Server)**：
  * `user:submit`：提交输入内容与附件。
  * `user:interrupt`：两段式中断请求。
  * `session:switch` / `session:new`：会话管理。
  * `fs:inspect`：请求特定文件详情。

* **连接稳定性**：30s 心跳 Ping/Pong，断线后客户端按 1s、2s、4s、8s 指数退避重连，重连后发送校验自动对账增量。

---

## 6. 构建与 CLI 集成

1. **前端编译与依赖**：
   * `package.json`：包含 `react`, `react-dom`, `clsx`, `lucide-react`。
   * 构建命令：`cd web && bun run build` 输出至 `CPH-PI/web/dist`。
2. **CPH-PI 根级命令**：
   * `bun run web`：调用 `src/cli.ts web` 启动。
   * `bun run web:dev`：启动 Vite 独立开发服务器。
   * `bun run web:build`：编译前端产物。
3. **CLI 子命令实现**：
   * 在 `src/cli.ts` 中注册 `web` 子命令，自动检测 `web/dist`，启动 `src/web/server.ts` 并唤起系统默认浏览器。

---

## 7. 验证与验收标准

1. **外观与风格验证**：
   * 浏览器打开 `http://localhost:3000`，整体色彩暗度、发丝分割线、Montserrat 字体排版与 DeepSeek-Harness 截图完全一致。
   * 左侧栏能平滑折叠至 56px Rail 并在展开时恢复；左右分割线拖拽平滑无卡顿。
2. **交互与流式验证**：
   * 提交 Prompt 后，思维链具备明显的扫光动效；展开后排版规整。
   * 工具调用卡片可实时输出日志并展开 Diff 预览。
   * 底部指标胶囊在交付后正确更新。
3. **CPH-PI 专有面板验证**：
   * 触发工具调用时，右侧 `Ledger WAL` 标签页即时同步产生物理日志时间轴节点。
   * `Context` 标签页能直观显示当前已用 Token 与工作内存百分比。

