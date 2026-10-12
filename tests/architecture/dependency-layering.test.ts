import { describe, it, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { normalizeAgentId } from "../../src/utils/url-utils.ts";
import { ChatHubClient } from "../../src/transport/chathub-client.ts";

describe("Architecture & Layering Boundaries Suite", () => {
  const srcRoot = path.resolve(__dirname, "../../src");

  it("should verify Auth layer has zero reverse dependencies on Transport, Agent, Session, or UI", () => {
    const authDir = path.join(srcRoot, "auth");
    const authFiles = fs.readdirSync(authDir).filter((f) => f.endsWith(".ts"));

    expect(authFiles.length).toBeGreaterThan(0);

    for (const file of authFiles) {
      const content = fs.readFileSync(path.join(authDir, file), "utf-8");
      // Check for illegal upward/reverse imports
      expect(content).not.toMatch(/from\s+["'].*\/transport\//);
      expect(content).not.toMatch(/from\s+["'].*\/agent\//);
      expect(content).not.toMatch(/from\s+["'].*\/session\//);
      expect(content).not.toMatch(/from\s+["'].*\/ui\//);
    }
  });

  it("should verify SubagentRunner has no dependencies on UI layer", () => {
    const subagentRunnerPath = path.join(srcRoot, "agent", "subagent-runner.ts");
    const content = fs.readFileSync(subagentRunnerPath, "utf-8");

    // Must not import terminal-logger or anything from ui
    expect(content).not.toMatch(/from\s+["'].*\/ui\//);
  });

  it("should verify SubagentRunner has no top-level static import of CopilotOrchestrator", () => {
    const subagentRunnerPath = path.join(srcRoot, "agent", "subagent-runner.ts");
    const lines = fs.readFileSync(subagentRunnerPath, "utf-8").split("\n");

    const topLevelOrchestratorImports = lines.filter((line) => {
      const trimmed = line.trim();
      return (
        trimmed.startsWith("import") &&
        trimmed.includes("orchestrator") &&
        !trimmed.startsWith("//")
      );
    });

    expect(topLevelOrchestratorImports).toHaveLength(0);
  });

  it("should verify circular barrel between compaction.ts and blackbox-compactor.ts is broken", () => {
    const compactionPath = path.join(srcRoot, "agent", "compaction.ts");
    const blackboxPath = path.join(srcRoot, "agent", "blackbox-compactor.ts");

    const compactionContent = fs.readFileSync(compactionPath, "utf-8");
    const blackboxContent = fs.readFileSync(blackboxPath, "utf-8");

    // compaction.ts should NOT export BlackboxCompactor
    expect(compactionContent).not.toMatch(/export\s+\{\s*BlackboxCompactor/);

    // blackbox-compactor.ts should NOT import anything from compaction.ts
    expect(blackboxContent).not.toMatch(/from\s+["'].*compaction(\.ts)?["']/);

    // blackbox-compactor.ts must export TurnRecord directly
    expect(blackboxContent).toMatch(/export\s+interface\s+TurnRecord/);
  });

  it("should verify normalizeAgentId works accurately in url-utils and ChatHubClient alias", () => {
    const rawId = "T_9ace94c8-cb78-caab-ddf7-4ae2d8f5a40d";
    const fullUrl = `https://copilot.microsoft.com/chat/agent/${rawId}?auth=1`;
    const encodedUrl = "https://copilot.microsoft.com/chat/agent/agent%2Fcustom%20id";

    // url-utils
    expect(normalizeAgentId(rawId)).toBe(rawId);
    expect(normalizeAgentId(fullUrl)).toBe(rawId);
    expect(normalizeAgentId(encodedUrl)).toBe("agent/custom id");
    expect(normalizeAgentId(undefined)).toBeUndefined();
    expect(normalizeAgentId("   ")).toBeUndefined();

    // ChatHubClient backward compatible alias
    expect(ChatHubClient.normalizeAgentId(rawId)).toBe(rawId);
    expect(ChatHubClient.normalizeAgentId(fullUrl)).toBe(rawId);
    expect(ChatHubClient.normalizeAgentId(encodedUrl)).toBe("agent/custom id");
    expect(ChatHubClient.normalizeAgentId(undefined)).toBeUndefined();
  });
});
