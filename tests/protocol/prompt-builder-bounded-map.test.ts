import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PnPWorkspaceSyncEngine } from "../../src/workspace/pnp-sync-engine.ts";
import { PromptBuilder } from "../../src/protocol/prompt-builder.ts";

function writeManifest(root: string, files: Record<string, string>) {
  fs.mkdirSync(path.join(root, ".cph", "state"), { recursive: true });
  const entries: Record<string, any> = {};
  for (const rel of Object.keys(files)) {
    entries[rel] = {
      sha256: "abc",
      size: 10,
      serverRelativeUrl: `/sites/test/AFRASIA/WorkSpace/test_workspace/${rel}`,
    };
  }
  fs.writeFileSync(
    path.join(root, ".cph", "state", "sync-manifest.json"),
    JSON.stringify(
      {
        version: 2,
        siteUrl: "https://tenant.sharepoint.com/sites/test",
        targetFolder: "AFRASIA/WorkSpace/test_workspace",
        files: entries,
        folders: {},
      },
      null,
      2
    ),
    "utf8"
  );
}

describe("buildBoundedRepoMap", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "cph-bounded-map-"));
    fs.mkdirSync(path.join(root, "Library", "proj"), { recursive: true });
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    fs.writeFileSync(path.join(root, "src", "a.ts"), "export const a = 1;\n");
    fs.writeFileSync(path.join(root, "src", "b.ts"), "export const b = 2;\n");
    fs.writeFileSync(path.join(root, "Library", "proj", "c.ps1"), "Write-Output 1\n");
    fs.writeFileSync(path.join(root, "README.md"), "# readme\n");
    writeManifest(root, {
      "src/a.ts": "x",
      "src/b.ts": "x",
      "Library/proj/c.ps1": "x",
      "README.md": "x",
    });
  });

  afterEach(() => {
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch {}
  });

  it("includes every file and WebUrl when the budget allows", () => {
    const map = PnPWorkspaceSyncEngine.buildBoundedRepoMap({ workspaceRoot: root, maxChars: 100000 });
    expect(map).toContain("[SHAREPOINT REMOTE WORKSPACE]");
    expect(map).toContain("src/a.ts");
    expect(map).toContain("src/b.ts");
    expect(map).toContain("Library/proj/c.ps1");
    expect(map).toContain("README.md");
    expect(map).toContain(
      "https://tenant.sharepoint.com/sites/test/AFRASIA/WorkSpace/test_workspace/src/a.ts"
    );
    expect(map).toContain("[CLOUD-READY]");
  });

  it("caps the output and points overflow at the catalog attachment", () => {
    fs.mkdirSync(path.join(root, "bulk"), { recursive: true });
    for (let i = 0; i < 400; i++) {
      fs.writeFileSync(path.join(root, "bulk", `file-${i}.ts`), `export const v${i} = ${i};\n`);
    }
    const maxChars = 4000;
    const map = PnPWorkspaceSyncEngine.buildBoundedRepoMap({ workspaceRoot: root, maxChars });
    expect(map.length).toBeLessThanOrEqual(maxChars + 200);
    expect(map).toContain("其余");
    expect(map).toContain("remote-workspace-catalog.md");
  });

  it("orders task-scoped files first", () => {
    const task =
      "请审查 https://tenant.sharepoint.com/sites/test/AFRASIA/Forms/AllItems.aspx?id=%2Fsites%2Ftest%2FAFRASIA%2FWorkSpace%2Ftest_workspace%2FLibrary%2Fproj";
    const map = PnPWorkspaceSyncEngine.buildBoundedRepoMap({
      workspaceRoot: root,
      task,
      maxChars: 100000,
    });
    expect(PnPWorkspaceSyncEngine.deriveTaskScopePrefix(task, "AFRASIA/WorkSpace/test_workspace")).toBe(
      "Library/proj"
    );
    expect(map).toContain("Task scope: Library/proj");
    const scopeIdx = map.indexOf("Library/proj/c.ps1");
    const otherIdx = map.indexOf("src/a.ts");
    expect(scopeIdx).toBeGreaterThan(-1);
    expect(scopeIdx).toBeLessThan(otherIdx);
  });
});

describe("PromptBuilder with bounded map + catalog", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "cph-prompt-map-"));
    fs.mkdirSync(path.join(root, "Library", "proj"), { recursive: true });
    fs.writeFileSync(path.join(root, "Library", "proj", "a.ps1"), "Write-Output 1\n");
    writeManifest(root, { "Library/proj/a.ps1": "x" });
  });

  afterEach(() => {
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch {}
  });

  it("inlines the bounded map and catalog note in Turn 1 prompt", () => {
    const prompt = PromptBuilder.buildTurn1Prompt({
      workspaceRoot: root,
      gitFacts: "clean",
      task: "review Library/proj",
      catalogAttached: true,
    });
    expect(prompt).toContain("[SHAREPOINT REMOTE WORKSPACE]");
    expect(prompt).toContain("Library/proj/a.ps1");
    expect(prompt).toContain("remote-workspace-catalog.md");
  });

  it("does not promise a catalog when it is not attached", () => {
    const prompt = PromptBuilder.buildTurn1Prompt({
      workspaceRoot: root,
      gitFacts: "clean",
      task: "review",
      catalogAttached: false,
    });
    expect(prompt).not.toContain("随本轮消息挂载的附件 remote-workspace-catalog.md");
    expect(prompt).toContain("按需 read_file 读取");
  });
});
