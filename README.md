# CPH-PI：Microsoft Copilot 工作区同步与自主编程终端

> 把 Microsoft 365 Copilot 接进本地工作区：工具调用、文件修改和长任务接力都在本地完成；本地改动会增量镜像到 SharePoint 云端工作区，交付物自动落盘并回传云端。

---

## 1. 项目定位

CPH-PI 是一个跑在本地终端里的 Agent 运行时：

- **推理交给 Copilot**。通过 ChatHub 的 SignalR 双工通道与企业 M365 Copilot 通信，默认锁定最新一代 GPT-6.1 Sol 推理模型（模型枚举 `Gpt_61_Sol_Reasoning`）。
- **执行留在本地**。读写文件、打补丁、跑命令、下载云端生成的文件、调度子代理，全部在本地工作区完成；会话与执行账本落在 `.cph/`。
- **现在的主线是工作区同步**。本地工作区是单一真实源（SSOT），改动按 SHA256 增量镜像到 SharePoint 云端工作区，支持目录双轨、URL 对账、孤儿回收、镜像校验，并把完整目录清单做成 Copilot 可读的云端附件。

### 关于名字里的 "Pi"

`CPH-PI` 出自早期"Copilot × Pi"原型。当前仓库**没有 `pi/` 子目录，也不依赖 `@earendil-works/pi`**，是一套独立的 TypeScript/Node 实现。CLI 帮助与版本号里仍保留的 `Copilot-Pi Hybrid Autonomous Coding Agent` 属于历史名称，不影响运行。

### 适合谁

- 已经有企业 Microsoft 365 / Copilot 订阅，希望让 Copilot 在自己电脑上持续写代码、改文件、跑测试的人。
- 需要把本地工程定期镜像到 SharePoint 云端工作区，并让 Copilot 直接基于云端清单推理的人。
- 需要长任务断点续跑、跨会话交接、可审计执行记录的场景。

### 已知边界

- 不提供 Copilot 订阅，也不绕过企业权限；需要合法 M365 账号与租户内可用的 Copilot 专属 Agent。
- 云端物理镜像依赖仓库里的 `scripts/sp-sync-engine.ps1` 与 `scripts/lib/PnPSession.psm1`，且要求 **Windows PowerShell 5.1**（不支持 pwsh 7+）。
- Web 控制台需要仓库内构建的 `web/dist`；`package/` 独立运行包只带终端运行时，不带前端产物。

---

## 2. 核心能力

### 2.1 本地工作区 ↔ SharePoint 云端工作区

- **增量镜像**：`PnPWorkspaceSyncEngine` 调用 `scripts/sp-sync-engine.ps1`，用 `.cph/state/sync-manifest.json` 记录 SHA256 基线；未变更的文件跳过，失败重试 3 次并写入 `dirty-sync.jsonl`。
- **本地优先**：本地文件是唯一真实源，同名文件以本地覆盖云端。
- **编辑后自动同步**：每次 `edit` / `write_file` 成功后，如果工作区已绑定云端，会自动把该文件同步到 SharePoint（单文件 15 秒超时；失败时在工具回执里标 `Cloud Mirror: PENDING`，不会阻塞任务）。
- **目录双轨**：文件与空目录分别对齐，支持空目录保留、孤儿目录自底向上回收。
- **镜像校验与 URL 对账**：`VerifyMirror` 校验云端一致性；`ReconcileUrls` 修正工作区迁移后 manifest 里的旧 URL。
- **首轮索引**：根据 manifest 生成 `.cph/state/virtual-repo-map.md`，压缩后注入首轮提示词，默认上限 24,000 字符（可用环境变量 `CPH_TURN1_INDEX_MAX_CHARS` 调整）。
- **手动全量同步**：在 Web 控制台点「校验云端 / 同步云端」，或直接运行脚本：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\sp-sync-engine.ps1 -Action SyncWorkspace -SiteUrl "https://<tenant>.sharepoint.com/sites/<site>" -TargetFolder "/Shared Documents/workspace-mirror"
```

脚本支持的动作：`SyncWorkspace`、`SyncSingleFile`、`Prewarm`、`PullFile`、`VerifyMirror`、`EnsureFolder`、`ReconcileUrls`。

### 2.2 云端目录清单附件（catalog）

- 生成 `.cph/state/remote-workspace-catalog.md`：两层目录树、文件状态（`CLOUD-READY` / `CLOUD-STALE` / `LOCAL-ONLY` / `CLOUD-UNINDEXABLE`）和当前目标目录下的云端 URL。
- 按**账号 + 内容哈希**缓存（`.cph/state/workspace-catalog-cache.json`），换号时自动重新挂载，不会把 A 账号的附件带给 B 账号。
- 首轮同时保留内联映射表与 catalog 附件：映射表负责就近导航，附件负责完整清单。

### 2.3 文件交付：FilePorter 与自动落盘

- **`file_porter` 工具**（别名 `execute_file`、`porter`）：把 Copilot 生成的下载链接拉到本地。支持 asyncgw / IC3 / Graph 鉴权下载，SSRF 域名白名单，单文件 100MB 上限，ZIP 安全解压（最多 2000 条目、单条 50MB、解压总量 200MB，含 Zip-Slip 防护），并拒绝覆盖关键运行文件（提示词、AGENTS.md、同步脚本、认证/协议源码、状态 JSON 等）。
- **`write_file` 带 `url`**：模型可以直接声明"把某个下载链接写到某个路径"，由 FilePorter 下载并落盘。
- **FINAL_ANSWER 交付契约**：模型在交付总结里按「交付文件与落盘指引」格式声明文件目标，`DeliverablesParser` 解析后交给 `LandingService` 落盘、同步云端，并生成逐项回执。
- **交付报告**：每次落盘都会写 `.cph/state/delivery-report.json`，记录"已落盘 / 已同步 / 失败"及云端 URL。

### 2.4 大工具输出的无损附件交付

- 工具输出超过 **12,000 字符或 200 行**时，完整内容通过 Microsoft Graph 上传到 OneDrive / Substrate 附件通道，聊天正文只保留极简元数据与首尾摘要。
- 这样既避开聊天文本的单轮长度限制，也避免 Windows 控制台多字节编码在 JSON 转义链路上被破坏。
- 附件是该轮工具结果的完整实体；后续推理以附件内容为准，减少因历史文本残留导致的复读。

### 2.5 Copilot 协议适配

- **ChatHub 双工通道**：基于 SignalR，按 `\x1e`（RECORD_SEPARATOR）切帧，支持流式思考与正文增量、心跳与断线重连。
- **专属 Agent 直通**：连接时注入 `gptId` / `agent=Agent` 等参数，消息帧携带 `threadLevelGptId` 与 `gpts` 元数据；默认锁定 `Gpt_61_Sol_Reasoning`。
- **两轮握手**：通用模式下 Turn 1 只做物理工具探测（如 `git status`），Turn 2 再注入真实任务；已确认云端接地（cloud-verified）的会话跳过握手，首轮直接下发任务与工作区映射。
- **历史压实**：只保留最近 2 轮完整思考、动作与工具反馈，更早的大段工具输出被裁剪，防止长会话打爆上下文。
- **容错解析**：`ResilientParser` 从自然语言的思考流里提取 ````action```` 块，兼容 JSON / YAML / 未闭合代码块等常见偏差。
- **编码自愈**：UTF-8 严格模式优先；遇到解码错误自动降级到 GBK，跨 chunk 边界也能还原中文。
- **大输出本地持久化**：超过 3,000 字符或 50 行时，完整日志落到 `.cph/artifacts/tool-output-<timestamp>-<hash>.log`，回填上下文只保留首尾各 20 行。
- **大文件读取保护**：整文件读取超过 1MB 时要求显式 `start_line` / `end_line`，避免一次读爆上下文。
- **RefusalGuard**：识别微软典型拒答模板，触发后重写语义提示词或切换账号。
- **安全中断**：运行中按一次 `Ctrl+C` 中止当前流与子进程并保留会话；空闲时 1.5 秒内连按两次退出。

### 2.6 双智能体、子代理与技能

- 默认三套内置 Agent ID：主协调（Main）、代码实现（Coder）、深度调研（Researcher）。可以用 `--agent`、`--coder-agent-id`、`--researcher-agent-id` 覆盖，也可以在 Web 控制台或 `.cph/config.json` 里保存。
- 子代理通过 `invoke_subagent` 派发，支持 `researcher` / `coder` 角色与串行阶段（`stage`）。
- 技能从工作区 `.skills/`、`skills/` 以及内置包目录加载，工作区同名技能优先；内置 `handoff`（跨会话交接）与 `subagent`（子代理协议）。交互里用 `/skills`、`/skills find <关键字>`、`/skill <name>` 管理。

### 2.7 长任务自主接力

- 单任务默认 30 轮（`--max-turns`）。接近轮次上限时，Orchestrator 会要求模型产出交接文档；模型原生 `handoff` 块会被完整保留，否则自动合成 5 维结构化文档（任务目标、已验证事实、关键卡点、已改文件、下一步）。
- 交接文档持久化到 `.cph/handoffs/handoff-<sessionId>.md`，新会话自动继承；同时可生成 `.cph/snapshots/` 工作区快照。
- CLI 自动接力默认最多 50 次跨会话跃迁（`--max-hops`）；交互里可用 `/continue`（别名 `/relay`）续跑最近会话，`/resume <id>` 恢复指定会话。

### 2.8 账号池与授权

- 账号池默认最多 7 个账号（`maxAccounts`，可用白名单进一步筛选）。
- 刷新令牌用 AES-256-GCM 加密后存为 `enc:v1:<base64>`，避免磁盘明文。
- 遇到 `429` 或限流会把账号转入冷却（默认 3 分钟），自动切到下一个可用账号。
- 支持浏览器 PKCE 授权：`cph-pi auth login [email]`；也兼容手工维护 `accounts.json`。
- 权限探测：`bun run check:accounts --agent <id|url>` 检查各账号对专属 Agent 的访问权限，`bun run check:accounts:apply` 把可用账号写入工作区白名单。

### 2.9 Web 控制台

- 启动：`cph-pi web`（或 `bun run web`）。默认监听 `127.0.0.1:3000` 并自动打开浏览器，可用 `--port`、`--host`、`--no-open` 调整。
- 三栏工作台：左侧会话列表，中间聊天 / 工具卡 / 推理行 / 子代理卡片，右侧面板可切换 Ledger WAL、上下文探针、文件树、终端、Diff、子代理检查器。
- 弹窗管理账号（PKCE 登录、白名单、冷却重置）、智能体、技能、工作区（填写 SharePoint 站点与目标目录后可先校验再打开）。
- 长列表使用视口懒加载，会话与工具输出按需渲染。
- 前提：先构建前端 `npm --prefix web install && bun run web:build`。`package/` 运行包里没有 `web/dist`。

### 2.10 可观测性

- 执行账本：`.cph/state/execution-ledger.jsonl` 与可读版 `.cph/state/execution-ledger.md`，记录每次工具调用的目标、结果与来源。
- 诊断卡：`/status` 查看会话、智能体、模型、轮次、Token 估算、压实比例与账号状态。
- 调试：`--debug` 或 `/debug` 把终端输出实时落盘到 `.cph/logs/`；`CPH_DEBUG=1` 时每轮输出调试指纹。
- 会话与交接：`.cph/sessions/`、`.cph/handoffs/`、`.cph/snapshots/`。

---

## 3. 快速开始

### 3.1 环境要求

- Node.js 20+ 或 Bun 1.2+（Bun 启动与测试更快，推荐）。
- Git。
- 构建 Web 控制台时需要 npm（仓库自带 `web/package.json`）。
- 云端物理镜像需要 Windows PowerShell 5.1 与企业 SharePoint 权限。

### 3.2 克隆与安装

```bash
git clone <你的仓库地址>
cd CPH-PI
bun install          # 或 npm install
```

仓库**没有 Git 子模块**，不需要 `--recurse-submodules`，也不需要额外安装 `pi/`。

### 3.3 构建 Web 控制台（可选）

```bash
npm --prefix web install
bun run web:build
```

### 3.4 配置账号

推荐用浏览器 PKCE 登录：

```bash
cph-pi auth login
# 还没全局安装时：
bun run src/cli.ts auth login
```

也可以手工创建凭据文件，系统读取后会自动加密：

- Windows：`%USERPROFILE%\.config\m365-copilot2api\accounts.json`
- macOS / Linux：`~/.config/m365-copilot2api/accounts.json`
- 模板：`package/accounts.example.json`；字段为 `email` + `refreshToken`，可选 `tenantId`、`userId`。

### 3.5 配置线上 Copilot 智能体

1. 在仓库根目录打包 Agent 物料：

```bash
bun run package
```

产物在 `dist/copilot-agent-bundle/` 与 `package/agent-bundle/`，包含主协调与代码实现两套提示词、技能和 PowerShell 知识库。

2. 在 M365 Copilot / Copilot Studio 中创建两个专属 Agent：
   - **Main 主协调**：Instructions 粘贴 `Instructions-Main-主协调智能体.txt`；知识/技能挂 `skills/subagent` 与 `skills/handoff`。
   - **Coder 代码实现**：Instructions 粘贴 `Instructions-Coder-代码实现智能体.txt`；知识/技能挂 `skills/handoff`。
   - 仅为兼容单智能体模式保留的 `Instructions-系统提示词.txt`（来自 `cph-dev-agent-prompt.txt`）可以不使用。
3. 绑定自己的 Agent（默认内置 ID 可用时可直接省略）：

```bash
cph-pi -a "https://m365.cloud.microsoft/chat/agent/T_..." --coder-agent-id "T_..."
```

4. 探测账号权限并写入白名单：

```bash
bun run check:accounts --agent "https://m365.cloud.microsoft/chat/agent/T_..."
bun run check:accounts:apply
```

### 3.6 绑定云端工作区（可选）

- **Web 控制台**：打开「工作区」向导，填写 SharePoint 站点 URL 与目标目录（默认 `/Shared Documents/workspace-mirror`），先点校验，确认后打开工作区。
- **命令行**：先用 `sp-sync-engine.ps1` 做一次 `Prewarm`（Windows PowerShell 5.1）：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\sp-sync-engine.ps1 -Action Prewarm -SiteUrl "https://<tenant>.sharepoint.com/sites/<site>" -TargetFolder "/Shared Documents/workspace-mirror"
```

绑定后会生成 `.cph/state/sync-manifest.json`；没有该文件时，云端同步相关步骤会自动跳过。

### 3.7 启动

```bash
bun run start                 # 交互式终端
bun run src/cli.ts --task "检查当前仓库并给出 TODO 列表"
bun run web                   # Web 控制台
```

也可以直接用启动器：`cph-pi.bat` / `cph-pi.ps1`（Windows），或 `bun run src/cli.ts`。

---

## 4. 命令行与交互参考

### 4.1 命令行参数

| 参数 | 说明 | 默认值 |
| --- | --- | --- |
| `-h, --help` | 显示帮助并退出 | - |
| `-v, --version` | 显示版本并退出 | - |
| `-c, --continue` | 接续最近活跃会话 | - |
| `-r, --resume <id>` | 恢复指定 ID 的会话 | - |
| `-w, --workspace <path>` | 工作区根目录 | 当前目录 |
| `-a, --agent <id\|url>` | 主协调智能体 | 工作区配置 / 环境变量 / 内置默认 |
| `--coder-agent-id <id\|url>` | 代码实现子智能体 | 工作区配置 / 内置默认 |
| `--researcher-agent-id <id\|url>` | 深度调研子智能体 | 内置默认 |
| `-m, --model <tone>` | 模型风格 | `Gpt_61_Sol_Reasoning` |
| `-acc, --accounts <list>` | 账号白名单（逗号分隔） | 工作区配置 / 全部账号 |
| `-d, --debug [path]` | Debug 模式并落盘日志 | `.cph/logs/` |
| `--log <path>` | 指定日志路径（自动开启 Debug） | - |
| `-t, --timeout <seconds>` | 单轮请求超时 | `600` |
| `--max-turns <n>` | 单任务最大推理轮数 | `30` |
| `--max-hops, --hops <n>` | 自主接力最大跃迁次数 | `50` |
| `--task <prompt>` | 非交互执行单条任务后退出 | 交互模式 |

子命令：

- `cph-pi web [-p 端口] [--host 地址] [--no-open]`：启动 Web 控制台。
- `cph-pi auth login [email]`：浏览器 PKCE 授权或新增账号。

### 4.2 交互命令

| 命令 | 作用 |
| --- | --- |
| `/help` | 帮助与快捷键 |
| `/status` | 会话诊断卡与账号池状态 |
| `/accounts` | 账号池管理（`login` / `enable` / `disable` / `set` / `reset`） |
| `/agent [id\|clear]` | 查看、绑定或解除工作区专属智能体 |
| `/model [tone]` | 查看或切换模型风格 |
| `/debug [on\|off\|path]` | 查看、开启或关闭日志落盘 |
| `/new [title]` | 新建会话（重置握手状态） |
| `/reset` | 归档当前会话并新建 |
| `/sessions` | 列出历史会话 |
| `/resume <id>` | 恢复指定会话 |
| `/continue [任务]` | 续跑当前/最近会话（别名 `/relay`） |
| `/skills`、`/skills find <词>`、`/skill <name>` | 查看、搜索、切换技能 |
| `/exit`、`/quit` | 退出 |

快捷键：`"""` 开启多行输入；行尾 `\` 续行；运行中 `Ctrl+C` 中止；空闲时 1.5 秒内连按两次退出。

### 4.3 工作区配置与环境变量

工作区配置保存在 `<workspace>/.cph/config.json`，主要字段：

- `customAgentId`、`modelTone`、`allowedAccounts`
- `debug`、`debugLogPath`
- `agentMountedSkills`

优先级：CLI 显式参数 > 环境变量（仅 `CPH_COPILOT_AGENT_ID`）> 工作区配置 > 内置默认。

常用环境变量：

| 变量 | 作用 |
| --- | --- |
| `CPH_COPILOT_AGENT_ID` | 默认主协调智能体 ID 或 URL |
| `M365_MASTER_KEY` | 刷新令牌加密主密钥；多设备需要一致 |
| `CPH_DEBUG=1` | 输出每轮调试指纹 |
| `CPH_TURN1_INDEX_MAX_CHARS` | 首轮内联索引上限，默认 `24000` |
| `CPH_PI_ORIGINAL_CWD` | 启动脚本自动注入的原始调用目录 |
| `CPH_GLOBAL_CONFIG_PATH` | Web 端可选全局配置路径 |
| `CPH_MOCK_TRANSPORT=1` | 开发/测试用模拟传输 |

### 4.4 开发脚本

| 命令 | 作用 |
| --- | --- |
| `bun run start` | 从源码启动 CLI |
| `bun run web` / `bun run web:dev` | 启动 Web 控制台 / Vite 开发服务器 |
| `bun run web:build` | 构建前端到 `web/dist` |
| `bun run build` | 打包独立运行包 + 构建前端 |
| `bun run package` | 生成 Agent 上传包（`dist/` 与 `package/agent-bundle/`） |
| `bun run check:accounts` / `check:accounts:apply` | 探测账号权限 / 写入白名单 |
| `bun run test` | 运行测试套件 |

---

## 5. 测试与质量

```bash
bun test tests/
```

当前基线：**124 个测试文件、969 项用例**（约 4,300 个断言），覆盖协议解析、工具桥接、云端同步、文件搬运与落盘、账号池与 PKCE、交接文档、Web RPC 等。

Windows 环境下有两类已记录的环境差异：一个 ACL 隔离用例与一个 5 秒默认超时的慢机抖动；完整结果见 `.docs/reports/` 下的测试报告，慢机可用 `bun test tests/ --timeout 30000` 复跑。

---

## 6. 目录结构

```text
CPH-PI/
├── src/
│   ├── cli.ts                 # CLI 入口
│   ├── cli/                   # 参数解析、交互命令表
│   ├── agent/                 # Orchestrator、子代理、压实、拒答熔断、中断控制
│   ├── protocol/              # 提示词构造、容错解析、工具桥、交付解析
│   ├── transport/             # ChatHub 客户端、Substrate 上传、FilePorter
│   ├── auth/                  # 账号池、Token 管理、加密、PKCE
│   ├── workspace/             # PnP 同步、SharePoint 同步、快照生成
│   ├── delivery/              # 落盘与云端回执
│   ├── session/               # 会话、交接、账本、计划快照
│   ├── skills/                # 技能加载与注册
│   ├── tools/                 # read / write / edit / bash 本地工具
│   ├── ui/                    # TUI、日志、Diff 高亮
│   └── web/                   # HTTP + WebSocket 服务、RPC
├── web/                       # React + Vite Web 控制台（dist 不入库）
├── package/                   # 独立运行包（bin / agent-bundle / 启动器）
├── scripts/                   # 打包、权限探测、云端同步引擎、调试探针
├── skills/                    # handoff / subagent 技能
├── tests/                     # 主测试套件（124 个测试文件）
├── test/                      # 历史遗留测试（不在 npm test 范围）
├── docs/                      # PowerShell Agent 指南（docx / pdf / txt / md）
├── .docs/                     # 计划、规格、审计、报告、变更台账、分支台账
├── cph-main-agent-prompt.txt  # 主协调 Agent 系统提示词
├── cph-coder-agent-prompt.txt # 代码实现 Agent 系统提示词
├── cph-dev-agent-prompt.txt   # 单智能体兼容提示词
├── cph-pi.bat / cph-pi.ps1    # Windows 启动器
├── package.json / tsconfig.json / bunfig.toml / AGENTS.md
└── .cph/                      # 运行时状态（gitignored）
```

`.cph/` 下的常用位置：

- `.cph/state/`：同步 manifest、目录清单、交付报告、执行账本、虚拟仓库映射
- `.cph/handoffs/`：交接文档
- `.cph/sessions/`：会话记录
- `.cph/snapshots/`：工作区快照
- `.cph/artifacts/`：大工具输出
- `.cph/logs/`：调试日志

---

## 7. 相关文档

- 分支与发布：`.docs/BRANCHES.md`
- 变更请求台账：`.docs/CHANGE-REQUEST.md`
- 变更日志：`.docs/CHANGELOG.md`
- 能力登记：`.docs/capability-registry.md`
- 设计规格与实施计划：`.docs/specs/`、`.docs/plans/`
- 对抗审计与测试报告：`.docs/audit/`、`.docs/reports/`
- 开发治理规范：`AGENTS.md`
