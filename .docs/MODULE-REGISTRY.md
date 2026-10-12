# CPH-PI 核心模块注册表 (MODULE-REGISTRY.md)

本文件是 CPH-PI 架构模块、核心服务与公共接口的单一事实源（Single Source of Truth）。
在提出任何代码变更前，必须首先查阅本表，避免重复造轮子与浅层模块膨胀。

---

## 核心架构分层与模块清单

### 1. CLI 命令行与交互宿主 (`src/cli/`)
| 模块名称 | 路径 | 核心职责与导出接口 | 依赖方向 |
|---|---|---|---|
| **CphPiCli** | `src/cli.ts` | 交互式终端 REPL 主循环、多代接力调度与 TUI 驱动 | ➔ `args.ts`, `command-dispatcher.ts`, `orchestrator.ts` |
| **CliArgs** *(新增)* | `src/cli/args.ts` | 声明式命令行参数解析器 (`parseCliArgs`)、帮助文档生成器 (`getHelpText`, `printHelp`)、Token 估算纯函数 (`estimateTokens`) | 无外部依赖 |
| **CommandDispatcher** *(新增)* | `src/cli/command-dispatcher.ts` | 15 组交互式 Slash 命令统一注册表与分发器 (`dispatch`) | ➔ 各领域管理服务 |

### 2. 编排调度引擎 (`src/agent/`)
| 模块名称 | 路径 | 核心职责与导出接口 | 依赖方向 |
|---|---|---|---|
| **CopilotOrchestrator** | `src/agent/orchestrator.ts` | 单任务推理编排状态机、两轮握手基准探测、工具调用循环 | ➔ `handoff-generator.ts`, `disaster-arbitrator.ts`, `tool-bridge.ts` |
| **HandoffGenerator** *(新增)* | `src/agent/handoff-generator.ts` | 5 维高保真自主交接快照生成服务 (`HandoffDocumentGenerator.generate`) | ➔ `fs`, `path` |
| **DisasterArbitrator** *(新增)* | `src/agent/disaster-arbitrator.ts` | Session A -> B -> C 三段式容灾仲裁与故障转移服务 (`DisasterArbitrator.execute`) | ➔ `chathub-client.ts`, `prompt-builder.ts` |
| **SubagentRunner** | `src/agent/subagent-runner.ts` | 并发子代理工作流与滑动窗口并发执行器 (`executeBatch`, `runSingleSubagent`) | ➔ `tool-bridge.ts`, `account-pool.ts`, 动态加载 `orchestrator.ts` |
| **BlackboxCompactor** | `src/agent/blackbox-compactor.ts` | 容灾黑匣子紧凑上下文提炼与摘要生成器；声明并导出 `TurnRecord` 接口 | 无反向依赖 |
| **RefusalGuard** | `src/agent/refusal-guard.ts` | 纯正向沙箱拒答拦截哨兵 (`detectRefusal`, `getRetryStrategy`) | 无反向依赖 |
| **InterruptController** | `src/agent/interrupt-controller.ts` | 终端双段式 Ctrl+C 信号拦截与安全中断控制器 | 无反向依赖 |

### 3. 协议与工具桥接 (`src/protocol/`)
| 模块名称 | 路径 | 核心职责与导出接口 | 依赖方向 |
|---|---|---|---|
| **ResilientParser** | `src/protocol/resilient-parser.ts` | 鲁棒协议解析器，支持深度嵌套代码围栏、局部 Patch 与完成标记解析 (`parse`) | ➔ `tool-bridge.ts` |
| **PromptBuilder** | `src/protocol/prompt-builder.ts` | 结构化提示词协议构建器，全面遵循正向行动引导规范 (`buildTurn1Prompt`, `buildTurn2TaskPrompt`, `PROTOCOL_REMINDER`) | 无反向依赖 |
| **ToolBridge** | `src/protocol/tool-bridge.ts` | 物理动作桥接器，将大模型 action 映射为 Pi 原生工具并统一错误处理 (`createErrorResult`, `executeAction`) | ➔ Pi native tools |

### 4. 传输网络层 (`src/transport/`)
| 模块名称 | 路径 | 核心职责与导出接口 | 依赖方向 |
|---|---|---|---|
| **ChatHubClient** | `src/transport/chathub-client.ts` | 微软 Sydney SignalR WebSocket 全双工流式客户端 (`sendMessage`) | ➔ `url-utils.ts` |
| **SubstrateUploader** | `src/transport/substrate-uploader.ts` | Substrate 附件与 OneDrive 文档上传器 | 无反向依赖 |

### 5. 鉴权与账号池 (`src/auth/`)
| 模块名称 | 路径 | 核心职责与导出接口 | 依赖方向 |
|---|---|---|---|
| **AccountPool** | `src/auth/account-pool.ts` | 多账号轮询与 429 熔断降级池，原子推进轮询指针 (`getNextAvailableToken`) | ➔ `token-manager.ts`, `url-utils.ts` (零 Transport 依赖) |
| **TokenManager** | `src/auth/token-manager.ts` | Azure AD 凭据加密与 Single-Flight 并发去重刷新管理器 (`getAccessToken`) | ➔ `crypto.ts` |
| **Crypto** | `src/auth/crypto.ts` | AES-256-GCM 令牌加解密与 DPAPI 降级模块 | 无反向依赖 |

### 6. 会话与血缘状态 (`src/session/`)
| 模块名称 | 路径 | 核心职责与导出接口 | 依赖方向 |
|---|---|---|---|
| **SessionManager** | `src/session/session-manager.ts` | 会话快照 CRUD、索引维护与血缘联动磁盘持久化 (`saveSession`, `loadSession`) | ➔ `fs`, `path` |
| **SessionLineageTracker** | `src/session/lineage-tracker.ts` | 单向继承血缘树追踪器，支持序列化与反序列化 (`serialize`, `deserialize`, `resolveActiveHead`) | 无外部依赖 |
| **MainPlanSnapshot** | `src/session/main-plan-snapshot.ts` | 主计划快照生成与恢复引擎 | ➔ `fs`, `path` |

### 7. 工具与辅助库 (`src/utils/`)
| 模块名称 | 路径 | 核心职责与导出接口 | 依赖方向 |
|---|---|---|---|
| **UrlUtils** *(新增)* | `src/utils/url-utils.ts` | URL 正则解析与 Agent ID 规范化纯函数 (`normalizeAgentId`) | 无外部依赖 |

---
