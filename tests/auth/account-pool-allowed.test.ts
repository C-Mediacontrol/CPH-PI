import { describe, it, expect, beforeEach } from "bun:test";
import { AccountPool } from "../../src/auth/account-pool.ts";
import { TokenManager, type StoredAccount } from "../../src/auth/token-manager.ts";

class MockTokenManager extends TokenManager {
  private mockAccounts: StoredAccount[] = [];

  constructor(accounts: StoredAccount[]) {
    super();
    this.mockAccounts = accounts;
  }

  public override loadAccounts(): StoredAccount[] {
    return this.mockAccounts;
  }

  public override async getAccessToken(email: string): Promise<any> {
    const acc = this.mockAccounts.find(
      (a) => a.email.toLowerCase() === email.toLowerCase()
    );
    if (!acc) throw new Error(`Not found: ${email}`);
    return {
      email: acc.email,
      accessToken: "mock-token-" + acc.email,
      refreshToken: "plain-refresh",
      expiresAt: Date.now() + 3600_000,
      oid: "oid-" + acc.email,
      tid: "tid-common",
    };
  }
}

describe("AccountPool Allowed Accounts Whitelist (账号勾选过滤与跳过特性)", () => {
  const sampleAccounts: StoredAccount[] = [
    { email: "GSC.VFU2@cma-cgm.com", refreshToken: "tok1" },
    { email: "GSC.MLU@cma-cgm.com", refreshToken: "tok2" },
    { email: "GSC.CYLI@cma-cgm.com", refreshToken: "tok3" },
    { email: "GSC.MIYMAO@cma-cgm.com", refreshToken: "tok4" },
    { email: "GSC.LISLIU@cma-cgm.com", refreshToken: "tok5" },
    { email: "GSC.DDAI@cma-cgm.com", refreshToken: "tok6" },
  ];

  let manager: MockTokenManager;
  let pool: AccountPool;

  beforeEach(() => {
    manager = new MockTokenManager(sampleAccounts);
    pool = new AccountPool(manager);
  });

  it("1. 默认情况下所有已登记账号均处于勾选启用状态", () => {
    expect(pool.getAllowedAccounts()).toBeUndefined();
    const status = pool.getPoolStatus();
    expect(status.length).toBe(6);
    expect(status.every((s) => s.isAllowed)).toBe(true);
  });

  it("2. setAllowedAccounts 过滤：仅允许被勾选的账号参与轮转，未勾选账号自动跳过", async () => {
    // 仅勾选 VFU2 与 DDAI（其余 4 个账号未勾选，默认跳过）
    pool.setAllowedAccounts(["GSC.VFU2@cma-cgm.com", "GSC.DDAI@cma-cgm.com"]);

    expect(pool.getAllowedAccounts()?.length).toBe(2);
    expect(pool.isAccountAllowed("GSC.VFU2@cma-cgm.com")).toBe(true);
    expect(pool.isAccountAllowed("gsc.ddai@cma-cgm.com")).toBe(true); // 大小写不敏感
    expect(pool.isAccountAllowed("GSC.MLU@cma-cgm.com")).toBe(false);

    // 验证 Round-Robin 仅在 VFU2 与 DDAI 之间循环
    const t1 = await pool.getNextAvailableToken();
    expect(t1.email).toBe("GSC.VFU2@cma-cgm.com");

    const t2 = await pool.getNextAvailableToken();
    expect(t2.email).toBe("GSC.DDAI@cma-cgm.com");

    const t3 = await pool.getNextAvailableToken();
    expect(t3.email).toBe("GSC.VFU2@cma-cgm.com"); // 再次循环回 VFU2，完全跳过 MLU/CYLI 等未勾选账号
  });

  it("3. 当勾选账号遭遇 429 频控时，敏捷切换至另一勾选账号", async () => {
    pool.setAllowedAccounts(["GSC.VFU2@cma-cgm.com", "GSC.DDAI@cma-cgm.com"]);

    // 标记 VFU2 频控
    pool.markThrottled("GSC.VFU2@cma-cgm.com");

    // 应当直接调度 DDAI，绝不调度未勾选的 MLU
    const token = await pool.getNextAvailableToken();
    expect(token.email).toBe("GSC.DDAI@cma-cgm.com");
  });

  it("4. 当所有勾选账号均频控时，抛出包含勾选账号计数的清晰异常", async () => {
    pool.setAllowedAccounts(["GSC.VFU2@cma-cgm.com", "GSC.DDAI@cma-cgm.com"]);

    pool.markThrottled("GSC.VFU2@cma-cgm.com");
    pool.markThrottled("GSC.DDAI@cma-cgm.com");

    expect(pool.getNextAvailableToken()).rejects.toThrow(/All 2 allowed account\(s\)/);
  });

  it("5. 支持动态 enableAccount / disableAccount 单个账号管理", async () => {
    // 初始勾选 VFU2
    pool.setAllowedAccounts(["GSC.VFU2@cma-cgm.com"]);
    expect(pool.isAccountAllowed("GSC.DDAI@cma-cgm.com")).toBe(false);

    // 动态勾选启用 DDAI
    pool.enableAccount("GSC.DDAI@cma-cgm.com");
    expect(pool.isAccountAllowed("GSC.DDAI@cma-cgm.com")).toBe(true);

    // 动态禁用跳过 VFU2
    pool.disableAccount("GSC.VFU2@cma-cgm.com");
    expect(pool.isAccountAllowed("GSC.VFU2@cma-cgm.com")).toBe(false);

    // 此时仅 DDAI 启用
    const token = await pool.getNextAvailableToken();
    expect(token.email).toBe("GSC.DDAI@cma-cgm.com");
  });

  it("6. 清空勾选白名单重置为全量可用", async () => {
    pool.setAllowedAccounts(["GSC.VFU2@cma-cgm.com"]);
    expect(pool.getAllowedAccounts()?.length).toBe(1);

    pool.setAllowedAccounts(null); // 重置
    expect(pool.getAllowedAccounts()).toBeUndefined();
    expect(pool.isAccountAllowed("GSC.MLU@cma-cgm.com")).toBe(true);
  });

  it("7. getPoolStatus 包含每个账号的 isAllowed 启用状态透视", () => {
    pool.setAllowedAccounts(["GSC.VFU2@cma-cgm.com", "GSC.DDAI@cma-cgm.com"]);
    const status = pool.getPoolStatus();

    const vfu2 = status.find((s) => s.email.toLowerCase() === "gsc.vfu2@cma-cgm.com");
    const mlu = status.find((s) => s.email.toLowerCase() === "gsc.mlu@cma-cgm.com");
    const ddai = status.find((s) => s.email.toLowerCase() === "gsc.ddai@cma-cgm.com");

    expect(vfu2?.isAllowed).toBe(true);
    expect(ddai?.isAllowed).toBe(true);
    expect(mlu?.isAllowed).toBe(false);
  });
});

