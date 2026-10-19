# 全工作区源码快照增压、大文件分块上传与因果调度架构实施计划 (Workspace Snapshot Supercharger, Resumable Upload & Causality-Aware Pipeline Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 突破 4MB 简易上传硬限，构建基于 Microsoft Graph `createUploadSession` 的断点分块上传引擎与全量无损源码快照通道；推倒重塑 Tri-Agent 提示词与 `subagent`/`handoff` 专属技能体系，建立首轮全局洞察立桩与因果时序把控的高吞吐调度管线。

**Architecture:** 
1. 传输层实现双通道自适应路由（<4MB 简易直传，≥4MB 以 8,192,000 字节分块 PUT 传输至专属会话）；
2. 本地 Harness 首轮将源码安全打平为单快照文本，经分块上传直传至 OneDrive，在 Turn 1 无损挂载；
3. 彻底废除 Scout 斥候探查，Main Agent 首轮立桩高精度 `plan.md`，基于因果时序与阶段屏障并发调派 Researcher 深度分析锤与 Coder 手术刀实施专家；
4. 全面重构 `skills/subagent` 与 `skills/handoff`，固化防盲目并发与后继防失忆契约。

**Tech Stack:** TypeScript, Bun, Node.js `fs` & `crypto`, Microsoft Graph Upload Session API, SharePoint Online, Office Substrate, Copilot Agent Protocol.

## Global Constraints

- 严禁在工作区根目录写入任何非受控文件，所有产物和测试均在子目录内；
- 遵循 Harness 纯粹与中立原则，不给模型打侵入式特化补丁；
- 全面摒弃负面禁止词（“严禁”、“切勿”、“不要”），系统提示词与技能指引一律采用正向建设性引导；
- 废弃单文件人为截断，白名单源码 100% 原始完整打入快照，仅设 100MB 宿主物理防爆安全线；
- 严格遵循因果时序屏障：先研后改、主会话综合决策、同阶段正交并发、跨阶段屏障等待，杜绝盲目并发。

---

### Task 0: 大文件断点分块上传引擎 (`Resumable Upload Engine`) 与单元测试

**Files:**
- Modify: `src/transport/substrate-uploader.ts`
- Create: `tests/transport/resumable-uploader.test.ts`

**Interfaces:**
- Produces: `SubstrateUploader.uploadDocumentToOneDrive(graphAccessToken: string, content: string | Buffer, fileName: string, customBaseUrl?: string): Promise<UploadDocumentResult>`
  - 自动识别体积：`< 4 * 1024 * 1024` 走简易 PUT；`>= 4 * 1024 * 1024` 走 `createUploadSession` + `8,192,000` 字节分块上传流水线。

- [ ] **Step 1: 编写分块上传引擎的单元测试 (Mock 微软 Graph 与 SharePoint)**

```typescript
// tests/transport/resumable-uploader.test.ts
import { describe, it, expect, mock } from "bun:test";
import { SubstrateUploader } from "../../src/transport/substrate-uploader.ts";

describe("SubstrateUploader Resumable Chunked Upload", () => {
  it("should route files >= 4MB to createUploadSession and send 8192000-byte chunks", async () => {
    const chunkRequests: { range: string; length: string }[] = [];
    let sessionCreated = false;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = url.toString();

      // 1. Mock createUploadSession
      if (urlStr.includes("createUploadSession")) {
        sessionCreated = true;
        return new Response(
          JSON.stringify({
            uploadUrl: "https://mock.sharepoint.com/uploadSession?guid=123",
            expirationDateTime: new Date(Date.now() + 3600000).toISOString(),
            nextExpectedRanges: ["0-"],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      // 2. Mock chunk PUT
      if (urlStr.includes("uploadSession?guid=123")) {
        const headers = (init?.headers as Record<string, string>) || {};
        chunkRequests.push({
          range: headers["Content-Range"] || "",
          length: headers["Content-Length"] || "",
        });

        const isLast = (headers["Content-Range"] || "").includes("10485759/10485760");
        if (isLast) {
          return new Response(
            JSON.stringify({
              id: "item_999",
              webUrl: "https://mock.sharepoint.com/test.txt",
              name: "large-file.txt",
              parentReference: { driveId: "drive_888" },
            }),
            { status: 201, headers: { "Content-Type": "application/json" } }
          );
        }
        return new Response(JSON.stringify({ nextExpectedRanges: ["8192000-"] }), {
          status: 202,
        });
      }

      // 3. Mock resolveSpoBase64
      if (urlStr.includes("/drive/list")) {
        return new Response(
          JSON.stringify({
            id: "list_1",
            parentReference: { siteId: "domain,site_2,web_3" },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      return originalFetch(url, init);
    }) as any;

    try {
      // 10MB test buffer (10 * 1024 * 1024 = 10,485,760 bytes)
      const buffer = Buffer.alloc(10 * 1024 * 1024, "a");
      const result = await SubstrateUploader.uploadDocumentToOneDrive(
        "mock_token",
        buffer,
        "large-file.txt"
      );

      expect(sessionCreated).toBe(true);
      expect(chunkRequests.length).toBe(2);
      expect(chunkRequests[0].range).toBe("bytes 0-8191999/10485760");
      expect(chunkRequests[1].range).toBe("bytes 8192000-10485759/10485760");
      expect(result.driveItemId).toBe("item_999");
      expect(result.annotation.id).toContain("item_999");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

运行: `bun test tests/transport/resumable-uploader.test.ts`  
预期: FAIL with simple PUT failure or session not created

- [ ] **Step 3: 在 `SubstrateUploader` 中实现分块断点上传流水线**

在 `src/transport/substrate-uploader.ts` 中实现：
```typescript
  public static readonly CHUNK_SIZE = 8192000; // 8,192,000 bytes (320 KiB aligned)
  public static readonly RESUMABLE_THRESHOLD = 4 * 1024 * 1024; // 4MB

  public static async uploadDocumentToOneDrive(
    graphAccessToken: string,
    content: string | Buffer,
    fileName: string,
    customBaseUrl?: string
  ): Promise<UploadDocumentResult> {
    const rawBuffer = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
    const totalBytes = rawBuffer.length;

    if (totalBytes < this.RESUMABLE_THRESHOLD) {
      return this.uploadSmallDocument(graphAccessToken, rawBuffer, fileName, customBaseUrl);
    }
    return this.uploadLargeDocumentChunked(graphAccessToken, rawBuffer, fileName, customBaseUrl);
  }
```
实现 `uploadLargeDocumentChunked`：
1. `POST ...:/createUploadSession`
2. 循环分块 PUT，携带 `Content-Range: bytes ${start}-${end}/${totalBytes}`
3. 校验 `202 Accepted` 与 `201 Created`
4. 构造标准 `AttachmentAnnotation` 并返回。

- [ ] **Step 4: 运行测试验证通过**

运行: `bun test tests/transport/resumable-uploader.test.ts`  
预期: PASS

- [ ] **Step 5: 提交代码**

```bash
git add src/transport/substrate-uploader.ts tests/transport/resumable-uploader.test.ts
git commit -m "feat(transport): implement resumable chunked upload engine for large files via Graph API"
```

---

### Task 1: 物理快照生成引擎 (`WorkspaceSnapshotGenerator`) 与单元测试

**Files:**
- Create: `src/workspace/snapshot-generator.ts`
- Test: `tests/workspace/snapshot-generator.test.ts`

**Interfaces:**
- Produces: `WorkspaceSnapshotGenerator.generate(workspaceRoot: string, options?: SnapshotOptions): Promise<SnapshotResult>`

- [ ] **Step 1: 编写单元测试**

```typescript
// tests/workspace/snapshot-generator.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { WorkspaceSnapshotGenerator } from "../../src/workspace/snapshot-generator.ts";

describe("WorkspaceSnapshotGenerator", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), "cph-snap-test-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6));
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it("should generate structured snapshot with structure header and complete file contents", async () => {
    const srcDir = path.join(tmpDir, "src");
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, "index.ts"), 'console.log("hello world");', "utf8");
    fs.writeFileSync(path.join(tmpDir, "README.md"), "# Test Project", "utf8");

    const result = await WorkspaceSnapshotGenerator.generate(tmpDir);

    expect(fs.existsSync(result.snapshotPath)).toBe(true);
    expect(result.totalFiles).toBe(2);
    expect(result.sha256).toBeDefined();

    const content = fs.readFileSync(result.snapshotPath, "utf8");
    expect(content).toContain("======================================");
    expect(content).toContain("WORKSPACE STRUCTURE (REL-PATHS)");
    expect(content).toContain("src/index.ts");
    expect(content).toContain("README.md");
    expect(content).toContain("FILE: src/index.ts (Lines: 1)");
    expect(content).toContain('console.log("hello world");');
    expect(content).toContain("# Test Project");
  });

  it("should strictly exclude node_modules, .git, .cph, and native binaries like .exe, .dll", async () => {
    fs.mkdirSync(path.join(tmpDir, "node_modules", "pkg"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "node_modules", "pkg", "index.js"), "module.exports = {};");

    fs.mkdirSync(path.join(tmpDir, "bin"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "bin", "app.exe"), "MZ BINARY MOCK");
    fs.writeFileSync(path.join(tmpDir, "bin", "app.dll"), "PE BINARY MOCK");

    fs.writeFileSync(path.join(tmpDir, "valid.ps1"), "Write-Host 'ok'");

    const result = await WorkspaceSnapshotGenerator.generate(tmpDir);

    expect(result.totalFiles).toBe(1);
    const content = fs.readFileSync(result.snapshotPath, "utf8");
    expect(content).toContain("valid.ps1");
    expect(content).not.toContain("node_modules");
    expect(content).not.toContain("app.exe");
    expect(content).not.toContain("app.dll");
  });

  it("should preserve 100% full file content without artificial line or size truncation", async () => {
    const lines = Array.from({ length: 600 }, (_, i) => `Line ${i + 1}: public void Method${i}() {}`);
    const longContent = lines.join("\n");
    fs.writeFileSync(path.join(tmpDir, "LargeFile.cs"), longContent, "utf8");

    const result = await WorkspaceSnapshotGenerator.generate(tmpDir);
    const content = fs.readFileSync(result.snapshotPath, "utf8");

    expect(content).toContain("Line 1: public void Method0() {}");
    expect(content).toContain("Line 300: public void Method299() {}");
    expect(content).toContain("Line 600: public void Method599() {}");
    expect(content).not.toContain("省略");
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

运行: `bun test tests/workspace/snapshot-generator.test.ts`  
预期: FAIL with module not found

- [ ] **Step 3: 编写核心实现**

创建 `src/workspace/snapshot-generator.ts`，实现文本目录树与源码打平拼接、黑白名单过滤以及 100MB 安全线保护。

- [ ] **Step 4: 运行测试验证通过**

运行: `bun test tests/workspace/snapshot-generator.test.ts`  
预期: PASS

- [ ] **Step 5: 提交代码**

```bash
git add src/workspace/snapshot-generator.ts tests/workspace/snapshot-generator.test.ts
git commit -m "feat(workspace): implement WorkspaceSnapshotGenerator with 100% source retention and binary pruning"
```

---

### Task 2: PromptBuilder 首轮快照感知引导与行动协议升级

**Files:**
- Modify: `src/protocol/prompt-builder.ts`
- Modify: `tests/protocol/prompt-builder.test.ts`

**Interfaces:**
- Consumes: `SnapshotResult`
- Produces: 升级 `PromptBuilder.buildDirectAgentPrompt` 与 `buildTurn1Prompt`，支持可选 `snapshotMeta?: { fileName: string; totalFiles: number }`，生成全景快照感知指令块。

- [ ] **Step 1: 编写单元测试**

在 `tests/protocol/prompt-builder.test.ts` 增加针对快照感知指令与正向行动指引的断言：
```typescript
it("should inject snapshot perception and constructive action guidance when snapshotMeta provided", () => {
  const prompt = PromptBuilder.buildDirectAgentPrompt(
    "E:/my-repo",
    "审查与修复系统缺陷",
    undefined,
    "- src/\n- package.json",
    4,
    { fileName: "workspace-snapshot-abc1234.txt", totalFiles: 28 }
  );

  expect(prompt).toContain("【全工作区无损源码快照已挂载送达】");
  expect(prompt).toContain("workspace-snapshot-abc1234.txt");
  expect(prompt).toContain("共 28 个文件");
  expect(prompt).toContain("直接基于附件中的完整代码与结构拓扑");
  expect(prompt).toContain("立桩精准的 plan.md 物理清单");
  expect(prompt).toContain("识别任务依赖拓扑");
  expect(prompt).not.toContain("斥候");
  expect(prompt).not.toContain("Scout");
  expect(prompt).not.toContain("无需");
});
```

- [ ] **Step 2: 运行测试验证失败**

运行: `bun test tests/protocol/prompt-builder.test.ts`  
预期: FAIL

- [ ] **Step 3: 修改 PromptBuilder**

在 `src/protocol/prompt-builder.ts` 增加 `SnapshotMeta` 定义并在 `buildDirectAgentPrompt` 与 `buildTurn1Prompt` 中追加纯正向快照感知块：
```typescript
if (snapshotMeta) {
  prompt += `\n\n【全工作区无损源码快照已挂载送达】
✔ 工作区全量源码（共 ${snapshotMeta.totalFiles} 个文件）与相对路径拓扑已封装为附件【${snapshotMeta.fileName}】挂载至本会话。
✔ 云端文档引擎已对该快照建立全量索引，你天然具备全工作区完整代码视野。
✔ 【高效攻坚行动指引】：
1. 直接基于附件中的完整代码与结构拓扑，在第一轮立桩精准的 plan.md 物理清单（格式为 - [ ] 步骤描述，精准定位至目标文件、核心关注点与调用关系）；
2. 识别任务依赖拓扑，按需分批调派专项子代理集群协同攻坚，或直接推进外科手术级局部修改！`;
}
```

- [ ] **Step 4: 运行测试验证通过**

运行: `bun test tests/protocol/prompt-builder.test.ts`  
预期: PASS

- [ ] **Step 5: 提交代码**

```bash
git add src/protocol/prompt-builder.ts tests/protocol/prompt-builder.test.ts
git commit -m "feat(protocol): add positive snapshot grounding and DAG action guidance to PromptBuilder"
```

---

### Task 3: Orchestrator 集成快照生成、首轮直传与后继代次知行合一挂载

**Files:**
- Modify: `src/agent/orchestrator.ts`
- Create: `tests/agent/orchestrator-snapshot-mounting.test.ts`

- [ ] **Step 1: 编写测试验证 Orchestrator 在首轮及后继代次均挂载快照**

在 `tests/agent/orchestrator-snapshot-mounting.test.ts` 验证：
1. `enableWorkspaceSnapshot` 为 true 时自动准备快照制品；
2. 验证在跨会话代际唤醒后继主会话时，`currentAnnotations` 依然完好包含 `snapshotAnnotation`，保障知行合一。

- [ ] **Step 2: 运行测试验证失败**

运行: `bun test tests/agent/orchestrator-snapshot-mounting.test.ts`  
预期: FAIL

- [ ] **Step 3: 在 Orchestrator 中实现 `prepareWorkspaceSnapshot` 与全生命周期自动挂载**

在 `OrchestratorOptions` 增加 `enableWorkspaceSnapshot?: boolean;`（默认为 true）。  
保存 `this.snapshotAnnotation` 属性；  
在 `run()` 开始处生成并上传快照，挂载进 `currentAnnotations`；  
在 801~840 行代际唤醒逻辑中，后继会话首轮消息构造时重新将 `this.snapshotAnnotation` 注入 `currentAnnotations`，确保后继主会话知行合一！

- [ ] **Step 4: 运行测试验证通过**

运行: `bun test tests/agent/orchestrator-snapshot-mounting.test.ts`  
预期: PASS

- [ ] **Step 5: 提交代码**

```bash
git add src/agent/orchestrator.ts tests/agent/orchestrator-snapshot-mounting.test.ts
git commit -m "feat(orchestrator): integrate automated snapshot mounting with successor grounding consistency"
```

---

### Task 4: Tri-Agent 系统提示词推倒重塑与通用 DAG 因果感知原则

**Files:**
- Modify: `cph-main-agent-prompt.txt`
- Modify: `cph-researcher-agent-prompt.txt`
- Modify: `cph-coder-agent-prompt.txt`
- Modify: `tests/skills/tri-agent-prompts.test.ts`
- Modify: `tests/protocol/prompt-builder-governance.test.ts`

- [ ] **Step 1: 编写针对新规范的测试**

在 `tests/skills/tri-agent-prompts.test.ts` 中校验：
1. `cph-main-agent-prompt.txt` 彻底移除了“斥候”、“Scout”等历史包袱词汇；
2. `cph-main-agent-prompt.txt` 明确通用 DAG 因果感知原则（契约先于实现、底座先于应用、研判先于重构、实施先于集成）；
3. 明确跨阶段屏障与同阶段正交并发调度；
4. `cph-researcher-agent-prompt.txt` 明确单点深度分析锤定位；
5. `cph-coder-agent-prompt.txt` 明确外科手术实施与自测闭环定位；
6. 所有提示词不含负面禁止词（“严禁”、“切勿”、“不要”）。

- [ ] **Step 2: 运行测试验证失败**

运行: `bun test tests/skills/tri-agent-prompts.test.ts`  
预期: FAIL

- [ ] **Step 3: 全面重塑三个系统提示词**

1. 重写 `cph-main-agent-prompt.txt`：确立上帝视角首轮立桩、纯粹统帅职责、通用 DAG 因果感知与阶段调度（契约/底座/研判/实施）；
2. 重写 `cph-researcher-agent-prompt.txt`：聚焦热核代码审查、漏洞分析、状态机竞争条件深潜；
3. 重写 `cph-coder-agent-prompt.txt`：聚焦局部精准补丁（`edit`/`patch`）与自动化测试验证命令。

- [ ] **Step 4: 运行治理与提示词测试验证通过**

运行: `bun test tests/skills/tri-agent-prompts.test.ts tests/protocol/prompt-builder-governance.test.ts`  
预期: PASS

- [ ] **Step 5: 提交代码**

```bash
git add cph-main-agent-prompt.txt cph-researcher-agent-prompt.txt cph-coder-agent-prompt.txt tests/skills/tri-agent-prompts.test.ts tests/protocol/prompt-builder-governance.test.ts
git commit -m "feat(prompts): overhaul Tri-Agent system prompts for snapshot supercharging and DAG causality dispatch"
```

---

### Task 5: 工作区专属 Skills (`subagent` & `handoff`) 重构与对齐

**Files:**
- Modify: `skills/subagent/SKILL.md`
- Modify: `skills/handoff/SKILL.md`
- Create: `tests/skills/subagent-skill-governance.test.ts`

- [ ] **Step 1: 编写针对 Skills 重构的治理测试**

```typescript
// tests/skills/subagent-skill-governance.test.ts
import { describe, it, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";

describe("Subagent & Handoff Skills Governance", () => {
  it("should not contain scout protocol in subagent skill and contain DAG causality principles", () => {
    const subagentPath = path.join(__dirname, "../../skills/subagent/SKILL.md");
    const content = fs.readFileSync(subagentPath, "utf8");
    expect(content).not.toContain("isScout");
    expect(content).not.toContain("两阶段斥候领航协议");
    expect(content).toContain("通用因果时序与依赖感知");
    expect(content).toContain("正交并发");
  });

  it("should contain successor anti-memory-drift contract in handoff skill", () => {
    const handoffPath = path.join(__dirname, "../../skills/handoff/SKILL.md");
    const content = fs.readFileSync(handoffPath, "utf8");
    expect(content).toContain("天然继承工作区已有的 plan.md");
    expect(content).toContain("无需重新向用户确认初始工程目标");
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

运行: `bun test tests/skills/subagent-skill-governance.test.ts`  
预期: FAIL

- [ ] **Step 3: 重构 `skills/subagent/SKILL.md` 与微调 `skills/handoff/SKILL.md`**

1. 重构 `skills/subagent/SKILL.md`：
   - 彻底删除所有“斥候角色 (isScout: true)”条目；
   - 重塑 Gate 5 为“通用因果依赖与阶段屏障门禁”：涵盖契约、底座、研判、实施等多维上下游关系；
   - 规范 Researcher 单点深度攻坚工单模板与 Coder 外科手术级实施模板。
2. 微调 `skills/handoff/SKILL.md`：
   - 明确接力后继主控正向认知契约，天然继承 `plan.md` 与全景快照，杜绝代际失忆；
   - 纯粹面向深度分析与代码实施交接。

- [ ] **Step 4: 运行治理测试验证通过**

运行: `bun test tests/skills/subagent-skill-governance.test.ts`  
预期: PASS

- [ ] **Step 5: 提交代码**

```bash
git add skills/subagent/SKILL.md skills/handoff/SKILL.md tests/skills/subagent-skill-governance.test.ts
git commit -m "feat(skills): overhaul subagent and handoff skills for DAG causality dispatch and anti-drift"
```

---

### Task 6: 全量回归测试、构建打包与实战验证

**Files:**
- Modify: `package/bin/cph-pi.js`
- Modify: `dist/copilot-agent-bundle.zip`

- [ ] **Step 1: 运行全量单元与集成测试**

运行: `bun test`  
预期: 全部 650+ 测试 100% PASS (0 fail)

- [ ] **Step 2: 重新打包分发包**

运行: `bun run package; bun run build:package`  
预期:
- `dist/copilot-agent-bundle.zip` 成功打包最新提示词与重构后的 `subagent`/`handoff` 技能
- `package/bin/cph-pi.js` 重新编译成功

- [ ] **Step 3: 最终 Git 提交**

```bash
git add package/ dist/
git commit -m "build: rebuild package binary and distribution bundle with snapshot supercharger and skills overhaul"
```
