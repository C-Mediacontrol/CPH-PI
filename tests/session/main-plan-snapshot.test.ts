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
});
