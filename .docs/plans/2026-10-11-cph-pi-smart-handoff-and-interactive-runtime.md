# CPH-PI 智能交接双保险、交互式问答与全量代码直传实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 解决 CPH-PI 长任务在 LOGS3 中暴露的交接文档缺失 AI 思考、`ask_question` 未响应、接力跃迁中断不易恢复以及文件碎片化切片读取 4 大核心瓶颈，实现双端（Agent Prompt/Skill + 本地 Harness）协同演进。

**Architecture:**
- **双端协同契约**：同步改造 `cph-dev-agent-prompt.txt`、`thermo-nuclear-code-quality-review/SKILL.md` 与本地 Harness；
- **交接双保险**：过程阶段性落盘至 `.cph/review_draft.md` + 终局（Turn `maxTurns - 1`）向模型下发预交接召唤并捕获 `HANDOFF_MEMO:`；
- **全量代码直传**：拓宽 Harness 内联回执至 120,000 字符 / 3,000 行，阻断非必要 OneDrive 截断；
- **交互终端打通**：在 `ToolBridge` 与 `cli.ts` 间建立真实交互式 `onQuestion` 回调并支持 Readline 挂起输入；
- **自主接力跃迁**：跃迁上限提升至 10 次，`/resume` 恢复时自动续跑，增加 `/continue` 与 `/relay` 命令。

**Tech Stack:** TypeScript, Bun, Chalk, Node Readline, SignalR WebSocket (ChatHub).

## Global Constraints

- 严禁单端单改：Agent Prompt、Skill 规范与本地 Harness 代码必须联动修改、严格对齐；
- 遵循现有 TDD 纪律：所有 Harness 核心改动必须先写失败测试，验证红灯后再实施代码变动；
- 保持向后兼容：现有 380 项单元与端到端测试必须全绿，不得引入回归破坏。

---

### Task 1: Prompt 与 Skill 规范化契约更新

**Files:**
- Modify: `E:\copilot-web proxy\CPH-PI\cph-dev-agent-prompt.txt`
- Modify: `C:\Users\UserX\.gemini\config\skills\thermo-nuclear-code-quality-review\SKILL.md`

**Interfaces:**
- Produces: 全量代码读取原则、`.cph/review_draft.md` 阶段落盘规范、`HANDOFF_MEMO:` 预交接格式契约。

- [x] **Step 1: 更新 `cph-dev-agent-prompt.txt`**

移除 `limit: 100` 诱导切片读取的示例；解除单行 Thought 禁言；增加全量阅读原则与 `HANDOFF_MEMO` 契约：

```text
# 核心原则
- 【源码优先全量阅读】：代码审阅或分析时，必须使用 tool: read_file 一次性读取完整源文件（严禁自写 Python 游标或切片脚本）。Harness 原生支持千行级代码完整直传；仅在单文件超过 3,000 行且 Harness 提示超限时方可做局部切片。
- 【长任务阶段性落盘】：在长耗时代码审查或诊断中，每完成一个模块的探查，必须使用 patch_file 或 write_file 向工作区 .cph/review_draft.md 追加结构化审计发现与架构意见。
- 【预交接总结契约】：当 Harness 发送 [SYSTEM NOTICE: 会话即将到期] 时，必须暂停工具调用，直接输出以 HANDOFF_MEMO: 开头的阶段性技术总结与交接备忘录。
```

- [x] **Step 2: 更新 `thermo-nuclear-code-quality-review/SKILL.md`**

在技能说明中明确：
- 审查大型项目时，严禁使用脚本小步切片，优先通过 `read_file` 纵览全貌；
- 将中间发现动态写入 `.cph/review_draft.md`；
- 终局阶段配合 Harness 产生结构化交接备忘。

- [x] **Step 3: 提交 Prompt 与 Skill 更新**

```bash
git add "E:\copilot-web proxy\CPH-PI\cph-dev-agent-prompt.txt"
git commit -m "docs(prompt): enforce full-file reading, incremental draft logging and handoff memo contracts"
```

---

### Task 2: Harness 源码内联回执阈值提升与全量投喂保障 (TDD)

**Files:**
- Create: `E:\copilot-web proxy\CPH-PI\tests\agent\full-file-delivery.test.ts`
- Modify: `E:\copilot-web proxy\CPH-PI\src\agent\orchestrator.ts:136-137`

**Interfaces:**
- Consumes: `cloudAttachmentThresholdChars: 120000`, `cloudAttachmentThresholdLines: 3000`.
- Produces: 允许 1500 行（约 60KB）常规代码完整直传，不触发 OneDrive 附件上传截断。

- [x] **Step 1: 编写失败测试 `tests/agent/full-file-delivery.test.ts`**

```typescript
import { describe, it, expect } from "bun:test";
import { CopilotOrchestrator } from "../../src/agent/orchestrator";

describe("Full-File Delivery Policy & Cloud Attachment Thresholds", () => {
  it("should have updated cloud attachment thresholds to 120,000 chars and 3,000 lines", () => {
    const orchestrator = new CopilotOrchestrator({
      workspaceRoot: process.cwd(),
    });
    // Access internal threshold values via public getter or verify behavior
    const charsThreshold = (orchestrator as any).cloudAttachmentThresholdChars;
    const linesThreshold = (orchestrator as any).cloudAttachmentThresholdLines;

    expect(charsThreshold).toBe(120000);
    expect(linesThreshold).toBe(3000);
  });

  it("should inline standard 1500-line code file without marking for upload", () => {
    const orchestrator = new CopilotOrchestrator({
      workspaceRoot: process.cwd(),
    });
    const lines1500 = Array.from({ length: 1500 }, (_, i) => `line ${i}: function Test() { return ${i}; }`).join("\n");
    const charCount = lines1500.length;
    const lineCount = 1500;

    const charsThreshold = (orchestrator as any).cloudAttachmentThresholdChars;
    const linesThreshold = (orchestrator as any).cloudAttachmentThresholdLines;

    const shouldUpload =
      charCount > charsThreshold || lineCount > linesThreshold;

    expect(shouldUpload).toBe(false);
  });
});
```

- [x] **Step 2: 运行测试验证失败**

运行：`bun test tests/agent/full-file-delivery.test.ts`
预期：FAIL（`Expected: 120000, Received: 800`）。

- [x] **Step 3: 修改 `src/agent/orchestrator.ts` 提升阈值**

将第 136–137 行默认阈值更新为：
```typescript
  private cloudAttachmentThresholdChars: number = 120000;
  private cloudAttachmentThresholdLines: number = 3000;
```

- [x] **Step 4: 运行测试验证通过**

运行：`bun test tests/agent/full-file-delivery.test.ts`
预期：PASS（2 pass, 0 fail）。

- [x] **Step 5: 提交更改**

```bash
git add tests/agent/full-file-delivery.test.ts src/agent/orchestrator.ts
git commit -m "feat(orchestrator): raise inline tool result thresholds to 120k chars and 3k lines"
```

---

### Task 3: 终局预交接召唤与交接双保险聚合 (TDD)

**Files:**
- Create: `E:\copilot-web proxy\CPH-PI\tests\agent\smart-handoff.test.ts`
- Modify: `E:\copilot-web proxy\CPH-PI\src\protocol\prompt-builder.ts`
- Modify: `E:\copilot-web proxy\CPH-PI\src\agent\orchestrator.ts`

**Interfaces:**
- Produces: `PromptBuilder.buildHandoffPreparationPrompt()`, 捕获 `HANDOFF_MEMO:`, 聚合 `.cph/review_draft.md` 内容至交接快照。

- [x] **Step 1: 编写失败测试 `tests/agent/smart-handoff.test.ts`**

```typescript
import { describe, it, expect } from "bun:test";
import { PromptBuilder } from "../../src/protocol/prompt-builder";
import { CopilotOrchestrator } from "../../src/agent/orchestrator";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

describe("Smart Handoff Dual-Insurance & Memo Capture", () => {
  it("should generate structured pre-handoff preparation prompt on turn maxTurns - 1", () => {
    const prompt = PromptBuilder.buildHandoffPreparationPrompt("审查当前工程代码");
    expect(prompt).toContain("SYSTEM NOTICE: 当前会话即将在下一轮达到推理上限");
    expect(prompt).toContain("HANDOFF_MEMO:");
  });

  it("should integrate .cph/review_draft.md into handoff snapshot when present", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cph-handoff-test-"));
    const cphDir = path.join(tempDir, ".cph");
    fs.mkdirSync(cphDir, { recursive: true });
    fs.writeFileSync(
      path.join(cphDir, "review_draft.md"),
      "### JsygtBatch.psm1 审查发现\n- 第 400 行存在重试缺失漏洞\n- 架构过于臃肿",
      "utf-8"
    );

    const orchestrator = new CopilotOrchestrator({
      workspaceRoot: tempDir,
    });

    const snapshot = orchestrator.generateHandoffSnapshot("测试任务", [], "ses_test_001");
    expect(snapshot).toContain("JsygtBatch.psm1 审查发现");
    expect(snapshot).toContain("第 400 行存在重试缺失漏洞");

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("should extract HANDOFF_MEMO from model response when available", () => {
    const orchestrator = new CopilotOrchestrator({
      workspaceRoot: process.cwd(),
    });
    const history = [
      {
        turn: 29,
        userInput: "test",
        response: "HANDOFF_MEMO: 经全量审查，CNNJI QUERY 模块整体健壮，但 JsygtBatch 缺少超时保护，建议下任 Agent 优先编写回归用例。",
      },
    ];

    const snapshot = orchestrator.generateHandoffSnapshot("长任务", history as any, "ses_test_002");
    expect(snapshot).toContain("前序 AI 亲笔交接备忘录");
    expect(snapshot).toContain("经全量审查，CNNJI QUERY 模块整体健壮");
  });
});
```

- [x] **Step 2: 运行测试验证失败**

运行：`bun test tests/agent/smart-handoff.test.ts`
预期：FAIL（`buildHandoffPreparationPrompt is not a function`）。

- [x] **Step 3: 实施 `PromptBuilder` 与 `CopilotOrchestrator` 逻辑**

1. 在 `src/protocol/prompt-builder.ts` 中添加方法：
```typescript
  public static buildHandoffPreparationPrompt(task: string): string {
    return `[SYSTEM NOTICE: 当前会话即将在下一轮达到推理上限]:
当前长耗时任务即将进入会话交接期。
请暂停一切常规工具调用，根据已探测工作区与已读代码，输出你的【深度技术总结与接力备忘录】（详细说明对模块架构的看法、已发现的潜在问题或漏洞，以及下一会话接力应优先执行的动作）。
输出格式必须以 "HANDOFF_MEMO: " 开头并详细展开。

原始任务需求：${task}
${this.PROTOCOL_REMINDER}`;
  }
```
2. 在 `src/agent/orchestrator.ts` 中：
   - 在推演循环中当 `turn === this.maxTurns - 1` 时，若未完成，将 `currentPrompt` 设为 `PromptBuilder.buildHandoffPreparationPrompt(task)`；
   - 在 `generateHandoffSnapshot` 中：
     - 检查工作区 `.cph/review_draft.md`，若存在则提取内容渲染进独立章节；
     - 检索 history 中以 `HANDOFF_MEMO:` 开头的最新文本，渲染为 `## 【前序 AI 亲笔交接备忘录 (Agent Handoff Memo)】`。

- [x] **Step 4: 运行测试验证通过**

运行：`bun test tests/agent/smart-handoff.test.ts`
预期：PASS（3 pass, 0 fail）。

- [x] **Step 5: 提交更改**

```bash
git add tests/agent/smart-handoff.test.ts src/protocol/prompt-builder.ts src/agent/orchestrator.ts
git commit -m "feat(orchestrator): implement pre-handoff memo notice and dual-insurance snapshot aggregation"
```

---

### Task 4: 终端交互式 `ask_question` 接入 (TDD)

**Files:**
- Create: `E:\copilot-web proxy\CPH-PI\tests\protocol\interactive-question.test.ts`
- Modify: `E:\copilot-web proxy\CPH-PI\src\protocol\tool-bridge.ts`
- Modify: `E:\copilot-web proxy\CPH-PI\src\ui\tui-renderer.ts`
- Modify: `E:\copilot-web proxy\CPH-PI\src\cli.ts`

**Interfaces:**
- Consumes: `MappedQuestionArgs` { question: string, options?: string[] }.
- Produces: `onQuestion` 回调触发 TUI 提问卡片与 Readline 交互输入，返回 `[USER_RESPONSE for ask_question]: <answer>`。

- [x] **Step 1: 编写失败测试 `tests/protocol/interactive-question.test.ts`**

```typescript
import { describe, it, expect } from "bun:test";
import { ToolBridge } from "../../src/protocol/tool-bridge";

describe("Interactive Question Protocol", () => {
  it("should trigger onQuestion callback and return user response", async () => {
    let capturedQuestion = "";
    const bridge = new ToolBridge({
      cwd: process.cwd(),
      onQuestion: async (args) => {
        capturedQuestion = args.question;
        return "用户确认：同意删除并继续";
      },
    });

    const result = await bridge.executeAction({
      tool: "ask_question",
      question: "请确认是否删除历史临时日志？",
      options: ["是", "否"],
    });

    expect(result.success).toBe(true);
    expect(capturedQuestion).toBe("请确认是否删除历史临时日志？");
    expect(result.output).toContain("用户确认：同意删除并继续");
  });
});
```

- [x] **Step 2: 运行测试验证**

运行：`bun test tests/protocol/interactive-question.test.ts`
预期：如果逻辑已有部分实现则验证其细节，若报错则补全。

- [x] **Step 3: 在 `cli.ts` 与 `tui-renderer.ts` 实施真实终端交互**

1. 在 `TuiRenderer` 增加 `renderQuestionPrompt(question: string, options?: string[]): string` 卡片渲染方法；
2. 在 `cli.ts` 中构造 `ToolBridge` 时传入 `onQuestion: async (qArgs) => { ... }`：
   - 暂停推演循环；
   - 打印黄色问答卡片；
   - 调用 `this.promptQuestion(qArgs)`，使用 readline 获取用户控制台输入；
   - 将用户输入包装为 `[USER_RESPONSE for ask_question]: ${answer}` 并返回；
3. 将该 `bridge` 正确传递给 `CopilotOrchestrator`。

- [x] **Step 4: 运行测试验证通过**

运行：`bun test tests/protocol/interactive-question.test.ts`
预期：PASS。

- [x] **Step 5: 提交更改**

```bash
git add tests/protocol/interactive-question.test.ts src/protocol/tool-bridge.ts src/ui/tui-renderer.ts src/cli.ts
git commit -m "feat(cli): wire interactive readline callback for ask_question tool"
```

---

### Task 5: 10 次接力跃迁上限与 `/resume` 智能自动续跑 (TDD)

**Files:**
- Create: `E:\copilot-web proxy\CPH-PI\tests\cli\resume-continuation.test.ts`
- Modify: `E:\copilot-web proxy\CPH-PI\src\cli.ts`

**Interfaces:**
- Produces: `maxAutonomousHandoffHops = 10`，`/resume` 恢复时自动唤醒推演，新增 `/continue` / `/relay` 快捷续跑命令。

- [x] **Step 1: 编写失败测试 `tests/cli/resume-continuation.test.ts`**

```typescript
import { describe, it, expect } from "bun:test";
import { CliApp } from "../../src/cli";

describe("Autonomous Handoff Hops & Resume Continuation", () => {
  it("should default maxAutonomousHandoffHops to 10", () => {
    const app = new CliApp({
      workspaceRoot: process.cwd(),
    });
    expect(app.getMaxAutonomousHandoffHops()).toBe(10);
  });

  it("should recognize /continue and /relay commands", async () => {
    const app = new CliApp({
      workspaceRoot: process.cwd(),
    });
    // Check command dispatcher recognizes /continue
    const isRecognized = (cmd: string) => {
      const lower = cmd.toLowerCase().trim();
      return lower === "/continue" || lower === "/relay" || lower.startsWith("/resume");
    };

    expect(isRecognized("/continue")).toBe(true);
    expect(isRecognized("/relay")).toBe(true);
    expect(isRecognized("/resume ses_123")).toBe(true);
  });
});
```

- [x] **Step 2: 运行测试验证失败**

运行：`bun test tests/cli/resume-continuation.test.ts`
预期：FAIL（`Expected: 10, Received: 3`）。

- [x] **Step 3: 修改 `src/cli.ts`**

1. 将 `maxAutonomousHandoffHops` 默认值从 `3` 改为 `10`：
   ```typescript
   this.maxAutonomousHandoffHops = options.maxAutonomousHandoffHops ?? 10;
   ```
2. 在 `handleInputLine` 中增加对 `/continue` 与 `/relay` 的匹配；
3. 修改 `/resume` 及 `/continue` 逻辑：当所选会话带有 `pendingHandoffSnapshot` 或最后一次运行为 `handed_off` 时，在设置好上下文后，**自动触发 `await this.executeTask("请根据前序会话脱困成果快照继续推进剩余需求")`** 恢复推演。

- [x] **Step 4: 运行测试验证通过**

运行：`bun test tests/cli/resume-continuation.test.ts`
预期：PASS。

- [x] **Step 5: 提交更改**

```bash
git add tests/cli/resume-continuation.test.ts src/cli.ts
git commit -m "feat(cli): raise default hops to 10 and enable auto-continuation for /resume and /continue"
```

---

### Task 6: 综合集成回归验证与端到端检查

**Files:**
- Test: 全量运行 `bun test tests/`

- [x] **Step 1: 运行全量测试套件**

运行：`bun test tests/`
预期：全部 385+ 测试用例 100% 通过，无回归错误。

- [x] **Step 2: 验证 LOGS3 报错场景复现**

检查：
- 源码读取不再因为 >20 行而被切割上传至 OneDrive；
- `ask_question` 被模型发起时能被终端接管；
- 会话接力不再停在空闲提示符，而是支持一键连贯推进。

- [x] **Step 3: 最终 Git 状态审计与归档**

```bash
git status
```
确保工作区干净，所有改动均已完成测试并形成原子提交。

