# CPH-PI 自适应流式保活与超时容灾自治接力实施计划 (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 彻底解决长任务因 120s 绝对墙钟超时中断被丢弃的问题：重构 ChatHub 传输层为基于流式活跃的自适应看门狗（持续输出永不断连），并将超时与网络中断异常纳入调度层三段式容灾接力体系，实现长耗时代码审查无人值守自治完成。

**Architecture:**
1. 在 `ChatHubClient` 中建立双轨超时：90s `idleTimeoutMs` 仅在完全无数据帧时触发（每次接收 Delta 活跃重置），单轮总兜底超时提升至 600s 并支持参数配置；
2. 在 `Orchestrator` 中引入 `isRecoverableTransportError`，统一识别 429 频控、请求超时（`timed out`）与套接字断连（`ECONNRESET`），自动提取崩断轮次现场与 `.cph/review_draft.md` 生成接力交接文档；
3. 在 `CliApp` 中扩展 `--timeout` 参数并与无人值守自治接力闭环连通。

**Tech Stack:** TypeScript, Bun Test, WebSocket, SignalR Hub Protocol, Node/Bun Stream

**Reference Spec:** [`.docs/specs/2026-10-11-cph-pi-adaptive-timeout-and-disaster-recovery-design.md`](file:///E:/copilot-web%20proxy/CPH-PI/.docs/specs/2026-10-11-cph-pi-adaptive-timeout-and-disaster-recovery-design.md)

---

## Global Constraints

- 绝不在 Harness 代码中给模型擦屁股或编写特化补丁，仅做中立的协议传输与容灾状态机流转。
- 所有系统提示词与 Skill 严禁引入负面禁止词，保持正向目标引导。
- 遵循 TDD 规范：每个任务必须先编写红灯测试，运行失败后再编写最小实现，最后绿灯提交。
- 全量回归测试必须 100% 通过（0 失败）。

---

### Task 1: ChatHubClient 传输层流式活跃保活重构 (TDD)

**Files:**
- Create: `tests/transport/activity-keepalive.test.ts`
- Modify: `src/transport/chathub-client.ts:20-40,185-205`

**Interfaces:**
- Consumes: `ChatHubOptions.timeoutMs`, `ChatHubOptions.idleTimeoutMs`
- Produces: `ChatHubClient.sendMessage` with dynamic activity timer reset on every incoming SignalR frame and delta

- [ ] **Step 1: Write the failing test**

```ts
// tests/transport/activity-keepalive.test.ts
import { describe, it, expect } from "bun:test";
import { ChatHubClient } from "../../src/transport/chathub-client.ts";

describe("ChatHubClient Activity Keepalive & Dual-Track Timeout", () => {
  it("should default timeoutMs to 600,000ms (10 minutes) instead of 120,000ms", () => {
    const client = new ChatHubClient({
      id: "test",
      email: "test@example.com",
      authCookie: "dummy",
      substrateToken: "dummy",
      token: "dummy",
      expiresAt: Date.now() + 3600000,
    });
    // Check client options
    expect((client as any).options.timeoutMs).toBe(600_000);
    expect((client as any).options.idleTimeoutMs).toBe(90_000);
  });

  it("should respect custom timeoutMs and idleTimeoutMs override", () => {
    const client = new ChatHubClient(
      {
        id: "test",
        email: "test@example.com",
        authCookie: "dummy",
        substrateToken: "dummy",
        token: "dummy",
        expiresAt: Date.now() + 3600000,
      },
      {
        timeoutMs: 300_000,
        idleTimeoutMs: 45_000,
      }
    );
    expect((client as any).options.timeoutMs).toBe(300_000);
    expect((client as any).options.idleTimeoutMs).toBe(45_000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/transport/activity-keepalive.test.ts`
Expected: FAIL (`expected 600000 but got 120000`)

- [ ] **Step 3: Implement minimal code in `src/transport/chathub-client.ts`**

Update `ChatHubClient` constructor default options:
```ts
      timeoutMs: options?.timeoutMs ?? 600_000,
      idleTimeoutMs: options?.idleTimeoutMs ?? 90_000,
```
And in `sendMessage`: ensure `resetIdleTimer()` is invoked every time WebSocket receives incoming data or streaming delta.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/transport/activity-keepalive.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/transport/activity-keepalive.test.ts src/transport/chathub-client.ts
git commit -m "feat(transport): upgrade default timeout to 600s and enforce activity keepalive reset"
```

---

### Task 2: Orchestrator 统一可恢复灾难感知与超时容灾接力 (TDD)

**Files:**
- Create: `tests/agent/timeout-disaster-recovery.test.ts`
- Modify: `src/agent/orchestrator.ts:400-435`

**Interfaces:**
- Consumes: `ChatHubClient` error events containing `timed out`, `ECONNRESET`, or `429`
- Produces: `isRecoverableTransportError(err: any): boolean`, `executeDisasterRecoveryArbitration` invoked on timeout

- [ ] **Step 1: Write the failing test**

```ts
// tests/agent/timeout-disaster-recovery.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { CopilotOrchestrator } from "../../src/agent/orchestrator.ts";

describe("Orchestrator Timeout Disaster Recovery", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "cph-timeout-recovery-test-"));
  });

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("should classify timeout errors as recoverable transport errors", () => {
    const orchestrator = new CopilotOrchestrator({ workspaceRoot: tempDir });
    expect(orchestrator.isRecoverableTransportError(new Error("ChatHub request timed out after 120s without completion"))).toBe(true);
    expect(orchestrator.isRecoverableTransportError(new Error("ChatHub connection idle timeout: no data received"))).toBe(true);
    expect(orchestrator.isRecoverableTransportError(new Error("read ECONNRESET"))).toBe(true);
    expect(orchestrator.isRecoverableTransportError(new Error("HTTP 429 Too Many Requests"))).toBe(true);
    expect(orchestrator.isRecoverableTransportError(new Error("Generic Syntax Error"))).toBe(false);
  });

  it("should trigger disaster recovery arbitration when sendMessage throws a timeout error", async () => {
    const mockClient = {
      sendMessage: async () => {
        throw new Error("ChatHub request timed out after 120s without completion");
      },
    };

    const orchestrator = new CopilotOrchestrator({
      workspaceRoot: tempDir,
      client: mockClient as any,
    });

    const result = await orchestrator.run({
      task: "深度代码审查任务",
    });

    expect(result.completed).toBe(false);
    expect(result.handedOff).toBe(true);
    expect(result.disasterRecovered).toBe(true);
    expect(result.disasterBlackbox).toBeDefined();
    expect(result.disasterBlackbox?.lastError).toContain("ChatHub request timed out");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/agent/timeout-disaster-recovery.test.ts`
Expected: FAIL (`isRecoverableTransportError is not a function` or throws timeout instead of returning `disasterRecovered`)

- [ ] **Step 3: Implement minimal code in `src/agent/orchestrator.ts`**

Add public method `isRecoverableTransportError(err: any): boolean`:
```ts
  public isRecoverableTransportError(err: any): boolean {
    if (!err) return false;
    const msg = String(err?.message || err || "").toLowerCase();
    const isRateLimit =
      msg.includes("429") ||
      msg.includes("throttled") ||
      msg.includes("rate limit") ||
      msg.includes("quota") ||
      msg.includes("exceeded") ||
      msg.includes("too many requests");
    const isTimeout =
      msg.includes("timed out") ||
      msg.includes("timeout") ||
      msg.includes("idle timeout");
    const isNetBreak =
      msg.includes("econnreset") ||
      msg.includes("etimedout") ||
      msg.includes("epipe") ||
      msg.includes("closed before") ||
      msg.includes("premature close") ||
      msg.includes("socket hang up");
    return isRateLimit || isTimeout || isNetBreak;
  }
```
Update `run()` error catch block:
```ts
        if (this.isRecoverableTransportError(err)) {
          return await this.executeDisasterRecoveryArbitration({
            task,
            history,
            client,
            lastError: String(err?.message || err),
            signal,
            events,
            sessionId,
            arbitratorChatClient: options.arbitratorChatClient,
          });
        }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/agent/timeout-disaster-recovery.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/agent/timeout-disaster-recovery.test.ts src/agent/orchestrator.ts
git commit -m "feat(orchestrator): extend disaster recovery to cover timeouts and network drops"
```

---

### Task 3: CliApp 命令行 `--timeout` 参数透传与系统集成测试 (TDD)

**Files:**
- Create: `tests/cli/timeout-arg-and-continuation.test.ts`
- Modify: `src/cli.ts:1515-1550,1650-1700`

**Interfaces:**
- Consumes: CLI args `--timeout <seconds>` or `-t <seconds>`
- Produces: `parsedArgs.timeoutSec`, passed to `CopilotOrchestrator` and `ChatHubClient`

- [ ] **Step 1: Write the failing test**

```ts
// tests/cli/timeout-arg-and-continuation.test.ts
import { describe, it, expect } from "bun:test";
import { CliApp } from "../../src/cli.ts";

describe("CLI --timeout Arguments & Orchestrator Configuration", () => {
  it("should parse --timeout and -t CLI flags", () => {
    const app = new CliApp({ workspaceRoot: "." });
    const parsed1 = (app as any).parseArgs(["--timeout", "300"]);
    expect(parsed1.timeoutSec).toBe(300);

    const parsed2 = (app as any).parseArgs(["-t", "450"]);
    expect(parsed2.timeoutSec).toBe(450);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/cli/timeout-arg-and-continuation.test.ts`
Expected: FAIL (`expected 300 but got undefined`)

- [ ] **Step 3: Implement minimal code in `src/cli.ts`**

Update `parseArgs` in `src/cli.ts`:
```ts
      if (arg === "--timeout" || arg === "-t") {
        const val = parseInt(args[++i], 10);
        if (!isNaN(val) && val > 0) {
          result.timeoutSec = val;
        }
      }
```
And wire `options.timeoutMs = result.timeoutSec ? result.timeoutSec * 1000 : 600_000` into `ChatHubClient` and `Orchestrator`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/cli/timeout-arg-and-continuation.test.ts`
Expected: PASS

- [ ] **Step 5: Run all test suites across the repository to ensure zero regression**

Run: `bun test`
Expected: All 420+ tests pass with 0 failures.

- [ ] **Step 6: Commit**

```bash
git add tests/cli/timeout-arg-and-continuation.test.ts src/cli.ts
git commit -m "feat(cli): support --timeout flag and forward to orchestrator client"
```

