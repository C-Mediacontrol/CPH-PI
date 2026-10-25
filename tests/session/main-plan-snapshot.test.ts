import { describe, it, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  createMainPlanSnapshot,
  saveMainPlanSnapshot,
  loadMainPlanSnapshot,
  formatSuccessorTurn1Prompt,
} from "../../src/session/main-plan-snapshot.ts";

describe("MainPlanSnapshot Engine", () => {
  const tmpDir = path.join(os.tmpdir(), "cph-snapshot-test-" + Date.now());

  it("should create, save and load a lossless main plan snapshot", () => {
    fs.mkdirSync(tmpDir, { recursive: true });

    const snapshot = createMainPlanSnapshot({
      originalSessionId: "main_ses_123",
      originalTask: "重构账户池认证机制",
      thought: "由于涉及底层网络与并发锁，需拆分为调研与实现两步",
      workspaceRoot: tmpDir,
      gitBaseline: "abc1234",
      plannedSubagents: [
        { role: "researcher", description: "调研锁机制", prompt: "探查锁状态" },
        { role: "coder", description: "编写补丁", prompt: "修改代码" },
      ],
    });

    expect(snapshot.snapshotId).toStartWith("snap_");
    expect(snapshot.originalSessionId).toBe("main_ses_123");

    const { jsonPath, mdPath } = saveMainPlanSnapshot(snapshot, tmpDir);
    expect(fs.existsSync(jsonPath)).toBe(true);
    expect(fs.existsSync(mdPath)).toBe(true);

    const loaded = loadMainPlanSnapshot("main_ses_123", tmpDir);
    expect(loaded).not.toBeNull();
    expect(loaded?.originalTask).toBe("重构账户池认证机制");
    expect(loaded?.plannedSubagents.length).toBe(2);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should format a high-fidelity Turn 1 prompt for successor main session", () => {
    const snapshot = createMainPlanSnapshot({
      originalSessionId: "main_ses_456",
      originalTask: "优化会话管理",
      thought: "先查架构再动手",
      workspaceRoot: tmpDir,
      plannedSubagents: [
        { role: "researcher", description: "查结构", prompt: "看文件" },
      ],
    });

    const prompt = formatSuccessorTurn1Prompt(
      snapshot,
      "### 🎯 子代理多会话并发执行报告: 发现并修复 1 处死锁问题"
    );

    expect(prompt).toContain("【主控接力与成果审阅】");
    expect(prompt).toContain("优化会话管理");
    expect(prompt).toContain("先查架构再动手");
    expect(prompt).toContain("子代理多会话并发执行报告");
    expect(prompt).toContain("FINAL_ANSWER");
  });

  it("should mount physical execution ledger header when provided or in workspace", () => {
    const snapshot = createMainPlanSnapshot({
      originalSessionId: "main_ses_789",
      originalTask: "测试账本挂载",
      thought: "验证挂载头",
      workspaceRoot: tmpDir,
      plannedSubagents: [],
    });

    const customMount = "【系统物理执行账本已挂载】\n- 账本路径: .cph/state/execution-ledger.md\n- 累计物理操作: 5 步";
    const prompt = formatSuccessorTurn1Prompt(
      snapshot,
      "交付摘要",
      customMount
    );

    expect(prompt).toContain("### 2. 物理执行账本挂载 (Pass-by-Reference)");
    expect(prompt).toContain("【系统物理执行账本已挂载】");
    expect(prompt).toContain(".cph/state/execution-ledger.md");
    expect(prompt).toContain("按需调阅已挂载的物理账本");
  });

  it("should embed workspace facts, directory skeleton, and self-contained execution mindset in successor prompt", () => {
    const snapshot = createMainPlanSnapshot({
      originalSessionId: "main_ses_999",
      originalTask: "审查 CNNJI QUERY 模块",
      thought: "优先审查大文件",
      workspaceRoot: "E:/test",
      plannedSubagents: [],
    });

    const dirSkeleton = "- Library/\n  - CNNJI QUERY/\n- plan.md\n- AGENTS.md";
    const prompt = formatSuccessorTurn1Prompt(
      snapshot,
      "子任务结题成果",
      undefined,
      4,
      dirSkeleton
    );

    expect(prompt).toContain("【本地宿主机工作区事实】");
    expect(prompt).toContain("- **工作区绝对路径**: E:/test");
    expect(prompt).toContain("remote-workspace-catalog.md");
    expect(prompt).not.toContain("【工作区受控目录骨架 (2-Level Skeleton)】");
    expect(prompt).not.toContain("- Library/");
    expect(prompt).toContain("- **并发集群容量**: 4 个并行 Worker");
    expect(prompt).toContain("【自闭环攻坚心智】");
    expect(prompt).toContain("无需中断执行向用户重问初始需求");
    expect(prompt).not.toContain("严禁");
    expect(prompt).not.toContain("切勿");
  });

  it("should reference remote-workspace-catalog.md attachment instead of inlining virtual-repo-map.md or skeleton in formatSuccessorTurn1Prompt", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cph-succ-map-"));
    try {
      const stateDir = path.join(tmpDir, ".cph", "state");
      fs.mkdirSync(stateDir, { recursive: true });
      const mapContent = "[SHAREPOINT REMOTE WORKSPACE]\nRemote Root URL: https://cmacgmgroup.sharepoint.com/sites/Test\n- Library/query.sql (Size: 1.0KB | Status: [CLOUD-READY])";
      fs.writeFileSync(path.join(stateDir, "virtual-repo-map.md"), mapContent, "utf8");

      const snapshot = createMainPlanSnapshot({
        originalSessionId: "main_ses_auto_map",
        originalTask: "接力任务",
        workspaceRoot: tmpDir,
        plannedSubagents: [],
      });

      const dirSkeleton = "- Library/\n- package.json";
      const prompt = formatSuccessorTurn1Prompt(
        snapshot,
        "子任务成果",
        undefined,
        2,
        dirSkeleton
      );

      expect(prompt).toContain("remote-workspace-catalog.md");
      expect(prompt).not.toContain("【工作区受控目录骨架 (2-Level Skeleton)】");
      expect(prompt).not.toContain("[SHAREPOINT REMOTE WORKSPACE]");
      expect(prompt).not.toContain("Library/query.sql");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
