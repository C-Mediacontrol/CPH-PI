import fs from "node:fs";
import path from "node:path";
import type { LedgerEntry } from "./ledger-entry.ts";

export class ExecutionLedger {
  private workspaceRoot: string;
  private stateDir: string;
  private jsonlPath: string;
  private mdPath: string;
  private currentStepIndex: number = 0;
  private cachedEntries: LedgerEntry[] = [];

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
    this.stateDir = path.join(this.workspaceRoot, ".cph", "state");
    this.jsonlPath = path.join(this.stateDir, "execution-ledger.jsonl");
    this.mdPath = path.join(this.stateDir, "execution-ledger.md");

    this.initFromDisk();
  }

  public getPaths(): { jsonlPath: string; mdPath: string } {
    return {
      jsonlPath: this.jsonlPath,
      mdPath: this.mdPath,
    };
  }

  private initFromDisk(): void {
    try {
      if (!fs.existsSync(this.stateDir)) {
        fs.mkdirSync(this.stateDir, { recursive: true });
      }

      if (fs.existsSync(this.jsonlPath)) {
        const lines = fs
          .readFileSync(this.jsonlPath, "utf8")
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean);

        for (const line of lines) {
          try {
            const entry = JSON.parse(line) as LedgerEntry;
            this.cachedEntries.push(entry);
            if (entry.stepIndex > this.currentStepIndex) {
              this.currentStepIndex = entry.stepIndex;
            }
          } catch {
            // 忽略损坏的单行
          }
        }
      }
    } catch (err) {
      console.error(`[ExecutionLedger] 初始化读取异常:`, err);
    }
  }

  public recordStep(
    input: Omit<LedgerEntry, "stepIndex" | "timestamp">
  ): LedgerEntry {
    this.currentStepIndex += 1;
    const entry: LedgerEntry = {
      ...input,
      stepIndex: this.currentStepIndex,
      timestamp: Date.now(),
      briefSummary: (input.briefSummary || "").slice(0, 300),
    };

    this.cachedEntries.push(entry);

    try {
      if (!fs.existsSync(this.stateDir)) {
        fs.mkdirSync(this.stateDir, { recursive: true });
      }

      // 1. 追加写 JSONL (Crash-consistent, append-only)
      fs.appendFileSync(this.jsonlPath, JSON.stringify(entry) + "\n", "utf8");

      // 2. 增量渲染 Markdown 表格视图
      this.writeMarkdownView();
    } catch (err) {
      // 保证无阻塞原则：账本 I/O 错误绝不中断业务
      console.error(`[ExecutionLedger] 账本落盘告警:`, err);
    }

    return entry;
  }

  public getLatestEntries(limit?: number): LedgerEntry[] {
    if (limit && limit > 0) {
      return this.cachedEntries.slice(-limit);
    }
    return [...this.cachedEntries];
  }

  public formatMountHeader(): string {
    const totalSteps = this.currentStepIndex;
    const modifiedFiles = new Set<string>();
    let latestBadge = "NONE";

    for (const e of this.cachedEntries) {
      if (e.modifiedFiles && Array.isArray(e.modifiedFiles)) {
        for (const f of e.modifiedFiles) {
          modifiedFiles.add(f);
        }
      }
      if (e.statusBadge) {
        latestBadge = e.statusBadge;
      }
    }

    const filesSummary =
      modifiedFiles.size > 0
        ? `[${Array.from(modifiedFiles).slice(0, 5).join(", ")}${
            modifiedFiles.size > 5 ? `, ...+${modifiedFiles.size - 5}` : ""
          }]`
        : "无";

    const relativeMdPath = path
      .relative(this.workspaceRoot, this.mdPath)
      .replace(/\\/g, "/");

    return [
      `【系统物理执行账本已挂载】`,
      `- 账本路径: ${relativeMdPath || ".cph/state/execution-ledger.md"}`,
      `- 累计物理操作: ${totalSteps} 步 | 核心变更文件: ${filesSummary}`,
      `- 最新验证状态: ${latestBadge}`,
      `- 查阅契约: 上述客观事实已由系统物理验证。如需回溯某一步的详细改动或命令输出，请使用 read_file / view_file 工具定向查看账本文件，严禁在对话流中全量回放日志。`,
    ].join("\n");
  }

  private writeMarkdownView(): void {
    const header = [
      `# CPH 物理执行账本 (Execution Ledger)`,
      `- 更新时间: ${new Date().toISOString()}`,
      `- 累计物理步骤: ${this.currentStepIndex} 步`,
      ``,
      `| 步数 | 角色 | 工具 | 目标/动作 | 状态 | 关键指标/结果 |`,
      `|---|---|---|---|---|---|`,
    ];

    const rows = this.cachedEntries.map((e) => {
      const cleanTarget = (e.target || "-").replace(/\|/g, "\\|").slice(0, 50);
      const cleanBadge = (e.statusBadge || e.briefSummary || "-")
        .replace(/\|/g, "\\|")
        .replace(/\r?\n/g, " ")
        .slice(0, 60);
      return `| ${e.stepIndex} | ${e.role} | ${e.tool} | ${cleanTarget} | ${e.status} | ${cleanBadge} |`;
    });

    const content = header.concat(rows).join("\n") + "\n";
    fs.writeFileSync(this.mdPath, content, "utf8");
  }
}
