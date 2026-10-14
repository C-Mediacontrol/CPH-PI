import { describe, it, expect } from "bun:test";
import { parseCliArgs, getHelpText } from "../../src/cli.ts";

describe("CLI Argument Polymorphism & Parsing Suite (CR-4)", () => {
  describe("1. -t Polymorphism: Timeout vs Task Description", () => {
    it("should parse -t 30 as numeric timeoutSec", () => {
      const parsed = parseCliArgs(["-t", "30"]);
      expect(parsed.timeoutSec).toBe(30);
      expect(parsed.task).toBeUndefined();
    });

    it("should parse -t with string as task prompt", () => {
      const parsed = parseCliArgs(["-t", "修复登录逻辑"]);
      expect(parsed.task).toBe("修复登录逻辑");
      expect(parsed.timeoutSec).toBeUndefined();
    });

    it("should parse -t=30 as numeric timeoutSec", () => {
      const parsed = parseCliArgs(["-t=30"]);
      expect(parsed.timeoutSec).toBe(30);
      expect(parsed.task).toBeUndefined();
    });

    it("should parse -t=任务 as task prompt", () => {
      const parsed = parseCliArgs(["-t=修复登录逻辑"]);
      expect(parsed.task).toBe("修复登录逻辑");
      expect(parsed.timeoutSec).toBeUndefined();
    });

    it("should parse -t 60 with following positional task", () => {
      const parsed = parseCliArgs(["-t", "60", "重构认证模块", "并编写单测"]);
      expect(parsed.timeoutSec).toBe(60);
      expect(parsed.task).toBe("重构认证模块 并编写单测");
    });

    it("should parse standard --timeout and --task flags", () => {
      const parsed = parseCliArgs(["--timeout", "120", "--task", "性能压测分析"]);
      expect(parsed.timeoutSec).toBe(120);
      expect(parsed.task).toBe("性能压测分析");

      const parsedEq = parseCliArgs(["--timeout=180", "--task=安全审计"]);
      expect(parsedEq.timeoutSec).toBe(180);
      expect(parsedEq.task).toBe("安全审计");
    });
  });

  describe("2. Debug Flag & Log Path Polymorphism", () => {
    it("should parse --debug and -d as boolean flags without path", () => {
      const res1 = parseCliArgs(["--debug"]);
      expect(res1.debug).toBe(true);
      expect(res1.debugLogPath).toBeUndefined();

      const res2 = parseCliArgs(["-d"]);
      expect(res2.debug).toBe(true);
      expect(res2.debugLogPath).toBeUndefined();
    });

    it("should parse --debug and -d with path argument", () => {
      const res1 = parseCliArgs(["--debug", "./custom.log"]);
      expect(res1.debug).toBe(true);
      expect(res1.debugLogPath).toBe("./custom.log");

      const res2 = parseCliArgs(["-d", "logs/terminal.txt"]);
      expect(res2.debug).toBe(true);
      expect(res2.debugLogPath).toBe("logs/terminal.txt");

      const res3 = parseCliArgs(["--debug=E:/logs/debug.log"]);
      expect(res3.debug).toBe(true);
      expect(res3.debugLogPath).toBe("E:/logs/debug.log");
    });

    it("should parse --log and --log-file flags", () => {
      const res1 = parseCliArgs(["--log", "./runtime.log"]);
      expect(res1.debug).toBe(true);
      expect(res1.debugLogPath).toBe("./runtime.log");

      const res2 = parseCliArgs(["--log-file=./custom.log"]);
      expect(res2.debug).toBe(true);
      expect(res2.debugLogPath).toBe("./custom.log");
    });
  });

  describe("3. Workspace, Agent, Coder, Researcher & Accounts Flags", () => {
    it("should parse workspace flags -w and --workspace", () => {
      const res1 = parseCliArgs(["-w", "/custom/workspace"]);
      expect(res1.workspaceRoot).toBe("/custom/workspace");

      const res2 = parseCliArgs(["--workspace=/another/dir"]);
      expect(res2.workspaceRoot).toBe("/another/dir");
    });

    it("should parse --agent and -a flags with URLs or raw IDs", () => {
      const rawId = "T_9ace94c8-cb78-caab-ddf7-4ae2d8f5a40d.93a3fbbc-c122-4a07-b670-857581a51135.gpt.94067efc-1741-4e5f-a603-b0573efa2852";
      const res1 = parseCliArgs(["--agent", rawId]);
      expect(res1.customAgentId).toBe(rawId);
      expect(res1.hasExplicitAgent).toBe(true);

      const res2 = parseCliArgs([`-a=${rawId}`]);
      expect(res2.customAgentId).toBe(rawId);
      expect(res2.hasExplicitAgent).toBe(true);
    });

    it("should parse --coder-agent and --researcher-agent flags", () => {
      const coderId = "coder-agent-001";
      const researcherId = "researcher-agent-002";
      const res = parseCliArgs([
        "--coder-agent", coderId,
        "--researcher-agent", researcherId,
      ]);
      expect(res.coderAgentId).toBe(coderId);
      expect(res.researcherAgentId).toBe(researcherId);

      const resEq = parseCliArgs([
        `--coder-agent-id=${coderId}`,
        `--researcher-agent-id=${researcherId}`,
      ]);
      expect(resEq.coderAgentId).toBe(coderId);
      expect(resEq.researcherAgentId).toBe(researcherId);
    });

    it("should parse --accounts and -acc with comma and space delimiters", () => {
      const res1 = parseCliArgs(["--accounts", "acc1@cma-cgm.com,acc2@cma-cgm.com"]);
      expect(res1.allowedAccounts).toEqual(["acc1@cma-cgm.com", "acc2@cma-cgm.com"]);

      const res2 = parseCliArgs(["-acc", "acc1@cma-cgm.com acc2@cma-cgm.com acc3@cma-cgm.com"]);
      expect(res2.allowedAccounts).toEqual([
        "acc1@cma-cgm.com",
        "acc2@cma-cgm.com",
        "acc3@cma-cgm.com",
      ]);

      const res3 = parseCliArgs(["--accounts=acc1@cma-cgm.com, acc2@cma-cgm.com"]);
      expect(res3.allowedAccounts).toEqual(["acc1@cma-cgm.com", "acc2@cma-cgm.com"]);
    });

    it("should parse --max-turns, --max-hops, and --hops", () => {
      const res = parseCliArgs(["--max-turns", "25", "--max-hops", "12"]);
      expect(res.maxTurns).toBe(25);
      expect(res.maxAutonomousHandoffHops).toBe(12);

      const resHops = parseCliArgs(["--hops=7"]);
      expect(resHops.maxAutonomousHandoffHops).toBe(7);
    });

    it("should parse continuation flags --continue and --resume", () => {
      const res1 = parseCliArgs(["-c"]);
      expect(res1.continueLast).toBe(true);

      const res2 = parseCliArgs(["--resume", "ses_test_abc"]);
      expect(res2.resumeSessionId).toBe("ses_test_abc");

      const res3 = parseCliArgs(["--resume=ses_test_xyz"]);
      expect(res3.resumeSessionId).toBe("ses_test_xyz");
    });
  });

  describe("4. getHelpText", () => {
    it("should render formatted help text containing usage and key options", () => {
      const help = getHelpText();
      expect(help).toContain("CPH-PI");
      expect(help).toContain("-t, --timeout");
      expect(help).toContain("--max-hops");
      expect(help).toContain("/resume");
      expect(help).toContain("/accounts");
    });
  });
});

