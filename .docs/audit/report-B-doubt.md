# 对抗复核报告：契约对抗与假设证伪 (Dim-2: doubt-driven-development)

- **复核基准**: `E:\copilot-web proxy\CPH-PI\.docs\audit\report-A-doubt.md`
- **参考设计资产**: 
  - `E:\copilot-web proxy\CPH-PI\.docs\specs\2026-10-10-cph-pi-design.md`
  - `E:\copilot-web proxy\CPH-PI\.docs\specs\2026-10-11-cph-pi-smart-handoff-and-interactive-runtime-design.md`
  - `E:\copilot-web proxy\CPH-PI\.docs\specs\2026-10-12-main-session-virtualization-and-account-concurrency-design.md`
  - `E:\copilot-web proxy\CPH-PI\.docs\specs\2026-10-12-subagent-execution-architecture-design.md`
  - `E:\copilot-web proxy\CPH-PI\.docs\specs\2026-10-12-tri-agent-handoff-and-lineage-architecture-design.md`
  - `E:\copilot-web proxy\CPH-PI\.docs\plans\2026-10-10-cph-pi-encoding-healing-and-autonomous-handoff-implementation.md`
  - `E:\copilot-web proxy\CPH-PI\.docs\plans\2026-10-11-cph-pi-smart-handoff-and-interactive-runtime.md`
- **参考项目宪章**:
  - `E:\copilot-web proxy\AGENTS.md` (根目录治理规范：Harness 纯粹与中立性、黑盒抽象)
  - `E:\copilot-web proxy\CPH-PI\AGENTS.md` (准则 1: 纯粹中立严禁擦屁股; 准则 2: 认知塑形与提示词优先; 准则 3: 摒弃负面词; 准则 6: 行动导向与黑盒契约)
- **Git 核查范围**: Commit `b8ad75a` (feat: initial commit of CPH-PI autonomous coding agent harness) 及全量历史日志 / git blame 对账
- **统计**: 确凿 [8] | 既定设计 [1] | 违反宪章 [1] | 设计脱节 [3] | 误报 [1]

---

## 紧凑对账索引表 (Reconciliation Table)

| 编号 | 缺陷简述 | 文件与行号 | A置信度 | B裁决 | 核心依据摘要 |
|---|---|---|---|---|---|
| 1 | `ResilientParser` 嵌套代码块导致 `write_file` 截断 | `src/protocol/resilient-parser.ts#L40-L76` | Level 1 | `[CONFIRMED]` | 正则 `/```(?:action\|json)?\s*([\s\S]*?)```/i` 遇到第一个三反引号即提前闭合，实测完全丢弃嵌套代码与后续文档。 |
| 2 | `ResilientParser` `edit` 中 `old_string` 前瞻误截断 | `src/protocol/resilient-parser.ts#L201-L206` | Level 1 | `[CONFIRMED]` | 前瞻断言 `(?=\n(?:...\|tool\|path)\s*:)` 遭遇代码内的 `\npath:` 立即切断，实测配置修改 `old_string` 必失配。 |
| 3 | `ChatHubClient` 异常断网通过 `settleResolve` 伪装成功 | `src/transport/chathub-client.ts#L460-L481` | Level 1 | `[CONFIRMED]` | `ws.onclose` 在 `hasSentChat` 为真时无论错误码（1006/1008）均 `settleResolve({ text: "" })`，导致编排层将网络崩溃误判为 `invalid_chatter`。 |
| 4 | `Orchestrator` 附件阈值 0 导致真实工具输出被抹除 | `src/agent/orchestrator.ts#L195`, `L723-L731` | Level 1 | `[DRIFT-DESYNC]` | 原设计规范明确定为 120,000 字符 / 3,000 行防失明，现代码硬编码为 0 导致全量上传；且单轮清空 `currentAnnotations` 诱发后继轮次致盲。 |
| 5 | `AccountPool` 异步查询中 `currentIndex` 竞态碰撞 | `src/auth/account-pool.ts#L320-L353` | Level 1 | `[CONFIRMED]` | 轮询指针在 `await getAccessToken` 之后才递增，并发子代理在异步 I/O 期间读取相同 `idx`，多活并发实质退化为同账号碰撞。 |
| 6 | `TokenManager` 凭据刷新缺乏 Promise 去重 | `src/auth/token-manager.ts#L193-L270` | Level 1 | `[CONFIRMED]` | 并发调用同时使用旧 RT 请求 Azure AD，触发 Refresh Token Rotation 机制导致第二路收到 `invalid_grant`，账号凭据直接被废。 |
| 7 | `Orchestrator` Handoff 路径拼接未清洗 `sessionId` | `src/agent/orchestrator.ts#L593`, `L908`, `L1244` | Level 1 | `[CONFIRMED]` | `SessionManager` 有白名单正则，但 `Orchestrator` 直接 `path.join` 外部传入的 `sessionId`，存在目录穿越写文件风险。 |
| 8 | `ResilientParser` 技术解释触发 `ALL_TASKS_COMPLETED` 假死 | `src/protocol/resilient-parser.ts#L80-L113` | Level 1 | `[CONFIRMED]` | 模糊子串匹配 `trimmed.includes("ALL_TASKS_COMPLETED")` 导致技术排查陈述被暴力解析为 `final_answer`，任务异常提前终结。 |
| 9 | `RefusalGuard` 强正则误伤技术分析产生死循环并误封账号 | `src/agent/refusal-guard.ts#L14-L62`, `orchestrator.ts#L514` | Level 1 | `[VIOLATES-GOVERNANCE-RULE]` | 违背 AGENTS.md 准则 1（严禁替模型擦屁股）与准则 3（摒弃负面词）；误伤正常诊断并错误调用 `pool.markThrottled` 抹杀健康账号。 |
| 10 | `SubagentRunner` 与主控代际执行序倒置导致重定向失效 | `src/agent/orchestrator.ts#L655`, `subagent-runner.ts#L139` | Level 2 | `[DRIFT-DESYNC]` | `orchestrator` 严格 await 子代理批处理后才推进代际，执行期间 `resolveActiveHead` 永远返回自身，重定向分支在正常流程中为死逻辑。 |
| 11 | `InterruptController` 繁忙清理期双击退出竞态 | `src/agent/interrupt-controller.ts#L115-L155` | Level 2 | `[INTENDED-DESIGN]` | 设计规范与单元测试（Line 51）明确规定：“繁忙时连按仅中止当前操作不退出进程，空闲时双击退出”，系防误杀既定设计。 |
| 12 | 代际轮换重置 `turn = 0` 破坏 `history` 时序单调性 | `src/agent/orchestrator.ts#L710`, `blackbox-compactor.ts#L442` | Level 1 | `[CONFIRMED]` | 重置 `turn = 0` 后直接向累计 `history` 追加，导致轮次变为 `[1..5, 1..2]`，`BlackboxCompactor` 产生 `Turns 4 ~ 2` 倒置摘要。 |
| 13 | `SessionManager` 并发落盘非原子写破坏 `index.json` | `src/session/session-manager.ts#L128-L158` | Level 1 | `[FALSE-POSITIVE]` | `saveSession` 全程同步无异步交错点，单进程无法竞态；PoC 实测完全通过；且已有 `rebuildIndex()` 磁盘扫描自愈机制兜底。 |
| 14 | `ToolBridge` 与 `PromptBuilder` 双轨协议格式不一致 | `src/protocol/tool-bridge.ts#L802`, `prompt-builder.ts#L188` | Level 2 | `[DRIFT-DESYNC]` | `ToolBridge.formatResult` 为历史遗留孤儿方法，实际运行全由 `PromptBuilder` 掌管；双轨格式不一属于演进脱节与冗余代码。 |

---

## 逐项事实对账详情

### 针对初审第 1 项：`ResilientParser` 嵌套代码块导致 `write_file` / `edit` 内容静默截断
- **初审判定与 PoC**: A 报告认为 `ResilientParser.parse` 采用 `/```(?:action|json)?\s*([\s\S]*?)```/i` 提取 Action 块，非贪婪量词导致遇到内容内部的首个 ```` 即提前闭合，后续代码全部丢失（置信度 Level 1）。
- **原作者辩护推演 (Steelmanning)**: 
  原作者使用非贪婪匹配 `[\s\S]*?` 的核心动机是防止正则表达式在模型输出长文本时发生“贪婪跨块穿透”。当模型输出形如 `THOUGHT -> ```action ... ``` -> 解释说明 -> ```action ... ``` 或 代码示例` 时，贪婪匹配会将后续所有人类解释与多个代码块全部吞入单个 Action 块，造成严重的语法灾难。原作者假设模型在 Action 块中只会输出扁平的键值对或 JSON，未预料到会在 `content:` 字段中直接书写含 Markdown 代码围栏的文件内容。
- **项目宪章 (AGENTS.md) 校验**: 
  `AGENTS.md` 准则 1 指出：“调度纯粹性：Harness 本身应当保持中立与协议纯粹... 只有在确认 Harness 本身存在物理实现缺陷或工程 Bug 时，方可修改 Harness 源码。” 此处 `ResilientParser` 无法正确解析合法生成的文件内容，属于典型的物理实现缺陷，整改符合治理宪章。
- **复核裁决**: `[CONFIRMED]` (确凿缺陷)
- **源码与上下文核验**: 
  核验 `src/protocol/resilient-parser.ts#L40`：
  ```typescript
  const fencedMatch = trimmed.match(/```(?:action|json)?\s*([\s\S]*?)```/i);
  ```
  在 Bun 运行时执行反例验证：
  输入含 ````typescript\nconsole.log(123);\n```` 的 Markdown 文档生成请求，实测解析得到的 `parsed.action.content` 仅保留到 ````typescript` 之前的内容，`console.log(123)` 及后续所有字符被确定性截断丢弃。
- **设计文档与 Git 证据链**: 
  Commit `b8ad75a` 初始化该正则逻辑，未考虑多级代码围栏或平衡状态机。
- **最终保留建议**: 
  必须修复。采用基于四反引号（````action ... ````）优先匹配，或引入平衡围栏计数器（Fence Counter）状态机替代简易非贪婪正则。

---

### 针对初审第 2 项：`ResilientParser` 局部编辑中 `old_string` 正则前瞻过宽，遭遇 `\npath:` 发生伪终结
- **初审判定与 PoC**: A 报告指出 `old_string` 正则采用前瞻断言 `(?=\n(?:new_string|...|tool|path)\s*:|$)`，当待替换代码中出现以换行起头的 `path:` 时（如 YAML、Nginx、TS 字段），`old_string` 被截断，导致 Patch 失败（置信度 Level 1）。
- **原作者辩护推演 (Steelmanning)**: 
  原作者在处理模型输出时面对的是极其非确定性的 LLM 行为：不同模型可能会颠倒字段输出顺序（例如先输出 `tool: edit`，接着输出 `old_string:`，然后才输出 `path:`，最后输出 `new_string:`）。为了在字段乱序输出时仍能捕获后续字段，原作者在前瞻终止符中过度防御性地加入了 `tool|path`。
- **项目宪章 (AGENTS.md) 校验**: 
  查阅 `cph-dev-agent-prompt.txt` 行 38-44：系统提示词已经严格规范了 Action 的排版范式（`tool -> path -> old_string -> new_string`）。Harness 解析器为了过度包容乱序而引入模糊前瞻，反而破坏了正规代码编辑，违背了“保持协议纯粹、不给模型擦屁股”的准则 1。
- **复核裁决**: `[CONFIRMED]` (确凿缺陷)
- **源码与上下文核验**: 
  核验 `src/protocol/resilient-parser.ts#L201-L206`：
  ```typescript
  const oldStrMatch = contentToScan.match(
    /(?:old_string|oldstring|old_text|oldText)\s*:\s*([\s\S]*?)(?=\n(?:new_string|newstring|new_text|newText|tool|path)\s*:|$)/i
  );
  ```
  通过 Bun 执行 PoC：包含 `path: /var/www/old` 的 YAML 片段在解析时，`old_string` 被截取为 `"server:"`，后续内容完全丢失。工具端执行比对必报 `oldText not found`。
- **设计文档与 Git 证据链**: 
  规范 `cph-dev-agent-prompt.txt` 中明确操作格式为 `old_string` 后紧跟 `new_string`。
- **最终保留建议**: 
  必须修复。从前瞻终止符中剔除 `tool|path` 等常见代码关键字；或强制要求 `old_string` 与 `new_string` 之间以唯一的专有定界符或严格的缩进/结构化标记分隔。

---

### 针对初审第 3 项：`ChatHubClient` 在握手后异常断开时调用 `settleResolve`，将网络崩溃伪装为成功
- **初审判定与 PoC**: A 报告指控 `ws.onclose` 在 `hasSentChat` 为真时，无论关闭状态码是 1006（异常断连）还是 1008（策略封禁），均通过 `settleResolve` 将其包装为成功消息，导致上游 `Orchestrator` 将网络瘫痪误认为模型的 `invalid_chatter`（置信度 Level 1）。
- **原作者辩护推演 (Steelmanning)**: 
  原作者面对的现实是：微软 Copilot / Sydney 服务端在长消息流式生成结束时，存在部分网关或反向代理不发送显式 SignalR Type 2/3 帧而直接关闭底层 TCP/WebSocket 连接的边缘行为。如果只要没收到完结帧就在 `onclose` 中无差别 `settleReject`，会导致大量已经完整收到流式文本的成功轮次被判为异常失败。原作者期望通过兜底 `settleResolve` 保留已收到的 `fullText`。
- **项目宪章 (AGENTS.md) 校验**: 
  `AGENTS.md` 准则 1 与准则 6 规定：“调度由系统自动保障，网络与异常状态必须真实反映给容灾管道”。伪装成功直接架空了容灾仲裁机制，属于底层工程缺陷。
- **复核裁决**: `[CONFIRMED]` (确凿缺陷)
- **源码与上下文核验**: 
  核验 `src/transport/chathub-client.ts#L460-L481`：
  ```typescript
  ws.onclose = (ev) => {
    if (!hasSentChat) {
      if (ev.code === 1008 || ev.code === 1006) {
        events?.onRateLimitDetected?.(this.token.email);
      }
      settleReject(new Error(`WebSocket closed prematurely (${ev.code})`));
    } else if (!isSettled) {
      settleResolve({ text: fullText, ... });
    }
  };
  ```
  致命事实核对：一旦请求已经发出（`hasSentChat = true`），若在收到任何 token 前遭遇 TCP Reset（1006）或服务端限流切断（1008），`onRateLimitDetected` 不会被触发，`settleReject` 不会被触发，而是执行 `settleResolve({ text: "" })` 返回空串。`Orchestrator` 收到空串后无法触发 `isRecoverableTransportError`，走入 Case 3c 误报为 `invalid_chatter` 并持续空耗轮次直至上限。
- **设计文档与 Git 证据链**: 
  Commit `b8ad75a` 原文证实 `if (ev.code === 1008 || ev.code === 1006)` 被错误嵌套在 `if (!hasSentChat)` 内部。
- **最终保留建议**: 
  必须修复。在 `ws.onclose` 中，若状态码为 1006 / 1008，无论处于哪个阶段均必须触发频控通知并调用 `settleReject`；仅当状态码为 1000（正常关闭）且 `fullText.length > 0` 时，才允许作为降级结算解析。

---

### 针对初审第 4 项：`Orchestrator` 默认阈值 0 触发激进云端附件上传，彻底抹除 Prompt 工具输出事实
- **初审判定与 PoC**: A 报告认为 `Orchestrator` 构造器中将云端附件阈值默认设为 0，导致所有 >0 字符的工具输出全部上传 OneDrive，且 Prompt 中抹除了执行内容，后继轮次清空附件句柄导致模型失明（置信度 Level 1）。
- **原作者辩护推演 (Steelmanning)**: 
  原作者在 `cph-dev-agent-prompt.txt` 中构想了一套“全量无损文件附件交付体系 (Lossless Attachment Architecture)”：在 Windows 环境下，PowerShell 控制台输出极易产生 GBK/UTF-8 字符损坏与截断，同时大文本直接塞入 Prompt 会稀释模型注意力。原作者希望所有工具输出通过 OneDrive 附件交付，由微软云端文档引擎进行原生解析，正文仅留元数据。
- **项目宪章 (AGENTS.md) 校验**: 
  `AGENTS.md` 准则 1 要求调度中立，准则 6 要求“操作者视角与客观事实感知”。将所有微小输出（包括 5 字符的布尔值）强行剥离出 Prompt，完全违背了模型的有效推理习惯。
- **复核裁决**: `[DRIFT-DESYNC]` (设计资产严重脱节，且存在确凿实现缺陷)
- **源码与上下文核验**: 
  1. 查阅历史设计规格 `specs/2026-10-11-cph-pi-smart-handoff-and-interactive-runtime-design.md` 第 18 行与第 104-105 行，明确记录了历史教训与改动结论：
     > “根因：Harness 云端附件阈值过苛（超过 20 行或 800 字符即上传 OneDrive 并截断正文），而云端 Copilot 无法即时读取附件正文导致失明...
     > `cloudAttachmentThresholdChars`: 800 → 120,000 (120 KB);
     > `cloudAttachmentThresholdLines`: 20 → 3,000 行”
  2. 然而在物理代码 `src/agent/orchestrator.ts#L195-L196` 中，默认值却被设置为 `0`：
     ```typescript
     this.cloudAttachmentThresholdChars = options.cloudAttachmentThresholdChars ?? 0;
     this.cloudAttachmentThresholdLines = options.cloudAttachmentThresholdLines ?? 0;
     ```
  3. 此外，在 `orchestrator.ts#L458`，`currentAnnotations = []` 在单轮发包后被立即清空，后续轮次由于不再挂载历史附件注解，且 Prompt 历史中无文本，模型确实陷入确定性失明。
- **设计文档与 Git 证据链**: 
  代码实现与 `smart-handoff-and-interactive-runtime-design.md` 既定规格发生严重漂移脱节。
- **最终保留建议**: 
  必须对齐设计规范。将默认阈值纠偏为规范要求的 `120,000` 字符与 `3,000` 行；并在附件 Prompt 中保留前后 20 行上下文快照保底。

---

### 针对初审第 5 项：`AccountPool` 轮询索引在异步 Token 交换前未递增，导致并发子代理完全碰撞
- **初审判定与 PoC**: A 报告指出 `AccountPool.getNextAvailableToken` 在调用异步 `this.manager.getAccessToken(acc.email)` 之后才更新 `this.currentIndex`，并发子代理在同一微秒调用时读取相同索引，造成并发请求全部命中同账号碰撞（置信度 Level 1）。
- **原作者辩护推演 (Steelmanning)**: 
  原作者的单线思维模式是：如果某个账号在 `getAccessToken` 阶段发生网络超时或凭据错误，该调用会在 catch 块中将其标记为限流，并继续尝试当前循环内的下一个账号。原作者认为“只有真正成功获取了 Token，这个账号才算被有效消费”，因此将 `this.currentIndex = (idx + 1) % total` 放置在成功的 await 之后。
- **项目宪章 (AGENTS.md) 校验**: 
  `AGENTS.md` 准则 6 明确指出：“底层账号池队列并发度是 1 还是多账号... 模型只需专注于标准行动输出，底层调度由系统自动保障”。账号池未做好并发安全调度，属于 Harness 内部并发缺陷。
- **复核裁决**: `[CONFIRMED]` (确凿缺陷)
- **源码与上下文核验**: 
  核验 `src/auth/account-pool.ts#L320-L346`：
  ```typescript
  for (let i = 0; i < total; i++) {
    const idx = (this.currentIndex + i) % total;
    ...
    const session = await this.manager.getAccessToken(acc.email); // 异步网络延迟！
    this.currentIndex = (idx + 1) % total; // 只有返回后才推进！
    return session;
  }
  ```
  在并发场景下（`Promise.all` 派发多任务），所有并发 Worker 在进入该函数的第一轮微任务中读到的 `this.currentIndex` 均相同，所有并发子代理毫无悬念地抢占同一物理账号，直接引发 429 级联雪崩。
- **设计文档与 Git 证据链**: 
  设计文档 `specs/2026-10-12-main-session-virtualization-and-account-concurrency-design.md` 明确承诺了“账号自适应并发度队列：多账号物理并发加速”，但底层未能提供并发安全分发。
- **最终保留建议**: 
  必须修复。在选定候选索引后立即预先乐观递增 `this.currentIndex`，或引入轻量并发调度排队锁（Mutex）。

---

### 针对初审第 6 项：`TokenManager` 缺乏并发刷新凭据互斥锁，触发 Azure AD Refresh Token 轮转作废
- **初审判定与 PoC**: A 报告指出 `TokenManager.getAccessToken` 在 Token 过期刷新时缺乏 In-flight 请求去重，并发调用会携带相同旧 RT 请求 Azure AD，触发 Refresh Token Rotation 机制导致第二路触发 `invalid_grant`，永久作废账号凭据（置信度 Level 1）。
- **原作者辩护推演 (Steelmanning)**: 
  `TokenManager` 最初是为单会话交互式 CLI 设计的，在一个会话中，Token 刷新通常是按小时发生的孤立事件，内存缓存 `this.activeTokens.get(key)` 足以应对顺序调用的绝大多数场景。并发请求是在引入多子代理（Subagent）后才出现的新工作负载。
- **项目宪章 (AGENTS.md) 校验**: 
  OAuth2 凭据生命周期与安全存储属于底层物理管道设施，发生损坏会迫使用户重新手动扫码登录，破坏无人值守自动化运行基石。
- **复核裁决**: `[CONFIRMED]` (确凿缺陷)
- **源码与上下文核验**: 
  核验 `src/auth/token-manager.ts#L193-L270`：
  代码中完全没有维护 `inFlightRefreshes = new Map<string, Promise<ActiveSessionToken>>()`。
  Azure AD 的 OAuth 2.0 终结点对公共客户端执行严格的单次刷新令牌轮转（Single-use Refresh Token Rotation）。一旦第一个请求成功返回新 RT，旧 RT 即刻作废。与第一个请求并发发起的第二个请求到达 Azure AD 时，Azure AD 必返回 `AADSTS700084: The refresh token was issued to a previous version of the authentication... (invalid_grant)`。
- **设计文档与 Git 证据链**: 
  历史架构设计未包含对 Azure AD Refresh Token Rotation 的并发防御。
- **最终保留建议**: 
  必须修复。在 `TokenManager` 内部增加针对 `email` 的 In-flight Promise 去重缓存，并发刷新请求必须合并至同一个 Promise。

---

### 针对初审第 7 项：`Orchestrator` Handoff 文件路径未做路径穿越消毒，存在任意写文件风险
- **初审判定与 PoC**: A 报告指出 `Orchestrator` 在多处拼接 Handoff 路径时直接采用外部传入的 `sessionId`，未做文件名过滤消毒，存在路径穿越风险（置信度 Level 1）。
- **原作者辩护推演 (Steelmanning)**: 
  原作者假设所有 `sessionId` 均由系统的 `crypto.randomUUID()` 或 `SessionManager` 生成，因此在内部拼接路径时采用了简单的模板字符串 `handoff-${targetSessionId}.md`。
- **项目宪章 (AGENTS.md) 校验**: 
  根目录 `AGENTS.md` 铁律第 1 条与第 3 条明确规定：
  > “AI 严禁在工作区根目录写任何文件。所有代码、文档、配置文件必须创建在二级子目录内；根目录仅允许 AGENTS.md、.gitignore、README.md 存在。”
  如果外部传入 `../../tamper` 作为 `sessionId`，`path.join(handoffsDir, 'handoff-../../tamper.md')` 将直接逃逸至工作区根目录甚至工作区之外写文件，严重触碰宪章红线。
- **复核裁决**: `[CONFIRMED]` (确凿缺陷)
- **源码与上下文核验**: 
  核验 `src/session/session-manager.ts#L332-L334`：`SessionManager` 内部有白名单校验：
  ```typescript
  private isValidSessionId(id: string): boolean {
    return /^[a-zA-Z0-9_\-]+$/.test(id);
  }
  ```
  然而在 `src/agent/orchestrator.ts#L593`, `L908`, `L1244`, `L1416` 四处落盘与读取路径上，完全没有复用该校验，直接使用原始 `sessionId` 拼接。
- **设计文档与 Git 证据链**: 
  两模块间安全契约割裂。
- **最终保留建议**: 
  必须修复。在 `Orchestrator` 拼接文件名时统一调用 `sessionId.replace(/[^a-zA-Z0-9_\-]/g, "_")` 强制清洗。

---

### 针对初审第 8 项：`ResilientParser` 终结符正则模糊，技术说明文本中的 `ALL_TASKS_COMPLETED` 引发任务提前假死
- **初审判定与 PoC**: A 报告指出 `ResilientParser.parse` 采用 `trimmed.includes("ALL_TASKS_COMPLETED")` 与不加词界的正则，导致技术排查陈述中提及该关键字时被直接误判为 `final_answer`（置信度 Level 1）。
- **原作者辩护推演 (Steelmanning)**: 
  在早期调优各种小模型或第三方 Sydney 提示词时，模型在结束时并不总是输出规范的 `FINAL_ANSWER:`，有时会输出 `ALL_TASKS_COMPLETED` 或 `【已完成交付】`。原作者为了防止智能体在已完成工作时因 Harness 无法识别而无限循环 `invalid_chatter`，增加了这类宽松的子串包含兜底。
- **项目宪章 (AGENTS.md) 校验**: 
  `AGENTS.md` 准则 1 明确规定：“Harness 本身应当保持中立与协议纯粹。严禁替模型‘擦屁股’（例如否定词过滤、模糊猜测试图帮模型纠偏）。如果模型输出了期望以外的内容，应该调整的是系统提示词与专属 Skill 内容”。模糊子串探测完全违背了这一原则。
- **复核裁决**: `[CONFIRMED]` (确凿缺陷)
- **源码与上下文核验**: 
  核验 `src/protocol/resilient-parser.ts#L80` 与 `L104-L107`：
  ```typescript
  if (trimmed.includes("ALL_TASKS_COMPLETED") || trimmed.includes("【已完成交付】")) {
    return { type: "final_answer", ... };
  }
  ```
  在 Bun 中执行实测：当输入为 `"诊断发现：测试脚本在等待 ALL_TASKS_COMPLETED 信号时发生超时，我们还需要继续排查。"` 时，解析器无视上下文，直接判定为 `final_answer`，任务中断退出。
- **设计文档与 Git 证据链**: 
  `cph-dev-agent-prompt.txt` 第 61-62 行已经明确要求模型在独立一行输出交付总结：`FINAL_ANSWER: [...]`。
- **最终保留建议**: 
  必须修复。完全剔除 `trimmed.includes(...)` 的无边界子串匹配，终结符必须严格要求行首匹配（如 `/^FINAL_ANSWER:\s*/m`）。

---

### 针对初审第 9 项：`RefusalGuard` 强匹配模式串产生假阳性拦截，形成死循环并误封账号
- **初审判定与 PoC**: A 报告指控 `RefusalGuard` 正则库过于宽泛（如 `/无法直接访问.*本地/`），技术分析被误判为拒绝，触发纠偏重试，并在 3 次失败后直接调用 `pool.markThrottled` 封禁健康账号（置信度 Level 1）。
- **原作者辩护推演 (Steelmanning)**: 
  微软 Sydney 拥有极强的系统预设安全对齐，会本能地产生沙盒幻觉宣称“作为 AI 我无法直接访问你的本地磁盘，请上传 zip”。原作者设计 `RefusalGuard` 的初衷是拦截这种典型的沙盒幻觉并给模型当头棒喝；若模型连拒 3 次，原作者认为该 Sydney 会话已经陷入顽固拒绝，因此尝试换账号拉起新会话。
- **项目宪章 (AGENTS.md) 校验**: 
  这是项目治理宪章最为核心的红线冲突项！
  1. `AGENTS.md` 准则 1：“Harness 本身应当保持中立与协议纯粹。严禁替模型‘擦屁股’（例如否定词过滤、模糊猜测试图帮模型纠偏）”；
  2. `AGENTS.md` 准则 2：“所有精力与重构重心应当放在 Copilot Agent 的系统提示词设计上，通过清晰的认知边界引导模型自主做出正确决策，而不是在 Harness 调度层做妥协”；
  3. `AGENTS.md` 准则 3：“编写系统提示词与 Skill 时，杜绝使用负面禁止词，全面转为建设性的正向引导”。
  `RefusalGuard` 本身就是违背中立宪章的特化补丁产物，其负面词拦截模式更是反模式典型。
- **复核裁决**: `[VIOLATES-GOVERNANCE-RULE]` (违反项目治理准则，且存在确凿误杀事实)
- **源码与上下文核验**: 
  1. `src/agent/refusal-guard.ts#L17` 的正则 `/无法直接访问.*本地/i` 过于激进。当模型陈述客观事实（例如分析某个 npm 权限报错或 docker 隔离环境）时，被无情定性为 Refusal；
  2. `src/agent/orchestrator.ts#L527` 在重试耗尽后直接执行 `this.pool.markThrottled(currentEmail)`，将完全正常的 M365 账号打入冷却黑名单，极易造成账号池虚假枯竭。
- **设计文档与 Git 证据链**: 
  与 `AGENTS.md` 准则 1、2、3 发生直接冲突。
- **最终保留建议**: 
  全面整改。按治理宪章精神弱化或移除 Harness 层的文本关键字拦截；通过加强系统提示词中的元认知塑造解决沙盒幻觉；绝不能将模型语义拒绝等同于 429 网络限流去封禁账号。

---

### 针对初审第 10 项：`SubagentRunner` 与 `Orchestrator` 状态时序倒置，导致后继会话重定向事件无法触发
- **初审判定与 PoC**: A 报告指出 `SubagentRunner.executeBatch` 内部尝试调用 `lineageTracker.resolveActiveHead` 重定向交付物，但 `Orchestrator` 严格在 await 批处理完成之后才创建与登记后继代际，导致重定向分支在正常流程中永不触发（置信度 Level 2）。
- **原作者辩考推演 (Steelmanning)**: 
  在设计文档 `specs/2026-10-12-tri-agent-handoff-and-lineage-architecture-design.md` 中，原作者构思了一个高度异步的极端容灾模型：主控在后台派发多个子代理异步攻坚，而主控自身在遭遇 429 频控时，可能提前发生交接并迁移至新账号拉起 Successor。为了在这种异步并发场景下使子代理的成果能自动回流到已转移的最新主控，原作者在 `SubagentRunner` 中预先埋设了 `resolveActiveHead` 动态重定向钩子。
- **项目宪章 (AGENTS.md) 校验**: 
  符合黑盒契约与血缘追踪理念，但实现时序与同步编排产生了脱节。
- **复核裁决**: `[DRIFT-DESYNC]` (设计预期与单机顺序执行脱节)
- **源码与上下文核验**: 
  核验物理代码发现：在 `src/agent/orchestrator.ts#L655`，主控是同步 `await runner.executeBatch(...)` 阻塞等待子代理完成的。在子代理执行期间，当前主控并未并发推进。因此当 `executeBatch` 内部在 L140 执行 `resolveActiveHead(this.mainSessionId)` 时，后继代际根本还未创建（直到 L674-L685 才创建）。因此该判断分支确实成为死逻辑，但未造成运行崩溃，成果仍然被正确返回给调用它的父级 `orchestrator`。
- **设计文档与 Git 证据链**: 
  设计文档描绘的“异步容灾并发动态回流”与实际代码中“严格顺序阻塞 await 推进”存在设计与实现的时序脱节。
- **最终保留建议**: 
  保留该血缘感知结构；若未来支持真正的后台长效异步子代理，该机制即可激活。当前应在架构注释中明确标注其为异步就绪（Async-Ready）防御性设计。

---

### 针对初审第 11 项：`InterruptController` 在繁忙与空闲切换边界存在双击退出信号竞态
- **初审判定与 PoC**: A 报告认为当子进程正在清理退出时，用户连按 Ctrl+C 期望强退，但系统由于仍处于 busy 状态而仅返回 `aborted_operation`，未记录空闲时间戳，造成用户无法强退终端（置信度 Level 2）。
- **原作者辩护推演 (Steelmanning)**: 
  原作者针对终端用户习惯进行了极其深思熟虑的设计：用户在终端中运行耗时操作（如 `npm install` 或全量测试）时，一旦发现命令卡住或想要中断，常常会习惯性地**连续疯狂敲击多次 Ctrl+C**。如果系统在 busy 状态下把连续的 Ctrl+C 视作退出 CLI 进程的信号，用户辛辛苦苦积累了 20 轮上下文的交互会话就会在瞬间被误杀毁灭！原作者设计两段式中断的根本宗旨，正是为了在任务运行时保护会话免遭误杀：**运行中无论按多少次 Ctrl+C，只杀子任务，绝不杀 CLI 进程！唯有在回到空闲提示符后，双击 Ctrl+C 才是明确退出终端**。
- **项目宪章 (AGENTS.md) 校验**: 
  属于终端交互控制器设计，不涉及模型协议或治理违规。
- **复核裁决**: `[INTENDED-DESIGN]` (既定设计与合理工程取舍)
- **源码与上下文核验**: 
  查阅单元测试文件 `tests/agent/interrupt-controller.test.ts#L51-L62`，赫然存在专门为此行为编写的测试用例：
  ```typescript
  it("should handle repeated SIGINTs while busy without exiting", () => {
    const abortCtrl = controller.beginBusy();
    const res1 = controller.handleSigint();
    const res2 = controller.handleSigint();
    expect(res1.action).toBe("aborted_operation");
    expect(res2.action).toBe("aborted_operation");
    expect(exitCalls).toBe(0); // 明确断言不退出进程！
  });
  ```
  设计文档 `specs/2026-10-10-cph-pi-design.md` 第 127-129 行亦明确规定：“任务运行中按单次 Ctrl+C 取消流或子进程，会话依然存活；空闲时连续按两次 Ctrl+C 安全退出终端”。
- **设计文档与 Git 证据链**: 
  设计资产与专用单元测试两相印证，证明此机制是百分之百的**既定保护性设计**。A 报告将其定为“时序竞态缺陷”属于对原作者设计意图的严重误判。
- **最终保留建议**: 
  维持既定设计，无需整改。如需支持极端情况下的强制杀壳，可单独监听全局未捕获异常或三击强制退出，但绝不能破坏繁忙状态下的防误杀屏障。

---

### 针对初审第 12 项：`Orchestrator` 代际轮换重置 `turn = 0` 破坏 `history` 轮次单调性与折叠器不变量
- **初审判定与 PoC**: A 报告指出在后继主控唤醒时，代码直接设置 `turn = 0`，随后将记录压入未清空的累计 `history` 数组，导致 `history` 中轮次呈现非单调序列，使 `BlackboxCompactor` 产生倒置或重复的折叠摘要（置信度 Level 1）。
- **原作者辩护推演 (Steelmanning)**: 
  `Orchestrator.run` 的主循环是 `while (turn <= this.maxTurns)`。当执行 `invoke_subagent` 激活后继主控后，为了赋予新一代主控完整的 30 轮推理预算，原作者直接重置了局部循环变量 `turn = 0`，使其能在当前 `run()` 方法中继续执行完整的 30 轮循环，而无需重新实例化整个编排器。
- **项目宪章 (AGENTS.md) 校验**: 
  底层状态追踪与黑匣子快照的自洽性是容灾仲裁的基石。时序混乱直接污染后续仲裁者的推理上下文。
- **复核裁决**: `[CONFIRMED]` (确凿缺陷)
- **源码与上下文核验**: 
  核验物理代码 `src/agent/orchestrator.ts#L710` 与 `src/agent/blackbox-compactor.ts#L442-L445`：
  `history` 是一个全程累计的 `TurnRecord[]`。后继轮次继续向其中压入 `turn: 1`, `turn: 2`。
  当发生容灾提取黑匣子时，`BlackboxCompactor.buildFoldedBlock` 执行：
  ```typescript
  const firstTurn = turns[0].turn;
  const lastTurn = turns[turns.length - 1].turn;
  return `- Turns ${firstTurn} ~ ${lastTurn}: ...`;
  ```
  如果折叠窗口跨越了代际，`firstTurn` 可能为 4，`lastTurn` 为 2，输出了荒谬的 `Turns 4 ~ 2: 6 轮历史步骤已聚合折叠`，破坏了时间线的客观真实性。
- **设计文档与 Git 证据链**: 
  `TurnRecord` 结构设计上缺少 `generation` 字段，且 `history` 缺乏代际命名空间。
- **最终保留建议**: 
  必须修复。在 `TurnRecord` 中增加 `generation` 标识，或维护全局递增的 `globalTurn` 与代际内的 `turnInGeneration`，保持 `history` 数组的全局单调性。

---

### 针对初审第 13 项：`SessionManager` 在并发会话保存时对 `index.json` 无文件锁保护导致覆盖丢失
- **初审判定与 PoC**: A 报告声称 `SessionManager.saveSession` 在读取和写入 `index.json` 时没有并发锁，并发写会抹掉互斥项，并给出了 PoC（置信度 Level 1）。
- **原作者辩护推演 (Steelmanning)**: 
  原作者采用的是 Node.js/Bun 单线程体系下经典的同进程同步文件 IO 模式：`fs.readFileSync` 和 `fs.writeFileSync` 均为完全阻塞的同步调用。此外，原作者在设计时已经充分考虑了 `index.json` 损坏或缺失的可能性，因此专设了 `rebuildIndex()` 方法（第 163 行）：一旦索引解析失败，自动遍历目录下的所有 `*.json` 独立会话文件重建索引。
- **项目宪章 (AGENTS.md) 校验**: 
  不涉及宪章违规。
- **复核裁决**: `[FALSE-POSITIVE]` (误报 / 概念混淆)
- **源码与上下文核验**: 
  1. 事实核验：查阅 `src/session/session-manager.ts#L240-L278`，`saveSession` 是一个**纯同步函数**（Synchronous Function），其内部既没有 `await`，也没有异步回调或定时器：
     ```typescript
     public saveSession(session: SessionData): void {
       // 全程纯同步：
       fs.writeFileSync(sessionFile, ...);
       const index = this.readIndex(); // 同步读
       ...
       this.writeIndex(index); // 同步写
     }
     ```
     在 Node.js / Bun 的单线程事件循环中，同步代码具备天然的原子性执行特征，任何异步任务绝不可能插入在 `readIndex()` 和 `writeIndex()` 之间！
  2. 实测 A 报告的 PoC：A 报告提供的测试用例中调用的 `createSession` 全程同步执行，我们在 Bun 运行时亲自执行了该 PoC 脚本，结果如下：
     ```text
     count: 2
     has s1: true
     has s2: true
     ```
     测试 100% 绿色通过，根本不存在条目丢失！
  3. 即使在跨进程极端并发导致文件损坏的极小概率场景下，`SessionManager` 的 `rebuildIndex()` 也会在下一次访问时通过扫描真实物理文件自动修复。
- **设计文档与 Git 证据链**: 
  A 报告误将“异步并发竞态”套用到了“纯同步执行流”上，属于对 JavaScript 事件循环机制的理论误判。
- **最终保留建议**: 
  否决该缺陷判定。无需引入复杂的文件锁，当前同步实现配合 `rebuildIndex` 自愈机制已经完全满足架构需求。

---

### 针对初审第 14 项：`ToolBridge.formatResult` 与 `PromptBuilder.buildToolResultPrompt` 协议双轨冲突
- **初审判定与 PoC**: A 报告指控 `ToolBridge.formatResult` 与 `PromptBuilder.buildToolResultPrompt` 存在两套定界符（一处用【TOOL_RESULT: ...】，一处用 [TOOL_RESULT for ...]），存在协议双轨割裂与死代码（置信度 Level 2）。
- **原作者辩护推演 (Steelmanning)**: 
  系统在演进初期，`ToolBridge` 独立负责工具的执行与结果封装，提供了 `formatResult`；随后在编排层引入了更强大的 `PromptBuilder`，负责将工具结果与系统提示词、协议强化提醒（`PROTOCOL_REMINDER`）及无损附件提示进行统一装配。`Orchestrator` 全面切换到了 `PromptBuilder`，而保留 `ToolBridge.formatResult` 是为了向下兼容部分单元测试与直接调用 `ToolBridge` 的辅助用例。
- **项目宪章 (AGENTS.md) 校验**: 
  属于工程重构与代码清理范畴，运行时由 `PromptBuilder` 统一单轨发包，未造成实际语义冲突。
- **复核裁决**: `[DRIFT-DESYNC]` (演进脱节与冗余死代码)
- **源码与上下文核验**: 
  核验 `src/agent/orchestrator.ts#L805`：
  ```typescript
  currentPrompt = PromptBuilder.buildToolResultPrompt(
    parsed.action.tool || toolResult.actionName,
    toolResult.success,
    toolResult.output
  );
  ```
  编排器在运行时完全没有向模型发送 `toolResult.formatted`，发送给模型的所有工具结果提示词 100% 均来自 `PromptBuilder`。因此模型端接收到的定界符格式是全局统一且一致的。`ToolBridge.formatResult` 仅作为内部未使用的冗余产物存在。
- **设计文档与 Git 证据链**: 
  符合多阶段渐进式重构的典型脱节特征。
- **最终保留建议**: 
  在下一阶段重构中，让 `ToolBridge.formatResult` 直接代理调用 `PromptBuilder.buildToolResultPrompt`，消除冗余格式并收敛 SSOT。

---

## 复核总结与裁决结论

经过对源码逐行对账、运行 PoC 验证、深度 Steelmanning 推演以及严格核验项目治理宪章（`AGENTS.md`），复审子代理 B2 对 Dim-2 初审报告的 14 项问题做出最终仲裁：
- **确凿缺陷 [8 项]**: Items 1, 2, 3, 5, 6, 7, 8, 12。此类缺陷具有清晰反例与代码证据，直接破坏了代码解析、网络容灾、账号并发调度与时序单调性，属于最高优先级整改对象。
- **违反宪章 [1 项]**: Item 9 (`RefusalGuard`)。不仅产生了假阳性拦截与错误封号，更在根本上违背了 `AGENTS.md` 中“Harness 调度中立、严禁替模型擦屁股、摒弃负面词”的核心治理准则。
- **设计脱节 [3 项]**: Items 4, 10, 14。反映了实现代码与既定设计资产（如 `smart-handoff` 规格文档、异步继承链条）之间的版本漂移与冗余遗留。
- **既定设计 [1 项]**: Item 11 (`InterruptController`)。经设计规范与专用单元测试查证，系经过权衡的保护性既定设计，初审报告判定不成立。
- **误报概念混淆 [1 项]**: Item 13 (`SessionManager`)。初审报告误将异步并发概念套用于纯同步逻辑，PoC 实测完全通过，初审判定不成立。
