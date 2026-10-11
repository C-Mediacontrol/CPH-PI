# CPH-PI: 基于 Pi 极简基座的 Copilot 自主编程 Agent 架构设计规范

> **文档状态**：已批准 (Approved)  
> **创建日期**：2026-10-10  
> **目标目录**：`CPH-PI/`  
> **核心定位**：将 `@earendil-works/pi` 极简工业级 TUI 与 4 大原生工具链（read/write/edit/bash），与 Microsoft Copilot M365 原生协议控制核（握手、滑动压实、7 账号透明轮转、RefusalGuard）深度融合。

---

## 一、 问题背景与架构动机

在 `CPH-OPENCODE` 的实践探索中，直接将 Microsoft Copilot 作为 Provider 接入通用重型 Agent 框架（OpenCode）暴露出根本性架构阻抗失配：
1. **控制反转错配**：OpenCode 假定底层为高服从度、支持原生 JSON Tool Calling 的商业 API（如 Claude 3.5 Sonnet），下发大一统复杂 System Prompt，严重触发微软 Web WAF 敏感词与拒答（Refusal）。
2. **文本流与动作冲突**：Copilot 的自然语言输出即其思维链（Thought Process），在纯文本中嵌入 ````action````。通用框架由于缺乏容错状态机，导致用户端字符重复回显与工具调度异常。
3. **框架包袱过重**：DeepSeek Harness (`dsh`) 核心强绑定 Cordis 插件体系，OpenCode 强绑定多 Agent 与 Vercel AI SDK。而本项目最核心诉求是 **极致 TUI（A）+ 成熟工业级工具链（B）**。

因此，本项目选取以 **极简防臃肿（Anti-bloat）、源码精悍** 著称的 **Pi (`earendil-works/pi`)** 为外壳基座，并由自主可控的 Copilot 调度中枢反向接管 Agent Loop。

---

## 二、 总体架构与工程拓扑

### 1. 目录结构规范

```text
CPH-PI/
├── pi/                         # Pi 核心子系统 (精简集成的 upstream 模块)
│   ├── tui/                    # 终端差异化渲染器、快捷键、交互确认框、Diff 高亮视窗
│   └── tools/                  # 4 大原生工业级工具实现 (read, write, edit, bash)
├── src/
│   ├── transport/              # M365 原生 ChatHub WebSocket 传输与 Substrate 附件通道
│   │   ├── chathub-client.ts   # WebSocket 双工长连接、心跳与流式解析
│   │   ├── substrate-uploader.ts # 复杂提示词通过文档附件旁路注入
│   │   └── types.ts            # 通信契约与事件模型
│   ├── auth/                   # 7 账号透明加密调度池
│   │   ├── account-pool.ts     # 多账号轮转调度、429 频控感知与自动冷却
│   │   ├── crypto.ts           # DPAPI / AES 本地凭证加解密
│   │   └── token-manager.ts    # M365 AccessToken/Cookie 自动续期
│   ├── protocol/               # 协议契约与双向解析
│   │   ├── prompt-builder.ts   # Turn 1 Grounding 握手、两轮历史压实提示词构建
│   │   ├── resilient-parser.ts # 正则容错提取器 (兼容 action, ACTION, tool_call>)
│   │   └── tool-bridge.ts      # Copilot 动作与 Pi 原生工具双向映射器 (核心)
│   ├── agent/                  # Copilot 专有 Agent Loop
│   │   ├── orchestrator.ts     # Ephemeral Worker 状态机、两段式生命周期
│   │   ├── compaction.ts       # 两轮滑动观察剥离机制 (保留 <=2 轮，裁剪 >2 轮)
│   │   ├── refusal-guard.ts    # 拒答拦截熔断与自纠重试
│   │   └── interrupt.ts        # 两段式 Ctrl+C 安全中断控制器
│   └── cli.ts                  # 组装入口：将 Orchestrator 挂载至 Pi TUI
├── tests/
│   ├── protocol/               # 契约解析与工具桥接单测
│   ├── agent/                  # 压实算法与拒答熔断单测
│   └── e2e/                    # 基于 Mock ChatHub 的端到端自主闭环测试
├── .docs/                      # 设计规范与实施计划
├── package.json
└── tsconfig.json
```

---

## 三、 工具双向映射规范 (Tool Bridge Specification)

针对用户明确指示的工具映射要求，建立双向映射契约：

### 1. Copilot 输出动作 -> Pi 工具执行映射表

```
┌─────────────────────────────────┐           ┌────────────────────────────────┐
│   Copilot 输出动作 (Markdown)    │           │      Pi 工业级工具 (TypeScript) │
│  ```action                      │           │                                │
│  tool: read_file                │ ──桥接──> │ pi.tools.read({                │
│  path: src/main.ts              │           │   filePath: "src/main.ts",     │
│  start_line: 1, end_line: 50    │           │   offset: 1, limit: 50         │
│  ```                            │           │ })                             │
└─────────────────────────────────┘           └────────────────────────────────┘
```

| Copilot Action 名称 / 别名 | 映射的 Pi 工具 | 输入参数映射规则 | 防护与约束策略 |
| :--- | :--- | :--- | :--- |
| `read_file`<br>`read`<br>`cat` | `pi.tools.read` | • `filePath`: `path`<br>• `offset`: `start_line` (缺省为 1)<br>• `limit`: `end_line ? (end_line - start_line + 1) : 100` | **切片强制限制**：单次最多读取 100 行，防止长源码直接撑爆 Copilot 单轮 2k Token 上限。 |
| `patch_file`<br>`edit`<br>`edit_file` | `pi.tools.edit` | • `filePath`: `path`<br>• `oldString`: `old_string`<br>• `newString`: `new_string`<br>• `replaceAll`: `replace_all ?? false` | **局部补丁替换**：拒绝全量重写；`oldString` 必须在目标文件中唯一，否则抛出明确冲突定位，并在 Pi TUI 渲染差异 Diff。 |
| `write_file`<br>`write` | `pi.tools.write` | • `filePath`: `path`<br>• `content`: `content` | **全新文件守卫**：若文件已存在且未声明覆盖，抛出警告要求改用 `edit`，防止代码损坏。 |
| `run_command`<br>`bash`<br>`exec` | `pi.tools.bash` | • `command`: `command`<br>• `timeout`: 30000 (30秒) | **截断保护**：超过 1000 行或 30KB 输出落盘至 `.cph/truncation/`，仅向上下文返回头尾各 20 行摘要。 |
| `ask_question`<br>`question` | `pi.tui.confirm` 或 `select` | • `prompt`: `question`<br>• `options`: `options` | 唤起 Pi TUI 交互式弹窗，阻塞等待用户选择或输入后回传结果。 |

### 2. Pi 工具结果 -> Copilot 上下文格式化规范

```markdown
【TOOL_RESULT: read_file (src/main.ts)】
[Lines 1-50 of src/main.ts]:
1: import express from "express";
2: ...
[End of tool result]
```

---

## 四、 控制核与状态机接管 (Inversion of Control)

### 1. 短生命周期会话状态机 (Ephemeral Worker)

```
[用户触发指令] ──> [Turn 1: 物理事实接地 (Git + 核心目录树)]
                         │
                         ▼
        ┌──────> [Copilot 流式响应 (Pi TUI 渲染)]
        │                │
        │        ┌───────┴────────────────────────┐
        │        ▼                                ▼
        │   [正则提取到 Action]            [检测到 FINAL_ANSWER]
        │        │                                │
        │   [ToolBridge 派发执行]          [总结交付，归档会话]
        │        │
        │   [生成精炼 TOOL_RESULT]
        │        │
        │   [Compaction: 历史 >2 轮裁剪]
        │        │
        └────────┴── (轮次 ≥ 25 触发进展快照，无缝交接至新会话)
```

### 2. 工业级可靠性保障机制
1. **两轮滑动观察剥离 (Two-Turn Sliding Compaction)**：
   - 最新 $\le 2$ 轮：保留完整的输入、Thought、Action 与工具输出；
   - 历史 $> 2$ 轮：彻底丢弃工具返回的大段日志与代码原文，仅保留该轮的一句话目标与交付结论，释放 80%~95% 上下文。
2. **RefusalGuard 拒答熔断自愈**：
   - 捕获流中出现的典型微软拒答模版；
   - 一旦触发，终止当前输出，重写提示词语义或调度账号池切换新账号，保障流水线不中断。
3. **两段式 Ctrl+C 安全中断 (Interrupt Controller)**：
   - 任务运行中按单次 Ctrl+C：取消流或杀掉当前命令子进程，会话依然存活，回到输入光标；
   - 空闲时连续按两次 Ctrl+C：安全退出终端。

---

## 五、 测试与验证计划

1. **单元测试 (Unit Tests)**：
   - `tool-bridge.test.ts`：验证所有别名 Action 参数解析与类型校验；
   - `resilient-parser.test.ts`：验证非标 Markdown、代码块缺失等边界条件解析；
   - `compaction.test.ts`：验证长轮次上下文修剪比率与字段留存正确性。
2. **集成与 Mock 测试 (Mock E2E Tests)**：
   - 模拟 ChatHub WebSocket 流，验证 Agent Loop 完整的“读文件 -> 发现问题 -> 局部补丁 -> 运行测试 -> 产出汇报”闭环。
3. **真实联调测试 (Live Smoke Test)**：
   - 在真实 M365 环境下启动 `CPH-PI` 终端，验证 Pi TUI 渲染质量与工具调度响应。

