# CPH-PI 云端会话轮数上限与上下文注入实证探测设计规范

## 1. 背景与核心科学假说

在对 Microsoft Copilot M365 及专属自建智能体（`CPH-Dev`，模型代号 `Gpt_61_Sol_Reasoning`）的实际长会话实测（如 30 轮全量代码审查）中，我们确立了一项最高研发原则：
> **Copilot 原生优先原则**：严禁在本地 Harness 重复手搓 Copilot 云端已具备的能力。优先利用专属 Agent 系统指令、上传技能包与官方原生机制，本地仅做纯粹的物理工具桥接与双工传输。

为了重构上下文管理并彻底消除本地无谓的伪压实逻辑，必须首先通过实证数据探明 Copilot 云端底层的真实限制机理：
1. **假说 1（轮数硬顶假说）**：云端 Sydney 是否存在死卡在 30 轮的会话计数器？如果是，触发拒绝时云端下发了什么样的 SignalR 终结帧（如 `Disengaged`, `OffTopic`, `result.value: "Throttled"`）？如果不是，是否可以突破 30 轮？
2. **假说 2（Token 累积溢出假说）**：在累积注入数万字符的大上下文长对话中，云端是否会因窗口溢出而在 30 轮之前提前拒答？
3. **假说 3（文件旁路与云端附件假说）**：对比本地文件路径引用（AI 按需读取本地文件）与云端附件注入（`messageAnnotations` 挂载），评估两者的协议兼容性与上下文保持能力。

---

## 2. 探针套件架构设计

### 2.1 架构拓扑
```text
┌────────────────────────────────────────────────────────┐
│        scripts/probe-limits.ts (自动化探测入口)         │
│  - 参数解析 (--mode, --max-turns, --agent)             │
│  - ANSI 实时流式监控与耗时统计                         │
└───────────────────────────┬────────────────────────────┘
                            │
               ┌────────────┴────────────┐
               ▼                         ▼
┌─────────────────────────────┐ ┌─────────────────────────────┐
│ AccountPool (src/auth/)     │ │ ChatHubClient (src/transport)│
│ - 提取活动 M365 凭证        │ │ - 建立 Sydney WebSocket 直连│
│ - GSC.VFU2@cma-cgm.com      │ │ - 挂载 CPH-Dev 专属智能体   │
└─────────────────────────────┘ └──────────────┬──────────────┘
                                               │
                                               ▼
                              ┌────────────────────────────────┐
                              │ Microsoft Sydney (M365 云端)   │
                              │ - Gpt_61_Sol_Reasoning 推理核 │
                              └────────────────────────────────┘
```

### 2.2 四大探测载荷规范

1. **`--mode short`（轨道 1：极简纯轮数基准）**：
   - 目标：彻底排除 Token 干扰，测试纯轮数硬顶极限。
   - 载荷：`Turn 1: "我们正在进行基础连通性基准测试。请仅回答数字：1。"`，`Turn N: "收到。请仅回答下一个数字：${N}。"`。
   - 单轮开销：~20 Tokens。
2. **`--mode long-text`（轨道 2A：直接灌入长文本）**：
   - 目标：测试文本堆叠下的累积上下文窗口溢出点。
   - 载荷：每轮在 `message.text` 中灌入采自真实项目的 3,500 字符代码/报错日志，要求模型提取 1 个核心问题。
   - 单轮开销：~1,200 Tokens（累积达 30k+）。
3. **`--mode local-file`（轨道 2B：本地文件路径引用）**：
   - 目标：验证“本地文件旁路持久化”在保持极低上下文消耗的同时，能否支持长会话。
   - 载荷：将 10KB 真实代码写入 `.cph/probe-files/turn-${N}.log`，消息内仅发送相对路径与 3 行头尾摘要。
   - 单轮开销：~80 Tokens。
4. **`--mode cloud-attachment`（轨道 2C：云端附件注入探测）**：
   - 目标：验证 M365 WebSocket 在 `messageAnnotations` 挂载附件的协议接受度与报错特征。
   - 载荷：在 SignalR 帧中挂载 `AttachmentAnnotation` 元数据（模拟直接挂载 `handoff.md` 文件）。

---

## 3. 遥测与数据捕获规范

### 3.1 终止特征判定
探针在以下任一条件发生时安全终止并触发抓包：
1. **云端显式拒答/终结**：收到 `messageType === "Disengaged"`，或 `result.value !== "Success"`（如 `Throttled`, `MessageTooLong`, `OffTopic`）；
2. **限制文本特征**：模型文本中包含“已达到此对话的限制”或“reached the conversation limit”；
3. **顺利达标**：顺利执行满目标轮数（默认 45 轮）；
4. **用户中断**：按 Ctrl+C 安全暂停并输出阶段性数据。

### 3.2 遥测数据结构
```typescript
export interface ProbeTurnRecord {
  turn: number;
  timestamp: string;
  promptChars: number;
  responseChars: number;
  reasoningChars: number;
  latencyMs: number;
  terminal: boolean;
  terminalCode?: string;
  terminalSnippet?: string;
  rawTerminalFrame?: any;
}

export interface ProbeReport {
  mode: "short" | "long-text" | "local-file" | "cloud-attachment";
  agentId: string;
  modelTone: string;
  conversationId: string;
  maxTurnsAttempted: number;
  actualCompletedTurns: number;
  stoppedAtTurn: number;
  isHardCapped: boolean;
  terminalSignal?: string;
  turns: ProbeTurnRecord[];
}
```

### 3.3 产物落盘位置
- JSON 原始数据：`CPH-PI/.cph/probe-reports/probe-<mode>-<timestamp>.json`
- Markdown 诊断简报：`CPH-PI/.cph/probe-reports/probe-<mode>-<timestamp>.md`

---

## 4. 自动化测试与工程门禁
1. **测试文件**：`CPH-PI/tests/scripts/probe-limits.test.ts`
2. **测试场景**：
   - 模拟正常连续多轮应答与指标计算；
   - 模拟第 30 轮收到 `Disengaged` 报文的精准拦截与终结帧捕获；
   - 模拟 429 `Throttled` 拦截与安全落盘；
   - 验证 4 大载荷生成器的格式合规性；
3. **回归指标**：现有 299 项测试保持 100% 绿灯无退化。

