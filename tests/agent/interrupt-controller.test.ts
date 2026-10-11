import { describe, it, expect, beforeEach, mock } from "bun:test";
import {
  InterruptController,
  type InterruptResult,
} from "../../src/agent/interrupt-controller.ts";

describe("InterruptController Unit Tests", () => {
  let promptExitCalls: string[];
  let exitCalls: number;
  let abortCalls: number;
  let controller: InterruptController;

  beforeEach(() => {
    promptExitCalls = [];
    exitCalls = 0;
    abortCalls = 0;

    controller = new InterruptController({
      idleExitTimeoutMs: 1500,
      onPromptExit: (msg) => promptExitCalls.push(msg),
      onExit: () => exitCalls++,
      onOperationAborted: () => abortCalls++,
      autoAttach: false,
    });
  });

  describe("1. Busy State Interruption (Streaming / Tool Execution)", () => {
    it("should abort active signal and preserve process when busy", () => {
      const abortCtrl = controller.beginBusy();
      expect(controller.isBusy()).toBe(true);
      expect(abortCtrl.signal.aborted).toBe(false);

      const res = controller.handleSigint();

      expect(res.action).toBe("aborted_operation");
      expect(abortCtrl.signal.aborted).toBe(true);
      expect(abortCalls).toBe(1);
      expect(exitCalls).toBe(0);
      expect(promptExitCalls.length).toBe(0);
    });

    it("should allow ending busy state and returning to idle mode", () => {
      controller.beginBusy();
      expect(controller.isBusy()).toBe(true);

      controller.endBusy();
      expect(controller.isBusy()).toBe(false);
      expect(controller.getActiveSignal()).toBeUndefined();
    });

    it("should handle repeated SIGINTs while busy without exiting", () => {
      const abortCtrl = controller.beginBusy();

      const res1 = controller.handleSigint();
      const res2 = controller.handleSigint();

      expect(res1.action).toBe("aborted_operation");
      expect(res2.action).toBe("aborted_operation");
      expect(abortCtrl.signal.aborted).toBe(true);
      expect(abortCalls).toBe(2);
      expect(exitCalls).toBe(0);
    });
  });

  describe("2. Idle State Single Tap & Exit Prompt", () => {
    it("should prompt user on first Ctrl+C in idle state", () => {
      expect(controller.isBusy()).toBe(false);

      const res = controller.handleSigint();

      expect(res.action).toBe("exit_prompted");
      expect(res.message).toContain("再次按 Ctrl+C 退出");
      expect(promptExitCalls.length).toBe(1);
      expect(promptExitCalls[0]).toBe("再次按 Ctrl+C 退出");
      expect(exitCalls).toBe(0);
      expect(abortCalls).toBe(0);
      expect(controller.getLastIdleSigintTime()).toBeGreaterThan(0);
    });
  });

  describe("3. Idle State Double Tap (< 1.5s) Exit Confirmation", () => {
    it("should confirm exit when Ctrl+C is pressed twice within 1500ms", async () => {
      const res1 = controller.handleSigint();
      expect(res1.action).toBe("exit_prompted");

      // Short delay within window
      await new Promise((r) => setTimeout(r, 50));

      const res2 = controller.handleSigint();
      expect(res2.action).toBe("exit_confirmed");
      expect(exitCalls).toBe(1);
      expect(controller.getLastIdleSigintTime()).toBe(0);
    });
  });

  describe("4. Idle State Timeout Reset (> 1.5s)", () => {
    it("should reset timer and prompt again if second press exceeds timeout", async () => {
      const fastController = new InterruptController({
        idleExitTimeoutMs: 100, // 100ms timeout window for fast test
        onPromptExit: (msg) => promptExitCalls.push(msg),
        onExit: () => exitCalls++,
        autoAttach: false,
      });

      const res1 = fastController.handleSigint();
      expect(res1.action).toBe("exit_prompted");

      // Wait beyond the 100ms timeout
      await new Promise((r) => setTimeout(r, 130));

      const res2 = fastController.handleSigint();
      // Should NOT confirm exit; should be treated as a new first tap
      expect(res2.action).toBe("exit_prompted");
      expect(exitCalls).toBe(0);
      expect(promptExitCalls.length).toBe(2);
    });

    it("should support manual timer reset via resetIdleTimer", () => {
      controller.handleSigint();
      expect(controller.getLastIdleSigintTime()).toBeGreaterThan(0);

      controller.resetIdleTimer();
      expect(controller.getLastIdleSigintTime()).toBe(0);
    });
  });

  describe("5. Process Listener Lifecycle (Attach & Detach)", () => {
    it("should safely attach and detach without throwing", () => {
      const testController = new InterruptController({ autoAttach: false });

      expect(() => testController.attach()).not.toThrow();
      // Second attach should be idempotent
      expect(() => testController.attach()).not.toThrow();

      expect(() => testController.detach()).not.toThrow();
      // Second detach should be idempotent
      expect(() => testController.detach()).not.toThrow();
    });
  });
});
