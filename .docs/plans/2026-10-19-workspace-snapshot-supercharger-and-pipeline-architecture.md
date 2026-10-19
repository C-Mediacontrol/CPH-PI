# 全工作区无损源码快照增压与因果感知调度架构实施计划 (Workspace Snapshot Supercharger & Causality-Aware Pipeline Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建工作区全量无损源码快照生成与云端直传挂载通道，推倒重塑 Tri-Agent 提示词体系，建立首轮全局洞察立桩与因果时序把控的高吞吐调度管线。

**Architecture:** 本地 Harness 在开局首轮将工作区源码安全打平为单快照文本，经 OneDrive/Substrate 附件直传通道挂载送达；废除 Scout 斥候探查，Main Agent 首轮立桩高精度 `plan.md`，并基于因果时序与阶段屏障并发调派 Researcher 深度分析锤与 Coder 手术刀实施专家。

**Tech Stack:** TypeScript, Bun, Node.js `fs` & `crypto`, Microsoft Graph / Substrate OneDrive Uploader, Copilot Agent Protocol.

## Global Constraints

- 严禁在工作区根目录写入任何非受控文件，所有产物和测试均在子目录内；
- 遵循 Harness 纯粹与中立原则，不给模型打侵入式特化补丁；
- 全面摒弃负面禁止词（“严禁”、“切勿”、“不要”），系统提示词与指引一律采用正向建设性引导；
- 废弃单文件人为截断，白名单源码 100% 原始完整打入快照，仅设 100MB 宿主物理防爆安全线；
- 严禁盲目并发，严格遵循因果时序屏障（先研后改，同阶段正交并发，跨阶段屏障等待）。

---

### Task 1: 物理快照生成引擎 (WorkspaceSnapshotGenerator) 与单元测试

**Files:**
- Create: `src/workspace/snapshot-generator.ts`
- Test: `tests/workspace/snapshot-generator.test.ts`

**Interfaces:**
- Produces: `WorkspaceSnapshotGenerator.generate(workspaceRoot: string, options?: SnapshotOptions): Promise<SnapshotResult>`
  - `SnapshotResult: { snapshotPath: string; sha256: string; totalFiles: number; totalBytes: number; relPaths: string[] }`

- [ ] **Step 1: 编写失败的单元测试**

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
预期: FAIL with "Cannot find module" 或 "WorkspaceSnapshotGenerator not defined"

- [ ] **Step 3: 编写核心实现**

```typescript
// src/workspace/snapshot-generator.ts
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export interface SnapshotOptions {
  outputPath?: string;
  maxTotalBytes?: number; // 默认 100MB 安全线
  customExtensions?: string[];
}

export interface SnapshotResult {
  snapshotPath: string;
  sha256: string;
  totalFiles: number;
  totalBytes: number;
  relPaths: string[];
}

export class WorkspaceSnapshotGenerator {
  public static readonly DEFAULT_IGNORED_DIRS = new Set([
    "node_modules",
    "dist",
    ".git",
    ".cph",
    ".vscode",
    ".idea",
    "bin",
    "obj",
    "coverage",
    "build",
    ".cache",
    ".gemini",
  ]);

  public static readonly EXCLUDED_BINARY_EXTENSIONS = new Set([
    ".exe",
    ".dll",
    ".so",
    ".dylib",
    ".bin",
    ".pdb",
    ".class",
    ".pyc",
    ".zip",
    ".tar",
    ".gz",
    ".7z",
    ".rar",
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".ico",
    ".svg",
    ".pdf",
    ".onnx",
    ".model",
    ".woff",
    ".woff2",
    ".ttf",
    ".eot",
  ]);

  public static readonly DEFAULT_SOURCE_EXTENSIONS = new Set([
    ".ps1",
    ".psm1",
    ".psd1",
    ".py",
    ".js",
    ".mjs",
    ".cjs",
    ".ts",
    ".tsx",
    ".jsx",
    ".cs",
    ".json",
    ".md",
    ".sql",
    ".bat",
    ".cmd",
    ".html",
    ".css",
    ".yaml",
    ".yml",
    ".xml",
    ".txt",
    ".toml",
    ".sh",
    ".java",
    ".go",
    ".rs",
    ".c",
    ".cpp",
    ".h",
  ]);

  public static async generate(
    workspaceRoot: string,
    options?: SnapshotOptions
  ): Promise<SnapshotResult> {
    const normRoot = path.resolve(workspaceRoot);
    const maxBytes = options?.maxTotalBytes ?? 100 * 1024 * 1024; // 100MB
    const allowedExts = options?.customExtensions
      ? new Set(options.customExtensions.map((e) => (e.startsWith(".") ? e.toLowerCase() : `.${e.toLowerCase()}`)))
      : this.DEFAULT_SOURCE_EXTENSIONS;

    const collectedFiles: { absPath: string; relPath: string; size: number }[] = [];

    function scanDir(dir: string) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (!WorkspaceSnapshotGenerator.DEFAULT_IGNORED_DIRS.has(entry.name) && !entry.name.startsWith(".git")) {
            scanDir(path.join(dir, entry.name));
          }
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (WorkspaceSnapshotGenerator.EXCLUDED_BINARY_EXTENSIONS.has(ext)) {
            continue;
          }
          if (allowedExts.has(ext)) {
            const absPath = path.join(dir, entry.name);
            const relPath = path.relative(normRoot, absPath).replace(/\\/g, "/");
            try {
              const stat = fs.statSync(absPath);
              collectedFiles.push({ absPath, relPath, size: stat.size });
            } catch {}
          }
        }
      }
    }

    scanDir(normRoot);
    collectedFiles.sort((a, b) => a.relPath.localeCompare(b.relPath));

    const cacheDir = path.join(normRoot, ".cph", "cache");
    fs.mkdirSync(cacheDir, { recursive: true });

    const lines: string[] = [];
    lines.push("======================================");
    lines.push("WORKSPACE STRUCTURE (REL-PATHS)");
    lines.push("======================================");
    lines.push("");

    for (const f of collectedFiles) {
      lines.push(f.relPath);
    }

    lines.push("");
    lines.push("======================================");
    lines.push("FILE CONTENTS");
    lines.push("======================================");

    let currentTotalBytes = 0;
    const relPathsList: string[] = [];

    for (const f of collectedFiles) {
      relPathsList.push(f.relPath);
      lines.push("");
      lines.push("##################################################");
      try {
        const raw = fs.readFileSync(f.absPath, "utf8");
        const lineCount = raw.split(/\r?\n/).length;
        lines.push(`FILE: ${f.relPath} (Lines: ${lineCount})`);
        lines.push("##################################################");
        lines.push("");
        lines.push(raw);
        currentTotalBytes += Buffer.byteLength(raw, "utf8");
      } catch (err: any) {
        lines.push(`FILE: ${f.relPath} (ERROR READING)`);
        lines.push("##################################################");
        lines.push("");
        lines.push(`Error reading file: ${err?.message || "Unknown error"}`);
      }

      if (currentTotalBytes >= maxBytes) {
        lines.push("\n[WARNING: Reached 100MB physical memory threshold, subsequent files omitted]");
        break;
      }
    }

    const fullContent = lines.join("\n");
    const sha256 = crypto.createHash("sha256").update(fullContent).digest("hex");
    const targetPath = options?.outputPath || path.join(cacheDir, `workspace-snapshot-${sha256.slice(0, 12)}.txt`);

    fs.writeFileSync(targetPath, fullContent, "utf8");

    return {
      snapshotPath: targetPath,
      sha256,
      totalFiles: relPathsList.length,
      totalBytes: Buffer.byteLength(fullContent, "utf8"),
      relPaths: relPathsList,
    };
  }
}
```

- [ ] **Step 4: 运行测试验证通过**

运行: `bun test tests/workspace/snapshot-generator.test.ts`  
预期: PASS (3 pass)

- [ ] **Step 5: 提交代码**

```bash
git add src/workspace/snapshot-generator.ts tests/workspace/snapshot-generator.test.ts
git commit -m "feat(workspace): implement WorkspaceSnapshotGenerator with full source preservation and binary pruning"
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

在 `tests/protocol/prompt-builder.test.ts` 中增加测试：
```typescript
it("should inject snapshot perception and no-scout action guidance when snapshotMeta provided", () => {
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
  expect(prompt).toContain("共 28 个源码文件");
  expect(prompt).toContain("无需调派斥候");
  expect(prompt).toContain("直接基于附件立桩精准的 plan.md");
});
```

- [ ] **Step 2: 运行测试验证失败**

运行: `bun test tests/protocol/prompt-builder.test.ts`  
预期: FAIL with assertion error

- [ ] **Step 3: 修改 PromptBuilder**

在 `src/protocol/prompt-builder.ts` 中增加 `snapshotMeta` 支持：
```typescript
export interface SnapshotMeta {
  fileName: string;
  totalFiles: number;
}
```
并在 `buildDirectAgentPrompt` 中追加：
```typescript
if (snapshotMeta) {
  prompt += `\n\n【全工作区无损源码快照已挂载送达】
✔ 工作区全量源码（共 ${snapshotMeta.totalFiles} 个文件）与相对路径拓扑已封装为附件【${snapshotMeta.fileName}】挂载至本会话。
✔ 云端文档引擎已对该快照建立全量索引，你天然具备全工作区完整代码视野。
✔ 【高效攻坚行动指引】：
1. 无需调派斥候子代理（Scout）或发起盲读类的 read_file / run_command 探查目录；
2. 请直接基于附件中的完整代码与结构拓扑，在第一轮立桩精准的 plan.md 物理清单（格式为 - [ ] 步骤描述，精准定位至目标文件与核心关注点）；
3. 计划立桩后，立即进入子任务调派或直接推进外科手术级局部修改！`;
}
```

- [ ] **Step 4: 运行测试验证通过**

运行: `bun test tests/protocol/prompt-builder.test.ts`  
预期: PASS

- [ ] **Step 5: 提交代码**

```bash
git add src/protocol/prompt-builder.ts tests/protocol/prompt-builder.test.ts
git commit -m "feat(protocol): enhance PromptBuilder with full workspace snapshot grounding and action guidance"
```

---

### Task 3: Orchestrator 集成快照生成与首轮云端附件直传挂载

**Files:**
- Modify: `src/agent/orchestrator.ts`
- Create: `tests/agent/orchestrator-snapshot-mounting.test.ts`

**Interfaces:**
- Consumes: `WorkspaceSnapshotGenerator.generate`, `SubstrateUploader.uploadDocumentToOneDrive`
- Produces: 在 `Orchestrator.run()` 启动时，自动生成工作区快照并通过 `initialAnnotations` 直传挂载。

- [ ] **Step 1: 编写测试验证 Orchestrator 在首轮挂载快照**

```typescript
// tests/agent/orchestrator-snapshot-mounting.test.ts
import { describe, it, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Orchestrator } from "../../src/agent/orchestrator.ts";

describe("Orchestrator Snapshot Auto-Mounting", () => {
  it("should have enableWorkspaceSnapshot enabled by default and build snapshot artifact", async () => {
    const tmpDir = path.join(os.tmpdir(), "cph-orch-snap-" + Date.now());
    fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "src", "demo.ts"), "export const x = 1;");

    const orch = new Orchestrator({
      workspaceRoot: tmpDir,
      enableWorkspaceSnapshot: true,
      enableCloudAttachment: false, // 离线测试
    });

    const snapshot = await orch.prepareWorkspaceSnapshot();
    expect(snapshot).not.toBeNull();
    expect(snapshot?.totalFiles).toBe(1);
    expect(fs.existsSync(snapshot!.snapshotPath)).toBe(true);

    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

运行: `bun test tests/agent/orchestrator-snapshot-mounting.test.ts`  
预期: FAIL with "prepareWorkspaceSnapshot is not a function"

- [ ] **Step 3: 在 Orchestrator 中实现 `prepareWorkspaceSnapshot` 与自动挂载逻辑**

在 `OrchestratorOptions` 增加 `enableWorkspaceSnapshot?: boolean;`（默认为 true）。  
在 `src/agent/orchestrator.ts` 增加：
```typescript
  public async prepareWorkspaceSnapshot(): Promise<SnapshotResult | null> {
    if (!this.enableWorkspaceSnapshot) return null;
    try {
      return await WorkspaceSnapshotGenerator.generate(this.workspaceRoot);
    } catch {
      return null;
    }
  }
```
并在 `run()` 方法开始处，如果 `this.enableCloudAttachment` 为真且获取到了 `graphToken`，自动上传该快照文件并压入 `currentAnnotations`！

- [ ] **Step 4: 运行测试验证通过**

运行: `bun test tests/agent/orchestrator-snapshot-mounting.test.ts`  
预期: PASS

- [ ] **Step 5: 提交代码**

```bash
git add src/agent/orchestrator.ts tests/agent/orchestrator-snapshot-mounting.test.ts
git commit -m "feat(orchestrator): integrate automated workspace snapshot generation and cloud mounting"
```

---

### Task 4: Tri-Agent 系统提示词推倒重塑与因果防盲目并发铁律

**Files:**
- Modify: `cph-main-agent-prompt.txt`
- Modify: `cph-researcher-agent-prompt.txt`
- Modify: `cph-coder-agent-prompt.txt`
- Modify: `tests/skills/tri-agent-prompts.test.ts`
- Modify: `tests/protocol/prompt-builder-governance.test.ts`

**Interfaces:**
- Produces: 具有全新角色认知、零 Scout 机制、单点深度分析锤、闭环 Coder 以及严格因果依赖顺序的 Tri-Agent 提示词。

- [ ] **Step 1: 编写针对新规范的测试**

在 `tests/skills/tri-agent-prompts.test.ts` 中校验：
1. `cph-main-agent-prompt.txt` 移除了 `Phase 1 Scout Dispatch Focus` 与两阶段斥候概念；
2. `cph-main-agent-prompt.txt` 包含了“因果时序与防盲目并发铁律 (Causality & Anti-Blind-Concurrency)”；
3. `cph-main-agent-prompt.txt` 明确 Coder 依赖 Researcher 时必须分阶段派发或经主控决策综合；
4. `cph-researcher-agent-prompt.txt` 明确专职深度攻坚分析锤；
5. 所有提示词不含负面禁止词（“严禁”、“切勿”、“不要”）。

- [ ] **Step 2: 运行测试验证失败**

运行: `bun test tests/skills/tri-agent-prompts.test.ts`  
预期: FAIL

- [ ] **Step 3: 全面重构三个系统提示词**

1. **重构 `cph-main-agent-prompt.txt`**：
   - 确立上帝视角首轮立桩；
   - 彻底删除所有两阶段斥候（Scout）的段落与描述；
   - 强化因果依赖管理：明确阐述若 Worker 4 [Coder] 的实施依据是 Worker 2 [Researcher] 的审查报告，必须通过阶段屏障（`stage: 1` ➔ `stage: 2`）或在主控审阅报告综合决策后再派发 Coder，杜绝盲目并发；
   - 保持 100% 正向建设性引导。
2. **重构 `cph-researcher-agent-prompt.txt`**：
   - 定位为纯粹的“单点深度攻坚分析锤”；
   - 负责热核级审查、状态机死锁与漏洞深潜，输出深度报告落盘。
3. **重构 `cph-coder-agent-prompt.txt`**：
   - 定位为接单即改、自测自闭环实施专家；
   - 专注外科手术级局部补丁与自动化测试验证。

- [ ] **Step 4: 运行治理与提示词测试验证通过**

运行: `bun test tests/skills/tri-agent-prompts.test.ts tests/protocol/prompt-builder-governance.test.ts`  
预期: PASS

- [ ] **Step 5: 提交代码**

```bash
git add cph-main-agent-prompt.txt cph-researcher-agent-prompt.txt cph-coder-agent-prompt.txt tests/skills/tri-agent-prompts.test.ts tests/protocol/prompt-builder-governance.test.ts
git commit -m "feat(prompts): overhaul Tri-Agent system prompts for snapshot supercharging and causality-aware dispatch"
```

---

### Task 5: 全量回归测试、构建打包与真实工作区验证

**Files:**
- Modify: `package/bin/cph-pi.js`
- Modify: `dist/copilot-agent-bundle.zip`

- [ ] **Step 1: 运行全量单元与集成测试**

运行: `bun test`  
预期: 全部 650+ 测试 100% PASS (0 fail)

- [ ] **Step 2: 重新打包分发包**

运行: `bun run package; bun run build:package`  
预期:
- `dist/copilot-agent-bundle.zip` 成功生成并包含重构后的最新提示词
- `package/bin/cph-pi.js` 重新编译成功

- [ ] **Step 3: 最终 Git 提交**

```bash
git add package/ dist/
git commit -m "build: rebuild package binary and distribution bundle with snapshot supercharger"
```
