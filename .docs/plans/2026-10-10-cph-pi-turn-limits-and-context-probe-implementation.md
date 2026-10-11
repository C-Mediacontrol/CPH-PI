# CPH-PI 云端会话轮数上限与上下文注入实证探测实施计划

> **参考设计规范**：[`CPH-PI/.docs/specs/2026-10-10-cph-pi-turn-limits-and-context-probe-design.md`](file:///e:/copilot-web%20proxy/CPH-PI/.docs/specs/2026-10-10-cph-pi-turn-limits-and-context-probe-design.md)

---

## 一、 冲击面扫描 (Impact Surface Scan)

| 制品类型 | 生产方 (Upstream) | 消费方 (Downstream) | 冲击面与防护策略 |
| :--- | :--- | :--- | :--- |
| **脚本执行器** | `scripts/probe-limits.ts` | 开发者 / 自动化测试 | 独立脚本，零侵入现有核心源码与主 CLI。 |
| **测试套件** | `tests/scripts/probe-limits.test.ts` | `bun test` 门禁 | 补充 Mock WebSocket 协议测试，保证纳入 299+ 用例全量回归。 |
| **网络与连接** | `ChatHubClient` / `AccountPool` | Sydney WebSocket | 严格控制 1.5s 轮次间隙，捕获 429 指数退避，防止触怒微软风控。 |
| **报告产物** | `.cph/probe-reports/` | 架构决策评估 | 自动落盘 JSON 与 Markdown，不污染工作区根目录。 |

---

## 二、 任务切片与执行清单

### Task 1: 探针核心执行引擎与载荷生成器 (`scripts/probe-limits.ts`)
- **目标**：实现全自动化、无外围包装干扰的直连探针脚本。
- **涉及文件**：
  - `CPH-PI/scripts/probe-limits.ts`
- **实施要点**：
  1. CLI 参数解析：`--mode <short|long-text|local-file|cloud-attachment>`、`--max-turns <n>`、`--agent <id>`；
  2. 实现 4 种载荷生成器（`buildShortPrompt`, `buildLongTextPrompt`, `buildLocalFilePrompt`, `buildCloudAttachmentPayload`）；
  3. 捕获每个 SignalR 原始帧，记录耗时、Thinking 流与文本流；
  4. 终结特征捕获：检测 `Disengaged`、`Throttled`、限制文本模式；
  5. 实现 `saveProbeReport`，将遥测指标输出至 `.cph/probe-reports/`。

### Task 2: 探针单元与模拟测试套件 (`tests/scripts/probe-limits.test.ts`)
- **目标**：为探针编写端到端 Mock 测试，验证 4 种模式的流转与终结拦截。
- **涉及文件**：
  - `CPH-PI/tests/scripts/probe-limits.test.ts`
- **实施要点**：
  1. 测试 `short` 模式全流程与正常达标；
  2. 测试第 30 轮收到 `Disengaged` 报文的精准拦截与终结帧捕获；
  3. 测试 429 限流保护与优雅退出；
  4. 验证 JSON 与 Markdown 报表格式完整性；
  5. 运行 `bun test` 确保全量 305+ 项测试 100% 绿灯。

### Task 3: 实机现网探测与全量数据分析 (Empirical Probing on CPH-Dev)
- **目标**：针对真实云端 `CPH-Dev` 启动 4 轨实机探测，提取客观证据。
- **执行步骤**：
  1. 运行 `--mode short`：测出理论最大纯轮数极限与切断特征；
  2. 运行 `--mode long-text`：测出聊天框灌大文本下的累积上下文临界点；
  3. 运行 `--mode local-file`：测出本地文件旁路下的稳定表现；
  4. 运行 `--mode cloud-attachment`：探测云端 WebSocket 附件注入的协议兼容度；
  5. 汇总 4 份报告，向用户汇报终极实验结论与架构指导建议。

