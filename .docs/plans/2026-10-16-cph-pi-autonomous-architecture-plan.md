# CPH-PI 自主长任务规划与全量无损架构实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 基于 `CPH-PI-SPEC-20261016-AUTONOMOUS-ARCH` 规范，彻底解除阅读硬编码截断、打通 Turn 1 原生附件接力、重塑主控纯统帅认知与物理任务清单（Plan Checklist）收敛门禁，使 CPH-PI 具备对标 ARTEX 的超长任务自闭环能力。

**Architecture:** 
1. **传输与工具层**：删除 `tool-bridge.ts` 中的 `MAX_READ_SLICE_LINES = 100`，常规文件全量直通并设立 1MB/二进制物理安全熔断，自然激活 `orchestrator.ts` 已就绪的 `SubstrateUploader` 云端附件机制；
2. **调度与生命周期层**：`blackbox-compactor.ts` 物理固化 `rootUserPrompt` 永久置顶不失忆；`orchestrator.ts` 扩充 `initialAnnotations` 接口并净化仲裁提示词；`cli.ts` 换代接力改走附件挂载 + 200 字指纹头；
3. **认知与提示词层**：主控 `cph-main` 纯统帅化（写权限限定在工作区文档/计划/报告，严禁修改业务代码），必须在工作区立桩 `plan.md` 并将其作为收敛唯一真实源；Skill 在主控层内化，子代理零 Skill 认知且单任务限定为单一核心文件；
4. **UI 渲染层**：`tui-renderer.ts` 增加交付物展板渲染，终局报告直观回显终端。

**Tech Stack:** TypeScript, Bun Test, Microsoft Sydney / ChatHub WebSocket Protocol, Microsoft Graph API (SubstrateUploader), Pi TUI Engine (`@earendil-works/pi-tui`).

## Global Constraints

- **AI 严禁在工作区根目录写任何文件**：所有代码、文档、计划必须落盘在二级子目录（`CPH-PI/`）内；
- **Harness 纯粹与中立原则**：严禁在 Harness 中给模型打特化正则补丁或“替模型擦屁股”；
- **操作者视角与黑盒抽象**：提示词中严禁泄露 WebSocket、底层 token 轮换等管道运维细节；
- **状态持久化与工作内存正交分层**：长篇交接文档走原生附件（LocalFile）挂载，Prompt 只留极简物理指纹。

---

## 冲击面扫描 (Impact Surface Scan)

| 制品类型 | 生产方 (Upstream) | 消费方 (Downstream) | 冲击面与破裂防御 |
|---|---|---|---|
| 函数/接口 | `OrchestratorRunOptions` 新增 `initialAnnotations` | `cli.ts` 调用 `orchestrator.run()` | 属于可选参数 `initialAnnotations?: AttachmentAnnotation[]`，100% 向后兼容 |
| 函数/接口 | `tool-bridge.ts` 移除 `MAX_READ_SLICE_LINES` 限制 | `orchestrator.ts` 大文件附件上传判断 | `rawContent` 真实反映全量行数，自然激活 `lineCount > 200` 的 OneDrive 自动上传 |
| 数据/存储 | `blackbox-compactor.ts` 增加 `rootUserPrompt` | `orchestrator.ts` 仲裁者会话 & 灾备交接 | 增加第 0 节，不破坏既有 Section 1~4 的 Markdown 解析契约 |
| 共享常量 | `MAX_READ_SLICE_LINES` 移除 | `tests/protocol/tool-bridge.test.ts` | 原测试断言了 100 行截断，需重构为断言全量读取与 1MB 熔断保护 |
| 系统提示词 | `cph-main-agent-prompt.txt` 权限收敛 | Copilot 云端推理决策 | 限制主控写业务源码，引导派发子代理与更新 `plan.md` |
| 工作区技能 | `subagent/SKILL.md` 废除轮数玄学 | `cph-main` 的 `invoke_subagent` 拆解逻辑 | 明确核心文件 ≤1 个且单关注点，禁止向子代理传递 Skill 名称 |

---

## Agent-Friendly Slicing 架构切片原则

本计划按**独立文件与高内聚模块解耦**（优先级 2 ⭐），每个任务均自包含独立单测，可安全串行或按阶段并发执行：
- **Task 1**: `src/protocol/tool-bridge.ts` + `tests/protocol/tool-bridge.test.ts` (工具阅读层)
- **Task 2**: `src/agent/blackbox-compactor.ts` + `tests/agent/blackbox-compactor.test.ts` (黑匣子不失忆)
- **Task 3**: `src/agent/orchestrator.ts` + `tests/agent/orchestrator.test.ts` (Turn 1 附件插座与仲裁净化)
- **Task 4**: `src/cli.ts` + `tests/cli/autonomous-handoff.test.ts` (CLI 附件接力与指纹头)
- **Task 5**: `src/ui/tui-renderer.ts` + `tests/ui/tui-renderer.test.ts` (TUI 交付物展板卡片)
- **Task 6**: `cph-main-agent-prompt.txt`, `cph-researcher-agent-prompt.txt`, `cph-coder-agent-prompt.txt` (系统提示词认知重构)
- **Task 7**: `skills/subagent/SKILL.md`, `skills/handoff/SKILL.md` (工作区技能重构)
- **Task 8**: 全量回归测试与端到端门禁验证 (E2E Verification)

---

## 详细实施任务清单

### Task 1: ToolBridge 全量无损阅读与 1MB 物理安全熔断

**Files:**
- Modify: `CPH-PI/src/protocol/tool-bridge.ts`
- Test: `CPH-PI/tests/protocol/tool-bridge.test.ts`

**Interfaces:**
- Consumes: Pi native `read` tool, `fs.statSync`
- Produces: `mapAction` for `read_file` without line clamping; `executeAction` guards files > 1MB with a clear refusal message.

- [x] **Step 1: 编写失败测试（断言全量读取与 1MB 熔断）**
- [x] **Step 2: 运行测试验证失败**
- [x] **Step 3: 实施 ToolBridge 改造**
- [x] **Step 4: 运行测试验证全部通过**

运行：`bun test tests/protocol/tool-bridge.test.ts`
预期：PASS（34 个测试全部通过）。

---

### Task 2: BlackboxCompactor 根目标永久置顶穿透

**Files:**
- Modify: `CPH-PI/src/agent/blackbox-compactor.ts`
- Test: `CPH-PI/tests/agent/blackbox-compactor.test.ts`

**Interfaces:**
- Consumes: `history: TurnRecord[]`, `options.rootUserPrompt?: string`
- Produces: `extractDisasterBlackbox` Markdown with Section 0: `## 0. 战役终极北极星 (Root User Goal)` containing `rootUserPrompt` or `history[0].userInput`.

- [x] **Step 1: 编写失败测试**
- [x] **Step 2: 运行测试验证失败**
- [x] **Step 3: 实施 BlackboxCompactor 改造**
- [x] **Step 4: 运行测试验证通过**

运行：`bun test tests/agent/blackbox-compactor.test.ts`
预期：PASS（13 个测试全部通过）。

---

### Task 3: Orchestrator 初始附件插座打通与仲裁提示词清洗

**Files:**
- Modify: `CPH-PI/src/agent/orchestrator.ts`
- Test: `CPH-PI/tests/agent/orchestrator.test.ts`

**Interfaces:**
- Consumes: `OrchestratorRunOptions.initialAnnotations?: AttachmentAnnotation[]`
- Produces: Turn 1 `sendMessage` carries `initialAnnotations`; `arbitratorPrompt` transmits `rootUserPrompt` without defeatist phrases.

- [x] **Step 1: 编写失败测试**

编辑 `CPH-PI/tests/agent/orchestrator.test.ts`，增加 Turn 1 附件装填与仲裁者净化断言：
```typescript
test("should pass initialAnnotations into client.sendMessage on Turn 1", async () => {
  const dummyAnnotation: any = {
    id: "att-123",
    text: "handoff.md",
    url: "https://example.com/handoff.md",
    messageAnnotationType: "LocalFile",
  };
  let capturedAnnotations: any = null;
  const mockClient: any = {
    sendMessage: async (msg: any) => {
      capturedAnnotations = msg.annotations;
      return { text: "FINAL_ANSWER: Done", reasoning: "" };
    },
  };
  const orchestrator = new CopilotOrchestrator({
    chatClient: mockClient,
  });
  await orchestrator.run({
    task: "Start task",
    initialAnnotations: [dummyAnnotation],
  });
  expect(capturedAnnotations).toEqual([dummyAnnotation]);
});
```

- [x] **Step 2: 运行测试验证失败**

运行：`bun test tests/agent/orchestrator.test.ts`
预期：FAIL（`initialAnnotations` 未被定义或传递）。

- [x] **Step 3: 实施 Orchestrator 改造**

修改 `CPH-PI/src/agent/orchestrator.ts`：
1. `OrchestratorRunOptions` 新增 `initialAnnotations?: AttachmentAnnotation[]` 与 `rootUserPrompt?: string`；
2. 在 `orchestrator.run()` 第 431 行，改用传入的初始附件初始化：
   ```typescript
   let currentAnnotations: AttachmentAnnotation[] = options.initialAnnotations
     ? [...options.initialAnnotations]
     : [];
   ```
3. 在 `disasterRecoveryRelay()` 中：
   - 提取并传递 `rootUserPrompt` 给 `BlackboxCompactor.extractDisasterBlackbox`；
   - 清洗 `arbitratorPrompt`：彻底删除一切“若仅为交接核验即可交付”的消极表述；强调仲裁者必须梳理未完成切片并设为最高优先级待办。

- [x] **Step 4: 运行测试验证通过**

运行：`bun test tests/agent/orchestrator.test.ts`
预期：PASS。

---

### Task 4: CLI 跨会话换代附件接力与极简指纹头

**Files:**
- Modify: `CPH-PI/src/cli.ts`
- Test: `CPH-PI/tests/cli/autonomous-handoff.test.ts`

**Interfaces:**
- Consumes: `SubstrateUploader.uploadDocumentToOneDrive`, `orchestrator.run({ initialAnnotations })`
- Produces: When hopping sessions, `handoff.md` is uploaded and mounted as attachment; `currentTaskPrompt` is condensed to high-density fingerprint (~200 words).

- [x] **Step 1: 编写失败测试**
- [x] **Step 2: 运行测试验证失败**
- [x] **Step 3: 实施 CLI 接力管道改造**
- [x] **Step 4: 运行测试验证通过**

运行：`bun test tests/cli/autonomous-handoff.test.ts`
预期：PASS。

---

### Task 5: TUI 终局交付物展板渲染 (Artifact Card)

**Files:**
- Modify: `CPH-PI/src/ui/tui-renderer.ts`
- Test: `CPH-PI/tests/ui/tui-renderer.test.ts`

**Interfaces:**
- Consumes: `finalAnswer: string`, local file existence check
- Produces: `renderFinalAnswer` extracts any referenced `.md` report paths, parses stats (bytes, lines), and draws a stylish artifact card in the terminal.

- [x] **Step 1: 编写失败测试**
- [x] **Step 2: 运行测试验证失败**
- [x] **Step 3: 实施 TUI 渲染器增强**
- [x] **Step 4: 运行测试验证通过**

运行：`bun test tests/ui/tui-renderer.test.ts`
预期：PASS。

---

### Task 6: 系统提示词体系重塑（统帅纯粹化与路径限定）

**Files:**
- Modify: `CPH-PI/cph-main-agent-prompt.txt`
- Modify: `CPH-PI/cph-researcher-agent-prompt.txt`
- Modify: `CPH-PI/cph-coder-agent-prompt.txt`
- Test: `CPH-PI/tests/skills/tri-agent-prompts.test.ts`

**Interfaces:**
- Consumes: `AGENTS.md` 治理准则
- Produces: `cph-main` 纯统帅提示词（严禁修改业务源码，仅限维护 plan/report；Skill 内化；物理清单收敛门禁）；`cph-researcher` 与 `cph-coder` 纯工人提示词（零 Skill 认知，单文件聚焦）。

- [x] **Step 1: 编写/更新提示词契约测试**

在 `CPH-PI/tests/skills/tri-agent-prompts.test.ts` 中，增加断言：
- `cph-main` 提示词必须明确禁止直接修改业务代码，强调创建与更新 `plan.md`；
- `cph-main` 提示词必须声明 Skill 内化契约（派发给子代理时不提 Skill 名称）；
- `cph-main` 必须包含 Plan Checklist 100% 收敛门禁（未勾选严禁 FINAL_ANSWER）。

- [x] **Step 2: 运行测试验证失败**

运行：`bun test tests/skills/tri-agent-prompts.test.ts`
预期：FAIL。

- [x] **Step 3: 重构系统提示词文件**

1. 修改 `CPH-PI/cph-main-agent-prompt.txt`：
   - 明确角色为“纯粹的规划与调度中枢 (Master Coordinator & Plan Agent)”；
   - 规定 `write_file` / `patch_file` **仅限于工作区计划文件（`plan.md`）、架构账本与汇总报告**；严禁亲自动手修改业务代码；
   - 规定主控必须在 Turn 1~2 建立物理任务计划清单；
   - 规定主控必须将 Skill 流程内化为具体物理动作，派发工单中**严禁包含任何 Skill 名称**；
   - 规定终局收敛门禁：只有物理清单全部 `[x]` 或标记为 `[!] 阻断`，才能输出 `FINAL_ANSWER`。
2. 修改 `CPH-PI/cph-researcher-agent-prompt.txt` & `cph-coder-agent-prompt.txt`：
   - 移除任何摸索环境、寻找技能的手册说明；
   - 强化单文件专注与直接执行指令。

- [x] **Step 4: 运行测试验证通过**

运行：`bun test tests/skills/tri-agent-prompts.test.ts`
预期：PASS。

---

### Task 7: 工作区专属技能体系重构 (`subagent` & `handoff`)

**Files:**
- Modify: `CPH-PI/skills/subagent/SKILL.md`
- Modify: `CPH-PI/skills/handoff/SKILL.md`
- Test: `CPH-PI/tests/skills/tri-agent-prompts.test.ts`

**Interfaces:**
- Consumes: Task 6 prompt updates
- Produces: `subagent` skill replacing turn counts with 3 physical metrics; `handoff` skill binding to `plan.md` and two-tier actionable next steps.

- [x] **Step 1: 编写失败测试**
- [x] **Step 2: 运行测试验证失败**
- [x] **Step 3: 实施专属技能文件重构**
- [x] **Step 4: 运行测试验证通过**

运行：`bun test tests/skills/tri-agent-prompts.test.ts`
预期：PASS。

---

### Task 8: 全量回归测试与端到端门禁验证 (E2E Verification)

**Files:**
- Test: All test files under `CPH-PI/tests/`

- [x] **Step 1: 运行全量单元测试与集成测试**
- [x] **Step 2: 执行静态类型与打包健康检查**
- [x] **Step 3: 提交 Git 变更**

---

## 计划执行交接 (Execution Handoff)

Plan complete and saved to `CPH-PI/.docs/plans/2026-10-16-cph-pi-autonomous-architecture-plan.md`. Two execution options:

1. **Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration
2. **Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**

