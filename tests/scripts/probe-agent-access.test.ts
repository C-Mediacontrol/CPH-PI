import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  probeAccountAccess,
  probeAllAccounts,
  probeAllAccountsTriAgent,
  formatProbeReport,
  formatProbeMatrixReport,
  resolveAgentTarget,
  DEFAULT_MAIN_AGENT_ID,
  DEFAULT_CODER_AGENT_ID,
  DEFAULT_RESEARCHER_AGENT_ID,
  type ProbeAccountResult,
  type TriAgentMatrixResult,
} from "../../scripts/probe-agent-access.ts";
import { TokenManager, type StoredAccount } from "../../src/auth/token-manager.ts";

class MockTokenManager extends TokenManager {
  private accounts: StoredAccount[];

  constructor(accounts: StoredAccount[]) {
    super();
    this.accounts = accounts;
  }

  public override loadAccounts(): StoredAccount[] {
    return this.accounts;
  }

  public override async getAccessToken(account: StoredAccount): Promise<string> {
    return `mock-token-${account.email}`;
  }
}

describe("Agent Multi-Account Access Probe Suite", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cph-probe-test-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it("1. should classify PASS, FORBIDDEN, NOT_AVAILABLE and THROTTLED statuses accurately", async () => {
    const mockAccounts: StoredAccount[] = [
      { email: "GSC.VFU2@cma-cgm.com", refreshToken: "r1" },
      { email: "GSC.DDAI@cma-cgm.com", refreshToken: "r2" },
      { email: "GSC.LISLIU@cma-cgm.com", refreshToken: "r3" },
      { email: "GSC.MLU@cma-cgm.com", refreshToken: "r4" },
    ];

    const mockSender = async (email: string) => {
      if (email === "GSC.VFU2@cma-cgm.com") {
        return { text: "Hello from CPH-Dev agent!" };
      }
      if (email === "GSC.DDAI@cma-cgm.com") {
        const err: any = new Error("Rate limit exceeded 429");
        err.errorCode = "Throttled";
        throw err;
      }
      if (email === "GSC.LISLIU@cma-cgm.com") {
        const err: any = new Error("[GptAccessForbidden] Agent access forbidden");
        err.errorCode = "GptAccessForbidden";
        throw err;
      }
      if (email === "GSC.MLU@cma-cgm.com") {
        const err: any = new Error("[GptNotAvailable] Agent not available");
        err.errorCode = "GptNotAvailable";
        throw err;
      }
      throw new Error("Unknown");
    };

    const results = await probeAllAccounts({
      agentId: "T_test_agent",
      tokenManager: new MockTokenManager(mockAccounts),
      sendProbeMessage: mockSender,
      workspaceRoot: tmpDir,
    });

    expect(results.length).toBe(4);

    const vfu2 = results.find((r) => r.email === "GSC.VFU2@cma-cgm.com")!;
    expect(vfu2.status).toBe("PASS");
    expect(vfu2.isEligible).toBe(true);

    const ddai = results.find((r) => r.email === "GSC.DDAI@cma-cgm.com")!;
    expect(ddai.status).toBe("THROTTLED");
    expect(ddai.isEligible).toBe(true); // Throttled still has permissions

    const lisliu = results.find((r) => r.email === "GSC.LISLIU@cma-cgm.com")!;
    expect(lisliu.status).toBe("FORBIDDEN");
    expect(lisliu.isEligible).toBe(false);

    const mlu = results.find((r) => r.email === "GSC.MLU@cma-cgm.com")!;
    expect(mlu.status).toBe("NOT_AVAILABLE");
    expect(mlu.isEligible).toBe(false);
  });

  it("2. should automatically apply eligible accounts to .cph/config.json when apply=true", async () => {
    const mockAccounts: StoredAccount[] = [
      { email: "GSC.VFU2@cma-cgm.com", refreshToken: "r1" },
      { email: "GSC.LISLIU@cma-cgm.com", refreshToken: "r2" },
      { email: "GSC.DDAI@cma-cgm.com", refreshToken: "r3" },
    ];

    const mockSender = async (email: string) => {
      if (email === "GSC.VFU2@cma-cgm.com" || email === "GSC.DDAI@cma-cgm.com") {
        return { text: "OK" };
      }
      const err: any = new Error("[GptAccessForbidden] No access");
      err.errorCode = "GptAccessForbidden";
      throw err;
    };

    const results = await probeAllAccounts({
      agentId: "T_test_agent",
      tokenManager: new MockTokenManager(mockAccounts),
      sendProbeMessage: mockSender,
      workspaceRoot: tmpDir,
      apply: true,
    });

    const configPath = path.join(tmpDir, ".cph", "config.json");
    expect(fs.existsSync(configPath)).toBe(true);
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));

    expect(config.allowedAccounts).toEqual([
      "GSC.VFU2@cma-cgm.com",
      "GSC.DDAI@cma-cgm.com",
    ]);
  });

  it("3. formatProbeReport should generate clean markdown & terminal summary table", () => {
    const mockResults: ProbeAccountResult[] = [
      {
        email: "GSC.VFU2@cma-cgm.com",
        status: "PASS",
        isEligible: true,
        durationMs: 420,
      },
      {
        email: "GSC.DDAI@cma-cgm.com",
        status: "THROTTLED",
        isEligible: true,
        durationMs: 310,
        errorMessage: "429 Too Many Requests",
      },
      {
        email: "GSC.LISLIU@cma-cgm.com",
        status: "FORBIDDEN",
        isEligible: false,
        durationMs: 250,
        errorMessage: "GptAccessForbidden",
      },
      {
        email: "GSC.MLU@cma-cgm.com",
        status: "NOT_AVAILABLE",
        isEligible: false,
        durationMs: 200,
        errorMessage: "GptNotAvailable",
      },
    ];

    const report = formatProbeReport(mockResults, "T_9feac605_test");
    expect(report).toContain("GSC.VFU2@cma-cgm.com");
    expect(report).toContain("GSC.DDAI@cma-cgm.com");
    expect(report).toContain("GSC.LISLIU@cma-cgm.com");
    expect(report).toContain("GSC.MLU@cma-cgm.com");
    expect(report).toContain("可授权/建议勾选");
    expect(report).toContain("未授权/需跳过");
  });

  it("4. should safely call tokenManager.getActiveSessionToken without method missing error", async () => {
    const manager = new TokenManager();
    const fakeSession: any = {
      email: "mock@domain.com",
      accessToken: "mock_jwt",
      refreshToken: "rt",
      expiresAt: Date.now() + 600_000,
      oid: "oid",
      tid: "tid",
    };
    manager.setCachedToken("mock@domain.com", fakeSession);

    // Should not throw "getActiveSessionToken is not a function"
    const res = await probeAccountAccess(
      { email: "mock@domain.com", refreshToken: "plain" },
      "T_test_agent",
      {
        tokenManager: manager,
        timeoutMs: 100, // rapid timeout
      }
    );
    expect(res.errorMessage).not.toContain("getActiveSessionToken is not a function");
  });

  it("5. probeAllAccountsTriAgent should evaluate accounts against all 3 agents (Main, Coder, Researcher)", async () => {
    const mockAccounts: StoredAccount[] = [
      { email: "full@corp.com", refreshToken: "r1" },
      { email: "partial@corp.com", refreshToken: "r2" },
      { email: "none@corp.com", refreshToken: "r3" },
    ];

    const mockSender = async (email: string, agentId: string) => {
      if (email === "full@corp.com") {
        return { text: "OK: All agents supported" };
      }
      if (email === "partial@corp.com") {
        if (agentId.includes("9ace94c8") || agentId.includes("main")) {
          return { text: "OK: Main only" };
        }
        const err: any = new Error("[GptAccessForbidden] No access to subagent");
        err.errorCode = "GptAccessForbidden";
        throw err;
      }
      const err: any = new Error("[GptAccessForbidden] No access");
      err.errorCode = "GptAccessForbidden";
      throw err;
    };

    const matrix = await probeAllAccountsTriAgent({
      tokenManager: new MockTokenManager(mockAccounts),
      sendProbeMessage: mockSender,
      workspaceRoot: tmpDir,
      apply: true,
    });

    expect(matrix.length).toBe(3);

    const fullAcc = matrix.find((m) => m.email === "full@corp.com")!;
    expect(fullAcc.isFullEligible).toBe(true);
    expect(fullAcc.main.isEligible).toBe(true);
    expect(fullAcc.coder.isEligible).toBe(true);
    expect(fullAcc.researcher.isEligible).toBe(true);

    const partialAcc = matrix.find((m) => m.email === "partial@corp.com")!;
    expect(partialAcc.isFullEligible).toBe(false);
    expect(partialAcc.main.isEligible).toBe(true);
    expect(partialAcc.coder.isEligible).toBe(false);

    const noneAcc = matrix.find((m) => m.email === "none@corp.com")!;
    expect(noneAcc.isFullEligible).toBe(false);

    // Verify .cph/config.json with apply: true
    const configPath = path.join(tmpDir, ".cph", "config.json");
    expect(fs.existsSync(configPath)).toBe(true);
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    expect(config.allowedAccounts).toEqual(["full@corp.com"]);
    expect(config.customAgentId).toBeDefined();
    expect(config.coderAgentId).toBeDefined();
    expect(config.researcherAgentId).toBeDefined();
  });

  it("6. formatProbeMatrixReport should render a multi-column Tri-Agent dashboard", () => {
    const mockMatrix: TriAgentMatrixResult[] = [
      {
        email: "alice@corp.com",
        isFullEligible: true,
        main: { email: "alice@corp.com", status: "PASS", isEligible: true, durationMs: 120 },
        coder: { email: "alice@corp.com", status: "PASS", isEligible: true, durationMs: 130 },
        researcher: { email: "alice@corp.com", status: "PASS", isEligible: true, durationMs: 140 },
      },
      {
        email: "bob@corp.com",
        isFullEligible: false,
        main: { email: "bob@corp.com", status: "PASS", isEligible: true, durationMs: 100 },
        coder: { email: "bob@corp.com", status: "FORBIDDEN", isEligible: false, durationMs: 80, errorMessage: "GptAccessForbidden" },
        researcher: { email: "bob@corp.com", status: "PASS", isEligible: true, durationMs: 90 },
      },
    ];

    const report = formatProbeMatrixReport(mockMatrix);
    expect(report).toContain("Tri-Agent");
    expect(report).toContain("alice@corp.com");
    expect(report).toContain("bob@corp.com");
    expect(report).toContain("全就绪");
    expect(report).toContain("局部受限");
    expect(report).toContain("推荐白名单配置");
  });

  it("7. resolveAgentTarget should resolve role names ('main', 'coder', 'researcher') to default IDs", () => {
    const resMain = resolveAgentTarget("main");
    expect(resMain.isTriAgent).toBe(false);
    expect(resMain.agentId).toBe(DEFAULT_MAIN_AGENT_ID);
    expect(resMain.roleName).toBe("Main 主协调智能体");

    const resCoder = resolveAgentTarget("coder");
    expect(resCoder.isTriAgent).toBe(false);
    expect(resCoder.agentId).toBe(DEFAULT_CODER_AGENT_ID);

    const resResearcher = resolveAgentTarget("researcher");
    expect(resResearcher.isTriAgent).toBe(false);
    expect(resResearcher.agentId).toBe(DEFAULT_RESEARCHER_AGENT_ID);

    const resDefault = resolveAgentTarget(undefined);
    expect(resDefault.isTriAgent).toBe(true);
  });
});


