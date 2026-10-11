/**
 * Two-stage Safe Interrupt Controller for CPH-PI.
 *
 * Implements:
 * 1. Busy state (streaming generation or tool execution):
 *    - Intercepts first SIGINT (Ctrl+C);
 *    - Triggers AbortSignal to abort network stream / kill child processes;
 *    - Preserves session conversation history and context;
 *    - Immediately returns to input/waiting mode without exiting the process.
 * 2. Idle state:
 *    - First SIGINT prompts "再次按 Ctrl+C 退出";
 *    - If pressed again within 1.5s (1500ms), triggers exit confirmation / process termination;
 *    - If timeout expires, resets the timer so a single tap later only prompts again.
 */

export type InterruptAction = "aborted_operation" | "exit_prompted" | "exit_confirmed";

export interface InterruptResult {
  action: InterruptAction;
  message: string;
  timestamp: number;
}

export interface InterruptControllerOptions {
  /**
   * Timeout window in milliseconds to confirm exit during idle state (default: 1500ms).
   */
  idleExitTimeoutMs?: number;

  /**
   * Callback invoked when a single Ctrl+C is pressed during idle state.
   */
  onPromptExit?: (message: string) => void;

  /**
   * Callback invoked when Ctrl+C is pressed twice within timeout window during idle state.
   */
  onExit?: () => void;

  /**
   * Callback invoked when Ctrl+C is intercepted during busy state.
   */
  onOperationAborted?: () => void;

  /**
   * Whether to automatically attach to process.on("SIGINT") upon creation.
   */
  autoAttach?: boolean;
}

export class InterruptController {
  private isBusyState: boolean = false;
  private activeAbortController?: AbortController;
  private lastIdleSigintTime: number = 0;
  private idleExitTimeoutMs: number;
  private isAttached: boolean = false;
  private boundSigintHandler?: () => void;
  private options: InterruptControllerOptions;

  constructor(options: InterruptControllerOptions = {}) {
    this.options = options;
    this.idleExitTimeoutMs = options.idleExitTimeoutMs ?? 1500;

    if (options.autoAttach) {
      this.attach();
    }
  }

  /**
   * Marks the controller as busy, creating a fresh AbortController for the ongoing operation.
   * Resets any idle exit timer so previous keystrokes do not leak into busy state.
   */
  public beginBusy(): AbortController {
    this.isBusyState = true;
    this.activeAbortController = new AbortController();
    this.lastIdleSigintTime = 0;
    return this.activeAbortController;
  }

  /**
   * Marks the operation as complete and returns the controller to idle state.
   */
  public endBusy(): void {
    this.isBusyState = false;
    this.activeAbortController = undefined;
    this.lastIdleSigintTime = 0;
  }

  /**
   * Returns whether the controller is currently in busy (running) state.
   */
  public isBusy(): boolean {
    return this.isBusyState;
  }

  /**
   * Returns the currently active AbortSignal if busy, or undefined if idle.
   */
  public getActiveSignal(): AbortSignal | undefined {
    return this.activeAbortController?.signal;
  }

  /**
   * Handles a SIGINT event (Ctrl+C).
   *
   * In busy state:
   *   - Immediately signals abort;
   *   - Does not exit the process;
   *   - Returns "aborted_operation".
   *
   * In idle state:
   *   - If within timeout window since previous press, confirms exit ("exit_confirmed");
   *   - Otherwise, records timestamp and prompts user ("exit_prompted").
   */
  public handleSigint(): InterruptResult {
    const now = Date.now();

    // 1. Busy state: abort current operation and stay in process
    if (this.isBusyState) {
      if (this.activeAbortController && !this.activeAbortController.signal.aborted) {
        this.activeAbortController.abort();
      }
      this.options.onOperationAborted?.();
      return {
        action: "aborted_operation",
        message: "操作已中止，保留会话并返回交互等待模式",
        timestamp: now,
      };
    }

    // 2. Idle state: check double Ctrl+C within timeout
    if (this.lastIdleSigintTime > 0 && (now - this.lastIdleSigintTime) <= this.idleExitTimeoutMs) {
      this.lastIdleSigintTime = 0;
      if (this.options.onExit) {
        this.options.onExit();
      } else {
        process.exit(0);
      }
      return {
        action: "exit_confirmed",
        message: "确认退出终端",
        timestamp: now,
      };
    }

    // First Ctrl+C during idle
    this.lastIdleSigintTime = now;
    const promptMsg = "再次按 Ctrl+C 退出";
    this.options.onPromptExit?.(promptMsg);
    return {
      action: "exit_prompted",
      message: promptMsg,
      timestamp: now,
    };
  }

  /**
   * Manually resets the idle exit timer.
   */
  public resetIdleTimer(): void {
    this.lastIdleSigintTime = 0;
  }

  /**
   * Returns the timestamp of the last idle SIGINT press.
   */
  public getLastIdleSigintTime(): number {
    return this.lastIdleSigintTime;
  }

  /**
   * Attaches to process.on("SIGINT").
   */
  public attach(): void {
    if (this.isAttached) return;
    this.boundSigintHandler = () => {
      this.handleSigint();
    };
    process.on("SIGINT", this.boundSigintHandler);
    this.isAttached = true;
  }

  /**
   * Detaches from process.on("SIGINT").
   */
  public detach(): void {
    if (!this.isAttached) return;
    if (this.boundSigintHandler) {
      process.off("SIGINT", this.boundSigintHandler);
      this.boundSigintHandler = undefined;
    }
    this.isAttached = false;
  }
}
