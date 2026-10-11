import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { CphPiCli, parseCliArgs } from "../../src/cli.ts";
import { AccountPool } from "../../src/auth/account-pool.ts";
import { TokenManager, type StoredAccount } from "../../src/auth/token-manager.ts";

class TestTokenManager extends TokenManager {
  private accounts: StoredAccount[] = [
    { email: "GSC.VFU2@cma-cgm.com", refreshToken: "t1" },
    { email: "GSC.DDAI@cma-cgm.com", refreshToken: "t2" },
    { email: "GSC.MLU@cma-cgm.com", refreshToken: "t3" },
    { email: "GSC.LISLIU@cma-cgm.com", refreshToken: "t4" },
  ];

  public override loadAccounts(): StoredAccount[] {
    return this.accounts;
  }
}

describe("CLI Accounts Management & Whitelist Configuration Tests", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cph-cli-acc-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it("1. parseCliArgs should parse --accounts flag with comma/space separated list", () => {
    const args1 = parseCliArgs(["--accounts", "GSC.VFU2@cma-cgm.com,GSC.DDAI@cma-cgm.com"]);
    expect(args1.allowedAccounts).toEqual(["GSC.VFU2@cma-cgm.com", "GSC.DDAI@cma-cgm.com"]);

    const args2 = parseCliArgs(["--accounts=GSC.VFU2@cma-cgm.com,GSC.DDAI@cma-cgm.com"]);
    expect(args2.allowedAccounts).toEqual(["GSC.VFU2@cma-cgm.com", "GSC.DDAI@cma-cgm.com"]);

    const args3 = parseCliArgs(["-acc", "GSC.VFU2@cma-cgm.com GSC.DDAI@cma-cgm.com"]);
    expect(args3.allowedAccounts).toEqual(["GSC.VFU2@cma-cgm.com", "GSC.DDAI@cma-cgm.com"]);
  });

  it("2. CphPiCli should load allowedAccounts from .cph/config.json and filter pool", () => {
    const cphDir = path.join(tmpDir, ".cph");
    fs.mkdirSync(cphDir, { recursive: true });
    fs.writeFileSync(
      path.join(cphDir, "config.json"),
      JSON.stringify({
        allowedAccounts: ["GSC.VFU2@cma-cgm.com", "GSC.DDAI@cma-cgm.com"],
      }),
      "utf8"
    );

    const pool = new AccountPool(new TestTokenManager());
    const cli = new CphPiCli({
      workspaceRoot: tmpDir,
      pool,
    });

    const allowed = pool.getAllowedAccounts();
    expect(allowed?.length).toBe(2);
    expect(pool.isAccountAllowed("GSC.VFU2@cma-cgm.com")).toBe(true);
    expect(pool.isAccountAllowed("GSC.MLU@cma-cgm.com")).toBe(false);

    cli.close();
  });

  it("3. /accounts command should display accounts list with checkmarks", () => {
    const pool = new AccountPool(new TestTokenManager(), {
      allowedAccounts: ["GSC.VFU2@cma-cgm.com", "GSC.DDAI@cma-cgm.com"],
    });
    const cli = new CphPiCli({
      workspaceRoot: tmpDir,
      pool,
    });

    const output = (cli as any).formatAccountsList();
    expect(output).toContain("GSC.VFU2@cma-cgm.com");
    expect(output).toContain("GSC.DDAI@cma-cgm.com");
    expect(output).toContain("GSC.MLU@cma-cgm.com");
    expect(output).toContain("[✓]"); // Enabled
    expect(output).toContain("[ ]"); // Skipped

    cli.close();
  });

  it("4. /accounts set command should update whitelist and persist to .cph/config.json", () => {
    const pool = new AccountPool(new TestTokenManager());
    const cli = new CphPiCli({
      workspaceRoot: tmpDir,
      pool,
    });

    (cli as any).handleAccountsCommand("set GSC.VFU2@cma-cgm.com, GSC.DDAI@cma-cgm.com");

    expect(pool.isAccountAllowed("GSC.VFU2@cma-cgm.com")).toBe(true);
    expect(pool.isAccountAllowed("GSC.DDAI@cma-cgm.com")).toBe(true);
    expect(pool.isAccountAllowed("GSC.MLU@cma-cgm.com")).toBe(false);

    const configPath = path.join(tmpDir, ".cph", "config.json");
    expect(fs.existsSync(configPath)).toBe(true);
    const saved = JSON.parse(fs.readFileSync(configPath, "utf8"));
    expect(saved.allowedAccounts).toEqual(["GSC.VFU2@cma-cgm.com", "GSC.DDAI@cma-cgm.com"]);

    cli.close();
  });

  it("5. /accounts enable and /accounts disable commands should update whitelist", () => {
    const pool = new AccountPool(new TestTokenManager(), {
      allowedAccounts: ["GSC.VFU2@cma-cgm.com"],
    });
    const cli = new CphPiCli({
      workspaceRoot: tmpDir,
      pool,
    });

    // Enable DDAI
    (cli as any).handleAccountsCommand("enable GSC.DDAI@cma-cgm.com");
    expect(pool.isAccountAllowed("GSC.DDAI@cma-cgm.com")).toBe(true);

    // Disable VFU2
    (cli as any).handleAccountsCommand("disable GSC.VFU2@cma-cgm.com");
    expect(pool.isAccountAllowed("GSC.VFU2@cma-cgm.com")).toBe(false);

    const configPath = path.join(tmpDir, ".cph", "config.json");
    const saved = JSON.parse(fs.readFileSync(configPath, "utf8"));
    expect(saved.allowedAccounts).toEqual(["GSC.DDAI@cma-cgm.com"]);

    cli.close();
  });

  it("6. /accounts reset command should clear whitelist and persist undefined", () => {
    const pool = new AccountPool(new TestTokenManager(), {
      allowedAccounts: ["GSC.VFU2@cma-cgm.com"],
    });
    const cli = new CphPiCli({
      workspaceRoot: tmpDir,
      pool,
    });

    (cli as any).handleAccountsCommand("reset");
    expect(pool.getAllowedAccounts()).toBeUndefined();
    expect(pool.isAccountAllowed("GSC.MLU@cma-cgm.com")).toBe(true);

    const configPath = path.join(tmpDir, ".cph", "config.json");
    const saved = JSON.parse(fs.readFileSync(configPath, "utf8"));
    expect(saved.allowedAccounts).toBeUndefined();

    cli.close();
  });
});

