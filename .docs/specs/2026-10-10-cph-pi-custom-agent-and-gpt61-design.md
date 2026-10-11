# CPH-PI 专属智能体 (Custom Agent) 纯 WebSocket 直连与 GPT-6.1 Sol 模型锁定设计规范

- **文档状态**：已批准 (Approved)
- **创建日期**：2026-10-10
- **目标定位**：在 `CPH-PI` 极简基座上，基于真实抓包实证，实现微软 M365 专属自建智能体（如 `CPH-Dev`）纯 WebSocket (ChatHub/SignalR) 直连协议、锁定真实 `Gpt_61_Sol_Reasoning` 模型、并提供双轨自适应状态机与持久化配置。

---

## 一、 背景与一手实证发现 (Background & Grounded Findings)

### 1. 真实模型代码曝光 (Fix AUTO Model Degradation)
在对官方 M365 Copilot (高级版) 界面进行 CDP 现场注入与网络抓包实测中，捕获到了核心请求帧：
```json
{
  "tone": "Gpt_61_Sol_Reasoning",
  "clientInfo": { "clientPlatform": "mcmcopilot-web", "ProductCategory": "Chat" }
}
```
* **根本成因**：系统此前默认的 `"Creative"` 或 `"magic"` 无法被微软 M365 网关识别为深度思考模型，导致云端直接降级为普通 `AUTO`（自动）。
* **架构决策**：将客户端所有传输层与状态机中的默认 `modelTone` 全面锁定为官方真实代号 **`Gpt_61_Sol_Reasoning`**。

### 2. 专属 Agent 纯 WebSocket 协议契约曝光 (Custom Agent Protocol)
用户自建并发布的专属编程智能体（`CPH-Dev`）URL 为：
`https://m365.cloud.microsoft/chat/agent/T_9feac605-583d-c37d-cb38-831efe727253.2d893690-5a50-4308-bb95-09fc0ece6464.gpt.1a1be0ff-8bb3-4b10-90f7-8666145e91d3`

现场抓包捕获的底层 WebSocket 通信契约如下：
* **URL 握手 Query 参数**：
  ```text
  gptId=T_9feac605-583d-c37d-cb38-831efe727253.2d893690-5a50-4308-bb95-09fc0ece6464.gpt.1a1be0ff-8bb3-4b10-90f7-8666145e91d3%40MOS3
  &agent=Agent
  &agentHost=Bizchat.FullScreen
  ```
* **SignalR `chat` 目标帧 `arguments[0]` 挂载对象**：
  ```json
  "threadLevelGptId": {
    "id": "T_9feac605-583d-c37d-cb38-831efe727253.2d893690-5a50-4308-bb95-09fc0ece6464.gpt.1a1be0ff-8bb3-4b10-90f7-8666145e91d3",
    "source": "MOS3"
  },
  "gpts": [
    {
      "id": "T_9feac605-583d-c37d-cb38-831efe727253.2d893690-5a50-4308-bb95-09fc0ece6464.gpt.1a1be0ff-8bb3-4b10-90f7-8666145e91d3",
      "source": "MOS3",
      "version": "1.0.0"
    }
  ]
  ```

### 3. 专属 Agent 实测试用表现
向专属 Agent 发起实测时，Agent 展现出极其震撼的具身心智：
* **0 废话**：彻底摆脱“你好，我是办公助手”开场白；
* **0 拒答**：彻底破除“无法访问物理磁盘”的预训练套话；
* **秒级精准 Action**：第一轮直接返回：
  ```text
  tool: run_command
  command: git rev-parse --show-toplevel && git status --short --branch
  ```

---

## 二、 总体架构与双轨状态机设计 (Architecture & Dual-Mode FSM)

系统采用 **“双引擎原生融合架构”**：优先接入用户绑定的专属 Agent；在无专属 Agent 时平滑兜底为纯净两轮握手基准探测。

```
                       用户输入任务
                            │
            ┌───────────────┴───────────────┐
            ▼                               ▼
    [已配置专属 Agent]               [未配置专属 Agent]
  (如 CPH-Dev 具身智能体)              (标准通用模式)
            │                               │
            ▼                               ▼
   【直通模式 (Direct Mode)】         【两轮握手模式 (Handshake Mode)】
   • Turn 1: 零冗余规则注入          • Turn 1: 纯基准物理探测
     直接下发业务任务 + 宿主机事实      (仅发 git status 探测，不含任务)
   • 依赖云端永久指令，节省 80% Token    • 模型真实执行并破除客服心智后
   • 模型依据自身心智自主推进          • Turn 2: 正式注入任务与 Skill
            │                               │
            └───────────────┬───────────────┘
                            ▼
              【统一工具执行与回填闭环】
              • 统一执行 read/write/patch/bash
              • 格式化回填 【TOOL_RESULT】
              • 25 轮自动脱困 (Auto-Handoff) 保护
```

---

## 三、 详细模块规范 (Module Specifications)

### 1. 传输层扩展 (`CPH-PI/src/transport/`)

#### (1) `types.ts`
扩展配置项：
```typescript
export interface ChatHubOptions {
  modelTone?: string;          // 默认: "Gpt_61_Sol_Reasoning"
  customAgentId?: string;      // 专属 Agent ID (如 T_9feac...)
  // 保持现有字段兼容
}
```

#### (2) `chathub-client.ts`
* **Agent ID 归一化工具函数**：
  ```typescript
  public static normalizeAgentId(input?: string): string | undefined {
    if (!input) return undefined;
    const trimmed = input.trim();
    // 支持直接从浏览器 URL 中提取
    const match = trimmed.match(/\/chat\/agent\/([^?&#]+)/);
    if (match) return decodeURIComponent(match[1]);
    return trimmed;
  }
  ```
* **WebSocket URL 组装 (`buildWsUrl`)**：
  若 `this.options.customAgentId` 存在：
  - `params.set("gptId", `${this.options.customAgentId}@MOS3`)`
  - `params.set("agent", "Agent")`
  - `params.set("agentHost", "Bizchat.FullScreen")`
* **发送帧注入 (`sendMessage`)**：
  若 `this.options.customAgentId` 存在：
  - 注入 `threadLevelGptId: { id: this.options.customAgentId, source: "MOS3" }`
  - 注入 `gpts: [{ id: this.options.customAgentId, source: "MOS3", version: "1.0.0" }]`
  - 默认 tone 为 `Gpt_61_Sol_Reasoning`。

---

### 2. 状态机与提示词引擎 (`CPH-PI/src/agent/`)

#### (1) `PromptBuilder` 提示词构建器扩展
* 增加 `buildDirectAgentPrompt(workspaceRoot, task, activeSkillsSection)`：
  针对专属 Agent 模式，仅注入极简的宿主机物理事实（当前绝对路径与 Git 仓库状态）+ 用户正式任务正文 + 已激活的技能正文；**彻底剥离** 几千字重复的工具语法定义，充分信任服务端云端指令。
* 保持现有 `buildHandshakePrompt` 与 `buildTurn2TaskPrompt` 供通用模式使用。

#### (2) `CopilotOrchestrator` 双轨调度
* 维护 `customAgentId?: string` 属性；
* 若 `customAgentId` 存在：
  - 将 `isHandshakePending` 置为 `false`，进入直通模式；
  - 首轮直接调用 `buildDirectAgentPrompt` 下发任务；
* 若 `customAgentId` 为空：
  - 进入通用两轮握手模式，Turn 1 纯探测，Turn 2 注入任务。

---

### 3. CLI 交互与配置持久化 (`CPH-PI/src/cli.ts`)

#### (1) 命令行参数
* `--agent <id|url>` / `-a <id|url>`：指定本次运行绑定的专属 Agent；
* `--model <tone>` / `-m <tone>`：指定模型 Tone（默认 `Gpt_61_Sol_Reasoning`）。

#### (2) 交互式斜杠指令
* `/agent`：查看当前绑定的专属 Agent 状态；
* `/agent <id|url>`：动态绑定新 Agent 并持久化；
* `/agent clear`：解除绑定，切换回通用握手模式；
* `/model [tone]`：查看或切换模型 Tone。

#### (3) 配置持久化 (`<workspace>/.cph/config.json`)
```json
{
  "customAgentId": "T_9feac605-583d-c37d-cb38-831efe727253.2d893690-5a50-4308-bb95-09fc0ece6464.gpt.1a1be0ff-8bb3-4b10-90f7-8666145e91d3",
  "modelTone": "Gpt_61_Sol_Reasoning"
}
```
* 优先级：命令行参数 > 环境变量 `CPH_COPILOT_AGENT_ID` > `.cph/config.json` > 默认通用模式。

#### (4) TUI 状态栏透视
在 `SessionStatusInfo` 与 `renderStatusBar` 中增加 `agentName?: string`：
```text
┌─ [ 智能体: CPH-Dev | 会话: ses_20261010_1650 | 轮次: 1/25 | 上下文: ~1200 tokens | 模型: GPT-6.1 Sol ]
```

---

## 四、 测试与质量门禁 (Testing & Verification)

1. **协议层单元测试 (`tests/transport/chathub-client.test.ts`)**：
   - 验证 Agent ID URL 提取正则；
   - 验证 `buildWsUrl` 正确附加 `gptId=...%40MOS3`；
   - 验证 SignalR 发送帧正确挂载 `threadLevelGptId` 与 `gpts`；
   - 验证默认 tone 为 `Gpt_61_Sol_Reasoning`。
2. **状态机双轨测试 (`tests/agent/dual-mode-orchestrator.test.ts`)**：
   - 验证提供 Agent 时，Turn 1 直接包含用户任务正文且不触发强制基准握手；
   - 验证未提供 Agent 时，严格执行 Turn 1 纯探测与 Turn 2 任务注入。
3. **CLI 交互与配置持久化测试 (`tests/cli/custom-agent-cli.test.ts`)**：
   - 验证 `--agent` 参数解析、`/agent` 命令切换、`.cph/config.json` 自动生成与读取；
   - 验证状态栏透视。
4. **全量回归保障**：
   - 保证历史全部 237 项测试 100% 保持通过。

