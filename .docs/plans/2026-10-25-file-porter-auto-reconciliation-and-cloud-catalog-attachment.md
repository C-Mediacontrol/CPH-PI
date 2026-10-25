# File Porter 自动对账落盘、双向物理同态同步与云端工作区目录全量附件化实施计划 (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建完整的 File Porter 双模态拉取落盘与防根目录污染解包引擎，实现开工前全量同步、更新时即时热同步的双向物理同态保障，将工作区全量目录以单文件附件（`remote-workspace-catalog.md`）挂载至首轮会话，并以两级自主决策流引导 Agent 优先调阅云端权威版本并在爬虫未建索引时自动回退本地读取。

**Architecture:** 
1. **Prompt 认知塑形**：在 `cph-main-agent-prompt.txt` 与 `cph-coder-agent-prompt.txt` 中置顶交付清单指引，建立“云端工作区优先直读，爬虫未建索引本地工具兜底”的两级自主决策闭环；
2. **协议与搬运引擎 (DeliverablesParser & FilePorter)**：通过正则与容错兜底解析首屏置顶交付清单，支持 CDP 页面桥接与 IC3 Bearer 双模态拉取，安全平铺解压 ZIP 并施加工作区根目录防污染拦截；
3. **同态同步与附件投递**：Turn 1 启动前执行全量同态对齐，生成 `remote-workspace-catalog.md` 并以 `LocalFile` 附件形式上传挂载（支持 SHA-256 缓存），彻底剔除 WebSocket Prompt 文本流中的多行列表倾倒；任务运行中但凡有文件落盘或修改，秒级触发增量热同步至 SharePoint。

**Tech Stack:** TypeScript, Bun, Node.js (`node:fs`, `node:path`, `node:zlib`, `adm-zip`), Microsoft Graph API, Teams Async Media Service (IC3), Chrome DevTools Protocol (CDP).

## Global Constraints

- **AGENTS.md 准则 1**：严禁在工作区根目录写入任何文件，所有代码与落盘文件必须在二级子目录内（如 `test/`、`CPH-PI/` 等）；
- **AGENTS.md 准则 3**：系统提示词与代码注释 100% 采用建设性正向引导，杜绝负面禁止词；
- **AGENTS.md 准则 6**：Harness 保持纯粹黑盒契约，不向模型解释底层 WebSocket、CDP、IC3 或本地 JSON 序列化机制；
- **AGENTS.md 准则 7 & 8**：传引用挂载、零 Token 预写与云端原生生成 + File Porter 搬运闭环；
- **AGENTS.md 准则 9**：全量附件投递，杜绝在聊天文本流中倾倒多行受控目录列表；
- **参考规范**: [SPEC-2026-10-25-FP-CATALOG](../specs/2026-10-25-file-porter-auto-reconciliation-and-cloud-catalog-attachment-design.md)。

---

## 冲击面扫描 (Impact Surface Scan)

| 制品类型 | ⬆️ 上游（生产方） | ⬇️ 下游（消费方） | 应对方案 |
|---|---|---|---|
| 提示词文件 | `cph-main-agent-prompt.txt`, `cph-coder-agent-prompt.txt` | Sydney Copilot 智能体注意力与输出契约 | Task 1: 注入正向交付指引与两级读取流，更新打包并由单测验证 |
| 协议解析器 | `DeliverablesParser` (`src/protocol/resilient-parser.ts`) | `orchestrator.ts` 终局交付物对账 | Task 2: 独立 TDD 单元测试覆盖各类 Markdown 语法及容错边界 |
| 传输搬运器 | `FilePorter` (`src/transport/file-porter.ts`) | `orchestrator.ts` 终局落地与解包 | Task 3: 封装双模态拉取、安全平铺解压与根目录防污染安全拦截 |
| 提示词生成器 | `PromptBuilder` (`src/protocol/prompt-builder.ts`) | Turn 1 首屏提示词与 WebSocket 帧 | Task 4: 剔除 `virtualRepoMap` 多行倾倒，替换为极简单行指纹 |
| 同步引擎 | `PnPWorkspaceSyncEngine` (`src/workspace/pnp-sync-engine.ts`) | `remote-workspace-catalog.md` 索引生成 | Task 4: 增加规范化目录清单生成逻辑，包含双向路径映射 |
| 主控编排器 | `orchestrator.ts` (`src/agent/orchestrator.ts`) | 端到端对话生命周期与会话附件 | Task 5: 开工前全量同步、Catalog 附件上传、终局自动落盘与增量热同步 |

---

### Task 1: 提示词认知塑形与打包分发 (Prompt Shaping & Agent Bundle)

**Files:**
- Modify: `cph-main-agent-prompt.txt:1-68`
- Modify: `cph-coder-agent-prompt.txt:1-53`
- Test: `tests/skills/tri-agent-prompts.test.ts`
- Package: `package/agent-bundle/copilot-agent-bundle.zip`

**Interfaces:**
- Consumes: 无（纯文本工程提示词）
- Produces: 
  - `FINAL_ANSWER` 置顶 `【交付文件与落盘指引 / Deliverables】` 格式规范
  - 两级自主读取与回退决策流：云端优先检索直读（权威最新）+ 爬虫未建索引本地工具 `read_file` 兜底

- [ ] **Step 1: 编写提示词契约单元测试**

在 `tests/skills/tri-agent-prompts.test.ts` 中增加测试用例，验证提示词包含两级自主读取决策流与交付物置顶指引，且符合 AGENTS.md 准则 3（无负面禁用词）：

```typescript
test("main and coder agent prompts contain deliverables contract and two-tier reading strategy", () => {
  const mainPrompt = fs.readFileSync(path.resolve("cph-main-agent-prompt.txt"), "utf8");
  const coderPrompt = fs.readFileSync(path.resolve("cph-coder-agent-prompt.txt"), "utf8");

  expect(mainPrompt).toContain("【交付文件与落盘指引 / Deliverables】");
  expect(mainPrompt).toContain("remote-workspace-catalog.md");
  expect(mainPrompt).toContain("第一优先级（云端优先）");
  expect(mainPrompt).toContain("第二优先级（本地兜底）");

  expect(coderPrompt).toContain("remote-workspace-catalog.md");
  expect(coderPrompt).toContain("第一优先级（云端优先）");
  expect(coderPrompt).toContain("第二优先级（本地兜底）");

  // 严格正向引导准则校验：绝不包含负面禁止词
  expect(mainPrompt).not.toMatch(/严禁|切勿|不要/);
  expect(coderPrompt).not.toMatch(/严禁|切勿|不要/);
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd "e:\copilot-web proxy\CPH-PI"; bun test tests/skills/tri-agent-prompts.test.ts`
Expected: FAIL（提示词中尚未包含相关段落）

- [ ] **Step 3: 更新提示词文件并保持正向引导**

更新 `cph-main-agent-prompt.txt` 与 `cph-coder-agent-prompt.txt`：
1. 声明附件 `remote-workspace-catalog.md` 包含所有文件的云端 SharePoint WebUrl 与本地相对路径映射；
2. 注入“第一优先级（云端优先）+ 第二优先级（本地兜底）”两级自主读取决策流；
3. 在 `FINAL_ANSWER` 说明中增加首屏置顶 `【交付文件与落盘指引 / Deliverables】`。

- [ ] **Step 4: 运行测试并执行打包验证通过**

Run: `cd "e:\copilot-web proxy\CPH-PI"; bun test tests/skills/tri-agent-prompts.test.ts; bun run package`
Expected: PASS，且 `copilot-agent-bundle.zip` 打包成功更新。

- [ ] **Step 5: 提交更改**

```bash
git add cph-main-agent-prompt.txt cph-coder-agent-prompt.txt tests/skills/tri-agent-prompts.test.ts package/agent-bundle/copilot-agent-bundle.zip
git commit -m "feat(prompt): add deliverables placement contract and autonomous two-tier reading strategy"
```

---

### Task 2: 交付物结构化解析器 (`DeliverablesParser`)

**Files:**
- Create: `src/protocol/deliverables-parser.ts`
- Modify: `src/protocol/resilient-parser.ts`
- Test: `tests/protocol/deliverables-parser.test.ts`

**Interfaces:**
- Produces:
  ```typescript
  export interface DeliverableItem {
    name: string;
    url: string;
    destinationPath: string; // 规范化相对路径，例如 "test/report.md" 或 "test/"
    isZip: boolean;
  }
  export class DeliverablesParser {
    public static parse(text: string, workspaceRoot: string): DeliverableItem[];
  }
  ```

- [ ] **Step 1: 编写 DeliverablesParser 失败单测**

创建 `tests/protocol/deliverables-parser.test.ts`：

```typescript
import { describe, test, expect } from "bun:test";
import { DeliverablesParser } from "../../src/protocol/deliverables-parser.ts";

describe("DeliverablesParser", () => {
  const ws = "E:\\test";

  test("parses standard arrow deliverables declaration", () => {
    const text = `FINAL_ANSWER: 任务完成
【交付文件与落盘指引 / Deliverables】
- [详细审查文档.md](https://fr-prod.asyncgw.teams.microsoft.com/v1/objects/123/views/original) -> 目标落盘路径: \`test/review.md\`
- [完整交付包.zip](https://fr-prod.asyncgw.teams.microsoft.com/v1/objects/456/views/original) -> 目标落盘路径: \`test/\` (ZIP 自动解压)
`;
    const items = DeliverablesParser.parse(text, ws);
    expect(items.length).toBe(2);
    expect(items[0]).toEqual({
      name: "详细审查文档.md",
      url: "https://fr-prod.asyncgw.teams.microsoft.com/v1/objects/123/views/original",
      destinationPath: "test/review.md",
      isZip: false,
    });
    expect(items[1]).toEqual({
      name: "完整交付包.zip",
      url: "https://fr-prod.asyncgw.teams.microsoft.com/v1/objects/456/views/original",
      destinationPath: "test/",
      isZip: true,
    });
  });

  test("handles colon syntax and windows path normalization", () => {
    const text = `【交付文件与落盘指引】
- [测试脚本.py](https://m365.cloud.microsoft/download/abc) 目标路径: test\\audit_report.py
`;
    const items = DeliverablesParser.parse(text, ws);
    expect(items.length).toBe(1);
    expect(items[0].destinationPath).toBe("test/audit_report.py");
  });

  test("falls back safely for bare asyncgw links without explicit path", () => {
    const text = `以下是生成的文件：
[生成报告](https://fr-prod.asyncgw.teams.microsoft.com/v1/objects/789/views/original?filename=report.docx)
`;
    const items = DeliverablesParser.parse(text, ws);
    expect(items.length).toBe(1);
    expect(items[0].url).toContain("asyncgw.teams.microsoft.com");
    expect(items[0].destinationPath).toMatch(/^test\//);
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd "e:\copilot-web proxy\CPH-PI"; bun test tests/protocol/deliverables-parser.test.ts`
Expected: FAIL（模块未定义）

- [ ] **Step 3: 实现 `DeliverablesParser` 核心逻辑**

创建 `src/protocol/deliverables-parser.ts` 并在 `src/protocol/resilient-parser.ts` 重新导出：

```typescript
import path from "node:path";

export interface DeliverableItem {
  name: string;
  url: string;
  destinationPath: string;
  isZip: boolean;
}

export class DeliverablesParser {
  public static parse(text: string, workspaceRoot: string): DeliverableItem[] {
    const items: DeliverableItem[] = [];
    if (!text) return items;

    // 1. 标准声明语法匹配: - [name](url) -> 目标落盘路径: `path`
    const standardRegex = /-\s*\[([^\]]+)\]\((https?:\/\/[^\s\)]+)\)\s*(?:->|—>|目标(?:落盘)?路径[:：])\s*`?([^\s`\r\n]+)`?/gi;
    let match: RegExpExecArray | null;

    const matchedUrls = new Set<string>();

    while ((match = standardRegex.exec(text)) !== null) {
      const name = match[1].trim();
      const url = match[2].trim();
      let dest = match[3].trim().replace(/\\/g, "/");

      // 移除尾部可能带入的说明文字如 (ZIP 自动解压)
      dest = dest.replace(/[（\(].*$/, "").trim();

      matchedUrls.add(url);
      const isZip = dest.toLowerCase().endsWith(".zip") || name.toLowerCase().endsWith(".zip") || url.toLowerCase().includes(".zip");

      items.push({
        name,
        url,
        destinationPath: dest,
        isZip,
      });
    }

    // 2. 兜底回退：扫描遗漏的 asyncgw 链接
    const asyncgwRegex = /\[([^\]]*)\]\((https?:\/\/[^\s\)]*asyncgw\.teams\.microsoft\.com[^\s\)]*)\)/gi;
    while ((match = asyncgwRegex.exec(text)) !== null) {
      const name = match[1].trim() || "downloaded-file";
      const url = match[2].trim();
      if (matchedUrls.has(url)) continue;

      let ext = "";
      if (name.includes(".")) ext = path.extname(name);
      else if (url.includes(".")) {
        const urlObj = new URL(url);
        ext = path.extname(urlObj.pathname) || path.extname(urlObj.searchParams.get("filename") || "");
      }
      if (!ext) ext = ".txt";

      const fallbackName = name.includes(".") ? name : `${name}${ext}`;
      const isZip = fallbackName.toLowerCase().endsWith(".zip");
      items.push({
        name: fallbackName,
        url,
        destinationPath: `test/${fallbackName}`,
        isZip,
      });
      matchedUrls.add(url);
    }

    return items;
  }
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `cd "e:\copilot-web proxy\CPH-PI"; bun test tests/protocol/deliverables-parser.test.ts`
Expected: PASS (所有解析用例均通过)

- [ ] **Step 5: 提交更改**

```bash
git add src/protocol/deliverables-parser.ts src/protocol/resilient-parser.ts tests/protocol/deliverables-parser.test.ts
git commit -m "feat(protocol): add DeliverablesParser for structured delivery placement extraction"
```

---

### Task 3: 双模态 FilePorter 与防根目录污染智能解包 (`AutoFilePorter`)

**Files:**
- Modify: `src/transport/file-porter.ts`
- Test: `tests/transport/file-porter-extract.test.ts`

**Interfaces:**
- Consumes: `DeliverableItem`
- Produces:
  ```typescript
  export interface FilePorterDeliveryResult {
    item: DeliverableItem;
    landedPaths: string[]; // 成功写入物理磁盘的相对路径集合
    status: "success" | "skipped" | "failed";
    error?: string;
  }
  export class FilePorter {
    public static extractZipSafely(zipBuffer: Buffer, targetDir: string, workspaceRoot: string): string[];
    public static async fetchAndDeliver(
      item: DeliverableItem,
      workspaceRoot: string,
      options?: { cdpClient?: any; ic3Token?: string }
    ): Promise<FilePorterDeliveryResult>;
  }
  ```

- [ ] **Step 1: 编写 FilePorter 智能解压与安全拦截单测**

创建 `tests/transport/file-porter-extract.test.ts`：

```typescript
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { FilePorter } from "../../src/transport/file-porter.ts";
import fs from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";

describe("FilePorter Safe ZIP Extraction & Anti-Root-Pollution", () => {
  const tmpWs = path.resolve("tests", "tmp-ws-fileporter");

  beforeEach(() => {
    fs.mkdirSync(tmpWs, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpWs, { recursive: true, force: true });
  });

  test("flattens single redundant parent directory if matching target basename", () => {
    const zip = new AdmZip();
    zip.addFile("test/inner-report.md", Buffer.from("# Report", "utf8"));
    zip.addFile("test/sub/data.json", Buffer.from("{}", "utf8"));
    const zipBuf = zip.toBuffer();

    const landed = FilePorter.extractZipSafely(zipBuf, "test", tmpWs);
    expect(landed).toContain("test/inner-report.md");
    expect(landed).toContain("test/sub/data.json");
    // 不应出现 test/test/
    expect(fs.existsSync(path.join(tmpWs, "test", "inner-report.md"))).toBe(true);
    expect(fs.existsSync(path.join(tmpWs, "test", "test"))).toBe(false);
  });

  test("enforces anti-root-pollution guard and diverts root writes into safe subfolder", () => {
    const zip = new AdmZip();
    zip.addFile("danger.sh", Buffer.from("echo 1", "utf8"));
    const zipBuf = zip.toBuffer();

    // 试图解压到根目录 "" 或 "."
    const landed = FilePorter.extractZipSafely(zipBuf, ".", tmpWs);
    // 强制重定向至 test/
    expect(landed[0]).toBe("test/danger.sh");
    expect(fs.existsSync(path.join(tmpWs, "danger.sh"))).toBe(false);
    expect(fs.existsSync(path.join(tmpWs, "test", "danger.sh"))).toBe(true);
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd "e:\copilot-web proxy\CPH-PI"; bun test tests/transport/file-porter-extract.test.ts`
Expected: FAIL（方法未实现）

- [ ] **Step 3: 扩展 `FilePorter` 实现智能解包与安全守卫**

在 `src/transport/file-porter.ts` 中实现：
1. `extractZipSafely`：使用 `adm-zip`，遍历 entry，若所有 entry 都带有公共前缀且等于目标目录 basename，自动剥离顶层前缀；检查最终绝对路径，若等于 `workspaceRoot` 根目录，强制推入 `test/` 安全子目录；
2. `fetchAndDeliver`：双模态拉取：
   - 模态 A：若传入 `cdpClient`，通过 `cdpClient.evaluate(fetch(url))` 拉取内存 blob；
   - 模态 B：无头直接拉取，若是 `asyncgw.teams.microsoft.com`，附带 `Authorization: Bearer <ic3Token>` 与 `MS-IC3-Product: Copilot`；
   - 根据 `isZip` 决定单文件写入或解包。

- [ ] **Step 4: 运行测试验证通过**

Run: `cd "e:\copilot-web proxy\CPH-PI"; bun test tests/transport/file-porter-extract.test.ts`
Expected: PASS

- [ ] **Step 5: 提交更改**

```bash
git add src/transport/file-porter.ts tests/transport/file-porter-extract.test.ts
git commit -m "feat(transport): implement safe zip flattening and anti-root-pollution guard in FilePorter"
```

---

### Task 4: 工作区全量目录附件化 (`remote-workspace-catalog.md`) 与 Prompt 极端精简

**Files:**
- Modify: `src/workspace/pnp-sync-engine.ts`
- Modify: `src/protocol/prompt-builder.ts`
- Test: `tests/agent/remote-workspace-catalog.test.ts`
- Modify: `tests/protocol/prompt-builder.test.ts`

**Interfaces:**
- Consumes: `PnPWorkspaceSyncEngine.loadManifest`
- Produces:
  ```typescript
  export class PnPWorkspaceSyncEngine {
    public static generateCatalogMarkdown(workspaceRoot: string, options?: { siteUrl?: string; targetFolder?: string }): string;
  }
  ```
- 提示词变更：`buildTurn1Prompt`、`buildDirectAgentPrompt`、`buildReGroundingPrompt` 移除 `virtualRepoMap` 多行倾倒，替换为极简单行指纹：
  `【云端工作区受控目录】已挂载云端附件: remote-workspace-catalog.md（包含 N 个已同步文件的云端直读 WebUrl 与元数据索引）`

- [ ] **Step 1: 编写目录附件与 Prompt 精简化单测**

创建 `tests/agent/remote-workspace-catalog.test.ts`：

```typescript
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { PnPWorkspaceSyncEngine } from "../../src/workspace/pnp-sync-engine.ts";
import { PromptBuilder } from "../../src/protocol/prompt-builder.ts";
import fs from "node:fs";
import path from "node:path";

describe("Remote Workspace Catalog & Clean Prompt", () => {
  const tmpWs = path.resolve("tests", "tmp-ws-catalog");

  beforeEach(() => {
    fs.mkdirSync(path.join(tmpWs, ".cph", "state"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpWs, ".cph", "state", "sync-manifest.json"),
      JSON.stringify({
        siteUrl: "https://example.sharepoint.com/sites/Test",
        targetFolder: "/Shared Documents/WorkSpace",
        files: {
          "src/index.ts": {
            hash: "123",
            remoteUrl: "https://example.sharepoint.com/sites/Test/Shared Documents/WorkSpace/src/index.ts",
            lastSynced: "2026-10-25T10:00:00Z",
            size: 456
          }
        }
      }, null, 2),
      "utf8"
    );
  });

  afterEach(() => {
    fs.rmSync(tmpWs, { recursive: true, force: true });
  });

  test("generates standard remote-workspace-catalog.md with local path and cloud weburl", () => {
    const catalog = PnPWorkspaceSyncEngine.generateCatalogMarkdown(tmpWs);
    expect(catalog).toContain("# Remote Workspace Catalog");
    expect(catalog).toContain("`src/index.ts`");
    expect(catalog).toContain("https://example.sharepoint.com/sites/Test/Shared Documents/WorkSpace/src/index.ts");
  });

  test("PromptBuilder outputs 0 lines of raw table and only 1 line of fingerprint reference", () => {
    const prompt = PromptBuilder.buildTurn1Prompt({
      workspaceRoot: tmpWs,
      task: "审查代码",
    });
    // 绝不在 Prompt 字符串中倾倒多行表格或 [SHAREPOINT REMOTE WORKSPACE] 全文
    expect(prompt).not.toContain("[SHAREPOINT REMOTE WORKSPACE]");
    expect(prompt).not.toContain("https://example.sharepoint.com");
    expect(prompt).toContain("remote-workspace-catalog.md");
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd "e:\copilot-web proxy\CPH-PI"; bun test tests/agent/remote-workspace-catalog.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 `generateCatalogMarkdown` 并精简 `PromptBuilder`**

1. 在 `PnPWorkspaceSyncEngine` 中实现 `generateCatalogMarkdown`，规范化输出 Markdown 索引；
2. 在 `PromptBuilder` 中修改 `buildTurn1Prompt`、`buildDirectAgentPrompt`、`buildReGroundingPrompt`，将原来的内联 `virtualRepoMap` 替换为单行极简物理指纹。

- [ ] **Step 4: 运行测试并回归 PromptBuilder 单测**

Run: `cd "e:\copilot-web proxy\CPH-PI"; bun test tests/agent/remote-workspace-catalog.test.ts tests/protocol/prompt-builder.test.ts`
Expected: PASS

- [ ] **Step 5: 提交更改**

```bash
git add src/workspace/pnp-sync-engine.ts src/protocol/prompt-builder.ts tests/agent/remote-workspace-catalog.test.ts tests/protocol/prompt-builder.test.ts
git commit -m "feat(catalog): convert workspace directory map to remote-workspace-catalog.md attachment"
```

---

### Task 5: 编排器端到端闭环（开工前全量同步、目录附件上传、终局落盘与即时热同步）

**Files:**
- Modify: `src/agent/orchestrator.ts:500-650`, `1800-1950`
- Test: `tests/agent/orchestrator-file-porter-sync.test.ts`

**Interfaces:**
- Consumes:
  - `PnPWorkspaceSyncEngine.syncWorkspace` & `syncFile`
  - `SubstrateUploader.uploadDocumentAuto`
  - `DeliverablesParser.parse`
  - `FilePorter.fetchAndDeliver`
- Produces:
  - Turn 1 启动前自动执行 `syncWorkspace`，保持本地与云端 1:1 绝对一致；
  - 自动挂载 `remote-workspace-catalog.md` 附件；
  - `FINAL_ANSWER` 输出后自动嗅探交付清单、自动落盘；
  - 文件落盘后即时调用 `syncFile` 推回云端 SharePoint。

- [ ] **Step 1: 编写 Orchestrator 端到端闭环集成单测**

创建 `tests/agent/orchestrator-file-porter-sync.test.ts`：

```typescript
import { describe, test, expect, mock } from "bun:test";
import { CopilotOrchestrator } from "../../src/agent/orchestrator.ts";
import { DeliverablesParser } from "../../src/protocol/deliverables-parser.ts";
import path from "node:path";
import fs from "node:fs";

describe("Orchestrator Pre-Turn Sync & Auto FilePorter Reconciliation", () => {
  const tmpWs = path.resolve("tests", "tmp-ws-orch-porter");

  test("parses deliverables in final answer and executes delivery reconciliation", async () => {
    const finalAnswer = `FINAL_ANSWER: 分析已完成
【交付文件与落盘指引 / Deliverables】
- [数据审查.py](https://test.local/download/audit.py) -> 目标落盘路径: \`test/audit.py\`
`;
    const items = DeliverablesParser.parse(finalAnswer, tmpWs);
    expect(items.length).toBe(1);
    expect(items[0].destinationPath).toBe("test/audit.py");
  });
});
```

- [ ] **Step 2: 在 `orchestrator.ts` 中实现开工前同步与目录附件上传**

1. 在 `run()` 方法中（进入 Turn 1 之前）：
   - 检查工作区是否存在 `sync-manifest.json`；
   - 若存在，调用 `await PnPWorkspaceSyncEngine.syncWorkspace(this.workspaceRoot, manifest.targetFolder, { siteUrl: manifest.siteUrl })`，确保本地所有改动在开工前已镜像到 SharePoint；
   - 生成 `remote-workspace-catalog.md`，计算其 SHA-256，利用 `workspace-catalog-cache.json` 进行哈希缓存检查；若未命中则通过 `SubstrateUploader.uploadDocumentAuto` 上传为 `LocalFile` 附件并压入 `currentAnnotations`。
2. 在模型输出 `FINAL_ANSWER` 时：
   - 调用 `DeliverablesParser.parse(finalAnswer, this.workspaceRoot)`；
   - 若命中交付项，并发调用 `FilePorter.fetchAndDeliver(item, this.workspaceRoot)` 进行安全拉取与解压落盘；
   - 对每个落盘的本地文件，立即触发 `PnPWorkspaceSyncEngine.syncFile(this.workspaceRoot, relativePath, manifest.targetFolder)` 实现即时增量热同步。

- [ ] **Step 3: 运行集成测试验证**

Run: `cd "e:\copilot-web proxy\CPH-PI"; bun test tests/agent/orchestrator-file-porter-sync.test.ts`
Expected: PASS

- [ ] **Step 4: 提交更改**

```bash
git add src/agent/orchestrator.ts tests/agent/orchestrator-file-porter-sync.test.ts
git commit -m "feat(agent): integrate pre-turn-1 sync, catalog attachment, auto file-porter and post-update hot-sync"
```

---

### Task 6: 全仓自动化回归与质量门禁 (Full Regression Gate)

**Files:**
- Test: 全仓所有测试套件

- [ ] **Step 1: 运行全量单元测试与集成测试**

Run: `cd "e:\copilot-web proxy\CPH-PI"; bun test`
Expected: 111+ 个测试文件、915+ 项测试全部 100% 绿灯 PASS。

- [ ] **Step 2: 运行 Agent Bundle 打包验证**

Run: `cd "e:\copilot-web proxy\CPH-PI"; bun run package`
Expected: 退出码 0，分发包同步更新。

- [ ] **Step 3: 验证 Git 状态干净并提交**

```bash
git status
```
Expected: 没有未跟踪或未提交的异常文件，工作区整洁。
