import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { parseCliArgs, runCli, CphPiCli, runCliPkceAuthFlow } from "../../src/cli.ts";
import { AccountPool } from "../../src/auth/account-pool.ts";
import { TokenManager, type StoredAccount } from "../../src/auth/token-manager.ts";

class DummyTokenManager extends TokenManager {
  private accounts: StoredAccount[];

  constructor(accounts?: StoredAccount[]) {
    super();
    this.accounts = accounts || [
      { email: "user1@contoso.com", refreshToken: "tok1" },
      { email: "user2@contoso.com", refreshToken: "tok2" },
    ];
  }

  public override loadAccounts(): StoredAccount[] {
    return this.accounts;
  }

  public override saveAccounts(accs: StoredAccount[]): void {
    this.accounts = accs;
  }
}

describe("CLI Auth & PKCE Integration Tests (Task 7)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cph-auth-cli-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  describe("1. parseCliArgs Subcommand & Non-Pollution (C3 Fix)", () => {
    it("should parse auth login with email without polluting positional or task", () => {
      const parsed = parseCliArgs(["auth", "login", "user@contoso.com"]);
      expect(parsed.subcommand).toBe("auth");
      expect(parsed.authAction).toBe("login");
      expect(parsed.authTargetEmail).toBe("user@contoso.com");
      expect(parsed.task).toBeUndefined();
      expect(parsed.positional).toEqual([]);
    });

    it("should parse auth subcommand alone", () => {
      const parsed = parseCliArgs(["auth"]);
      expect(parsed.subcommand).toBe("auth");
      expect(parsed.authAction).toBeUndefined();
      expect(parsed.authTargetEmail).toBeUndefined();
      expect(parsed.task).toBeUndefined();
      expect(parsed.positional).toEqual([]);
    });

    it("should parse auth login without target email", () => {
      const parsed = parseCliArgs(["auth", "login"]);
      expect(parsed.subcommand).toBe("auth");
      expect(parsed.authAction).toBe("login");
      expect(parsed.authTargetEmail).toBeUndefined();
      expect(parsed.task).toBeUndefined();
      expect(parsed.positional).toEqual([]);
    });

    it("should parse auth subcommand with flags without positional pollution", () => {
      const parsed = parseCliArgs(["auth", "login", "user@contoso.com", "--debug"]);
      expect(parsed.subcommand).toBe("auth");
      expect(parsed.authAction).toBe("login");
      expect(parsed.authTargetEmail).toBe("user@contoso.com");
      expect(parsed.debug).toBe(true);
      expect(parsed.task).toBeUndefined();
      expect(parsed.positional).toEqual([]);
    });
  });

  describe("2. formatAccountsList Auth Expired Badge", () => {
    it("should display red auth expired prompt badge when an account has authExpired: true", () => {
      const pool = new AccountPool(new DummyTokenManager());
      pool.markAuthExpired("user1@contoso.com", "AADSTS50076: MFA required");

      const cli = new CphPiCli({
        workspaceRoot: tmpDir,
        pool,
      });

      const output = cli.formatAccountsList();
      expect(output).toContain("🔒 凭据已失效 (执行 /accounts login user1@contoso.com 刷新)");

      cli.close();
    });
  });

  describe("3. runCliPkceAuthFlow & Interactive /accounts login", () => {
    it("should complete PKCE flow successfully when user provides valid redirect url", async () => {
      const pool = new AccountPool(new DummyTokenManager());
      const mockSession = {
        authSessionId: "sess-123",
        authUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=xyz",
        state: "state-abc",
      };

      const startSpy = spyOn(pool, "startPkceAuth").mockReturnValue(mockSession);
      const completeSpy = spyOn(pool, "completePkceAuth").mockResolvedValue({
        success: true,
        email: "user1@contoso.com",
        expectedEmail: "user1@contoso.com",
        emailMismatch: false,
      });

      const fakeRl = {
        question: (_prompt: string, cb: (ans: string) => void) => {
          cb("http://localhost:3000/callback?code=fake-auth-code&state=state-abc");
        },
      } as any;

      const success = await runCliPkceAuthFlow(pool, "user1@contoso.com", fakeRl);
      expect(success).toBe(true);
      expect(startSpy).toHaveBeenCalledWith("user1@contoso.com");
      expect(completeSpy).toHaveBeenCalled();
    });

    it("should handle email mismatch and display alert", async () => {
      const pool = new AccountPool(new DummyTokenManager());
      spyOn(pool, "startPkceAuth").mockReturnValue({
        authSessionId: "sess-456",
        authUrl: "https://login.microsoftonline.com/auth",
        state: "state-xyz",
      });
      spyOn(pool, "completePkceAuth").mockResolvedValue({
        success: true,
        email: "actual-user@contoso.com",
        expectedEmail: "intended-user@contoso.com",
        emailMismatch: true,
      });

      const fakeRl = {
        question: (_prompt: string, cb: (ans: string) => void) => {
          cb("fake-code");
        },
      } as any;

      const success = await runCliPkceAuthFlow(pool, "intended-user@contoso.com", fakeRl);
      expect(success).toBe(true);
    });

    it("should handle interactive /accounts login command", async () => {
      const pool = new AccountPool(new DummyTokenManager());
      spyOn(pool, "startPkceAuth").mockReturnValue({
        authSessionId: "sess-789",
        authUrl: "https://login.microsoftonline.com/auth",
        state: "state-789",
      });
      spyOn(pool, "completePkceAuth").mockResolvedValue({
        success: true,
        email: "user2@contoso.com",
        emailMismatch: false,
      });

      const fakeRl = {
        question: (_prompt: string, cb: (ans: string) => void) => {
          cb("http://localhost:3000/callback?code=mock-code");
        },
        close: () => {},
      } as any;

      const cli = new CphPiCli({
        workspaceRoot: tmpDir,
        pool,
        rl: fakeRl,
      });

      await cli.handleAccountsCommand("login user2@contoso.com");
      cli.close();
    });
  });

  describe("4. runCli Direct Subcommand Execution", () => {
    it("should execute runCli with auth login subcommand", async () => {
      const pool = new AccountPool(new DummyTokenManager());
      spyOn(pool, "startPkceAuth").mockReturnValue({
        authSessionId: "sess-sub",
        authUrl: "https://login.microsoftonline.com/auth",
        state: "state-sub",
      });
      spyOn(pool, "completePkceAuth").mockResolvedValue({
        success: true,
        email: "user1@contoso.com",
        emailMismatch: false,
      });

      const fakeRl = {
        question: (_prompt: string, cb: (ans: string) => void) => {
          cb("code-sub");
        },
        close: () => {},
      } as any;

      const result = await runCli(["auth", "login", "user1@contoso.com"], {
        workspaceRoot: tmpDir,
        pool,
        rl: fakeRl,
      });

      expect(result.mode).toBe("auth");
      expect(result.exitCode).toBe(0);
    });
  });
});
