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

在 `tests/protocol/prompt-builder.test.ts` 增加针对快照感知指令与零盲读引导的断言。

- [ ] **Step 2: 运行测试验证失败**

运行: `bun test tests/protocol/prompt-builder.test.ts`  
预期: FAIL

- [ ] **Step 3: 修改 PromptBuilder**

在 `src/protocol/prompt-builder.ts` 增加 `SnapshotMeta` 定义并在 `buildDirectAgentPrompt` 与 `buildTurn1Prompt` 中追加快照感知块。

- [ ] **Step 4: 运行测试验证通过**

运行: `bun test tests/protocol/prompt-builder.test.ts`  
预期: PASS

- [ ] **Step 5: 提交代码**

```bash
git add src/protocol/prompt-builder.ts tests/protocol/prompt-builder.test.ts
git commit -m "feat(protocol): add snapshot perception and no-scout action guidance to PromptBuilder"
```

---

### Task 3: Orchestrator 集成快照生成与首轮云端附件直传挂载

**Files:**
- Modify: `src/agent/orchestrator.ts`
- Create: `tests/agent/orchestrator-snapshot-mounting.test.ts`

- [ ] **Step 1: 编写测试验证 Orchestrator 在首轮挂载快照**

在 `tests/agent/orchestrator-snapshot-mounting.test.ts` 验证 `enableWorkspaceSnapshot` 为 true 时自动准备快照制品。

- [ ] **Step 2: 运行测试验证失败**

运行: `bun test tests/agent/orchestrator-snapshot-mounting.test.ts`  
预期: FAIL

- [ ] **Step 3: 在 Orchestrator 中实现 `prepareWorkspaceSnapshot` 与自动挂载逻辑**

在 `OrchestratorOptions` 增加 `enableWorkspaceSnapshot?: boolean;`（默认为 true）。  
在 `run()` 方法开始处，如果 `enableCloudAttachment` 为真且获取到了 `graphToken`，通过 `SubstrateUploader.uploadDocumentToOneDrive` 直传该快照并压入 `currentAnnotations`。

- [ ] **Step 4: 运行测试验证通过**

运行: `bun test tests/agent/orchestrator-snapshot-mounting.test.ts`  
预期: PASS

- [ ] **Step 5: 提交代码**

```bash
git add src/agent/orchestrator.ts tests/agent/orchestrator-snapshot-mounting.test.ts
git commit -m "feat(orchestrator): integrate automated snapshot generation and cloud mounting"
```

---

### Task 4: Tri-Agent 系统提示词推倒重塑与因果防盲目并发铁律

**Files:**
- Modify: `cph-main-agent-prompt.txt`
- Modify: `cph-researcher-agent-prompt.txt`
- Modify: `cph-coder-agent-prompt.txt`
- Modify: `tests/skills/tri-agent-prompts.test.ts`
- Modify: `tests/protocol/prompt-builder-governance.test.ts`

- [ ] **Step 1: 编写针对新规范的测试**

在 `tests/skills/tri-agent-prompts.test.ts` 中校验：
1. `cph-main-agent-prompt.txt` 移除了所有两阶段斥候（Scout）相关描述；
2. `cph-main-agent-prompt.txt` 明确因果时序：若 Coder 依赖 Researcher 成果，必须分阶段屏障派发或经主控决策综合，杜绝盲目并发；
3. `cph-researcher-agent-prompt.txt` 明确单点深度分析锤定位；
4. `cph-coder-agent-prompt.txt` 明确外科手术实施与自测闭环定位；
5. 所有提示词不含负面禁止词（“严禁”、“切勿”、“不要”）。

- [ ] **Step 2: 运行测试验证失败**

运行: `bun test tests/skills/tri-agent-prompts.test.ts`  
预期: FAIL

- [ ] **Step 3: 全面重塑三个系统提示词**

1. 重写 `cph-main-agent-prompt.txt`：确立上帝视角首轮立桩、纯粹统帅职责、因果时序控制（先研后改、跨 Stage 屏障、同 Stage 正交并发）；
2. 重写 `cph-researcher-agent-prompt.txt`：聚焦热核代码审查、漏洞分析、状态机竞争条件深潜；
3. 重写 `cph-coder-agent-prompt.txt`：聚焦局部精准补丁（`edit`/`patch`）与自动化测试验证命令。

- [ ] **Step 4: 运行治理与提示词测试验证通过**

运行: `bun test tests/skills/tri-agent-prompts.test.ts tests/protocol/prompt-builder-governance.test.ts`  
预期: PASS

- [ ] **Step 5: 提交代码**

```bash
git add cph-main-agent-prompt.txt cph-researcher-agent-prompt.txt cph-coder-agent-prompt.txt tests/skills/tri-agent-prompts.test.ts tests/protocol/prompt-builder-governance.test.ts
git commit -m "feat(prompts): overhaul Tri-Agent system prompts for snapshot supercharging and causality-aware dispatch"
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
  it("should not contain scout protocol in subagent skill", () => {
    const subagentPath = path.join(__dirname, "../../skills/subagent/SKILL.md");
    const content = fs.readFileSync(subagentPath, "utf8");
    expect(content).not.toContain("isScout");
    expect(content).not.toContain("两阶段斥候领航协议");
    expect(content).toContain("因果依赖与防盲目并发铁律");
    expect(content).toContain("先研后改");
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
   - 彻底删除第 143~150 行及后文所有“斥候角色 (isScout: true)”条目；
   - 重塑 Gate 5：强化**因果依赖与防盲目并发铁律**，明确 Coder 依赖 Researcher 成果时必须分阶段屏障或经主控决策综合；
   - 规范 Researcher 单点深度攻坚工单模板与 Coder 外科手术级实施模板。
2. 微调 `skills/handoff/SKILL.md`：
   - 在核心职责与待办事项中明确写入接力后继主控正向认知契约，杜绝代际失忆；
   - 剔除斥候大纲交接等过渡性陈旧描述。

- [ ] **Step 4: 运行治理测试验证通过**

运行: `bun test tests/skills/subagent-skill-governance.test.ts`  
预期: PASS

- [ ] **Step 5: 提交代码**

```bash
git add skills/subagent/SKILL.md skills/handoff/SKILL.md tests/skills/subagent-skill-governance.test.ts
git commit -m "feat(skills): overhaul subagent and handoff skills for causality-aware dispatch and anti-drift"
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
