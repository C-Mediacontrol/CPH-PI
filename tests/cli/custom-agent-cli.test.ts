import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { parseCliArgs, CphPiCli } from "../../src/cli.ts";

describe("CLI Custom Agent Flags, Commands & Config", () => {
  let tmpDir: string;
  const originalEnvAgent = process.env.CPH_COPILOT_AGENT_ID;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cph-cli-config-test-"));
    delete process.env.CPH_COPILOT_AGENT_ID;
  });

  afterEach(() => {
    if (originalEnvAgent !== undefined) {
      process.env.CPH_COPILOT_AGENT_ID = originalEnvAgent;
    } else {
      delete process.env.CPH_COPILOT_AGENT_ID;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("1. parseCliArgs with Agent and Model flags", () => {
    it("should parse --agent / -a flag and normalize raw url or id", () => {
      const rawId = "T_agent_999";
      const resUrl = parseCliArgs(["--agent", `https://m365.cloud.microsoft/chat/agent/${rawId}`]);
      expect(resUrl.customAgentId).toBe(rawId);

      const resShort = parseCliArgs(["-a", rawId]);
      expect(resShort.customAgentId).toBe(rawId);

      const resEq = parseCliArgs([`--agent=https://m365.cloud.microsoft/chat/agent/${rawId}`]);
      expect(resEq.customAgentId).toBe(rawId);

      const resShortEq = parseCliArgs([`-a=${rawId}`]);
      expect(resShortEq.customAgentId).toBe(rawId);
    });

    it("should parse --model / -m flag and support tone aliases", () => {
      const res1 = parseCliArgs(["--model", "Precise"]);
      expect(res1.modelTone).toBe("Precise");

      const res2 = parseCliArgs(["-m", "Creative"]);
      expect(res2.modelTone).toBe("Creative");

      const res3 = parseCliArgs(["--tone", "Balanced"]);
      expect(res3.modelTone).toBe("Balanced");

      const res4 = parseCliArgs(["--model-tone=Gpt_61_Sol_Reasoning"]);
      expect(res4.modelTone).toBe("Gpt_61_Sol_Reasoning");

      const resDefault = parseCliArgs([]);
      expect(resDefault.modelTone).toBe("Gpt_61_Sol_Reasoning");
    });
  });

  describe("2. Workspace Config Persistence (.cph/config.json)", () => {
    it("should load customAgentId and modelTone from .cph/config.json", () => {
      const configPath = path.join(tmpDir, ".cph", "config.json");
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.writeFileSync(
        configPath,
        JSON.stringify({ customAgentId: "T_saved_agent", modelTone: "Precise" }),
        "utf-8"
      );

      const cli = new CphPiCli({ workspace: tmpDir });
      expect((cli as any).customAgentId).toBe("T_saved_agent");
      expect((cli as any).modelTone).toBe("Precise");
      expect(cli.getOrchestrator().getCustomAgentId()).toBe("T_saved_agent");
      expect(cli.getOrchestrator().isHandshakePending).toBe(false);
    });

    it("should respect resolution priority: CLI explicit > ENV > .cph/config.json", () => {
      const configPath = path.join(tmpDir, ".cph", "config.json");
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.writeFileSync(
        configPath,
        JSON.stringify({ customAgentId: "T_config_agent", modelTone: "Balanced" }),
        "utf-8"
      );

      // Case A: ENV overrides config
      process.env.CPH_COPILOT_AGENT_ID = "T_env_agent";
      const cliEnv = new CphPiCli({ workspace: tmpDir });
      expect((cliEnv as any).customAgentId).toBe("T_env_agent");

      // Case B: CLI explicit argument overrides both ENV and config
      const cliExplicit = new CphPiCli({
        workspace: tmpDir,
        customAgentId: "T_explicit_agent",
        modelTone: "Creative",
      });
      expect((cliExplicit as any).customAgentId).toBe("T_explicit_agent");
      expect((cliExplicit as any).modelTone).toBe("Creative");
    });
  });

  describe("3. Interactive Commands: /agent and /model", () => {
    it("should handle /agent command to switch, view and clear agent", async () => {
      const cli = new CphPiCli({ workspace: tmpDir });

      // Switch to new agent
      (cli as any).handleAgentCommand("https://m365.cloud.microsoft/chat/agent/T_new_agent_123");
      expect((cli as any).customAgentId).toBe("T_new_agent_123");
      expect(cli.getOrchestrator().getCustomAgentId()).toBe("T_new_agent_123");
      expect(cli.getOrchestrator().isHandshakePending).toBe(false);

      // Verify persistence in .cph/config.json
      const config = JSON.parse(
        fs.readFileSync(path.join(tmpDir, ".cph", "config.json"), "utf-8")
      );
      expect(config.customAgentId).toBe("T_new_agent_123");

      // Clear agent binding
      (cli as any).handleAgentCommand("clear");
      expect((cli as any).customAgentId).toBeUndefined();
      expect(cli.getOrchestrator().getCustomAgentId()).toBeUndefined();
      expect(cli.getOrchestrator().isHandshakePending).toBe(true);

      const clearedConfig = JSON.parse(
        fs.readFileSync(path.join(tmpDir, ".cph", "config.json"), "utf-8")
      );
      expect(clearedConfig.customAgentId).toBeUndefined();
    });

    it("should handle /model command to dynamically update tone and persist", async () => {
      const cli = new CphPiCli({ workspace: tmpDir });
      (cli as any).handleModelCommand("Precise");

      expect((cli as any).modelTone).toBe("Precise");
      const config = JSON.parse(
        fs.readFileSync(path.join(tmpDir, ".cph", "config.json"), "utf-8")
      );
      expect(config.modelTone).toBe("Precise");
    });

    it("should output custom agent status in /status diagnostic card", () => {
      const cli = new CphPiCli({
        workspace: tmpDir,
        customAgentId: "T_diag_agent_456",
      });

      const card = cli.getDiagnosticCard();
      expect(card).toContain("专属智能体:");
      expect(card).toContain("T_diag_agent_456");
      expect(card).toContain("Gpt_61_Sol_Reasoning");

      const cliDefault = new CphPiCli({ workspace: tmpDir });
      const defaultCard = cliDefault.getDiagnosticCard();
      expect(defaultCard).toContain("专属智能体:");
      expect(defaultCard).toContain("无 (通用模式)");
    });
  });
});
