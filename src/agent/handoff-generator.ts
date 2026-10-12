import path from "node:path";
import fs from "node:fs";
import type { TurnRecord } from "./orchestrator.ts";

export interface HandoffGeneratorParams {
  task: string;
  history: TurnRecord[];
  sessionId?: string;
  workspaceRoot: string;
  pendingTask?: string;
}

export interface HandoffGeneratorResult {
  document: string;
  handoffDocPath?: string;
}

export class HandoffDocumentGenerator {
  /**
   * Helper to extract key error message from tool output without context bloat.
   */
  public static extractKeyError(output: string): string {
    if (!output) return "（无错误输出）";
    const lines = output.split(/\r?\n/);
    const keyLines: string[] = [];

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;
      if (
        /error|exception|failed|fatal|cannot find|not found|denied|未找到|失败|TypeNotFound|CommandNotFound|InvalidOperation|ExitCode|No \.NET/i.test(
          line
        )
      ) {
        keyLines.push(line.length > 200 ? `${line.slice(0, 197)}...` : line);
        if (keyLines.length >= 4) break;
      }
    }

    if (keyLines.length > 0) {
      return keyLines.join("\n");
    }

    // Fallback: take head of output
    const cleanOutput = output.trim().replace(/\r?\n/g, " ");
    return cleanOutput.length > 200 ? `${cleanOutput.slice(0, 197)}...` : cleanOutput;
  }

  /**
   * Generates a 5-dimensional high-fidelity structured handoff document,
   * summarizing task goals, verified facts, critical blockers, file modifications, and actionable next steps.
   * Automatically persists document to <workspaceRoot>/.cph/handoffs/handoff-<sessionId>.md.
   */
  public static generate(params: HandoffGeneratorParams): HandoffGeneratorResult {
    const { task, history, sessionId, workspaceRoot, pendingTask } = params;
    const effectiveSessionId = sessionId || "";
    const safeSessionId = path.basename(effectiveSessionId).replace(/[^a-zA-Z0-9_-]/g, "_");
    const cleanTask =
      task || pendingTask || (history[0]?.userInput ? history[0].userInput : "未指定任务需求");

    let lastHandoffDocPath: string | undefined;

    // 0. File-First Handoff: if the model has already written the handoff document directly via write_file,
    // honor and return the model's authentic document without secondary wrapping!
    if (effectiveSessionId && workspaceRoot) {
      try {
        const docPath = path.join(workspaceRoot, ".cph", "handoffs", `handoff-${safeSessionId}.md`);
        if (fs.existsSync(docPath)) {
          const existingDoc = fs.readFileSync(docPath, "utf8").trim();
          if (existingDoc.length > 50) {
            return {
              document: existingDoc,
              handoffDocPath: docPath,
            };
          }
        }
      } catch {
        // Fallback to synthesizing snapshot
      }
    }

    // Module 1: 【任务目标与原始需求】
    const taskSection = [
      `- **原始任务**: ${cleanTask}`,
      `- **工作区根目录**: \`${workspaceRoot}\``,
      effectiveSessionId ? `- **会话标识**: \`${effectiveSessionId}\`` : "",
    ]
      .filter(Boolean)
      .join("\n");

    // Module 2: 【已验证客观事实与阶段性成果】
    const executedActions: string[] = [];
    const recentFindings: string[] = [];
    const successfulRecords = history.filter((h) => h.toolName && h.success !== false);
    const readFiles = new Set<string>();
    const executedCmds: string[] = [];
    let editWriteCount = 0;

    for (const record of history) {
      if (record.toolName) {
        let details = "";
        if (record.action?.command) {
          details = ` \`${record.action.command.length > 80 ? `${record.action.command.slice(0, 77)}...` : record.action.command}\``;
        } else if (record.action?.path || record.action?.filePath) {
          details = ` \`${record.action.path || record.action.filePath}\``;
        }
        const status = record.success !== false ? "成功" : "失败";
        executedActions.push(`- Turn ${record.turn}: [${status}] ${record.toolName}${details}`);
      }
      if (record.toolOutput) {
        const cleanOutput = record.toolOutput.trim().replace(/\r?\n/g, " ");
        const preview = cleanOutput.length > 120 ? `${cleanOutput.slice(0, 117)}...` : cleanOutput;
        recentFindings.push(`- Turn ${record.turn} (${record.toolName || "tool"}): ${preview}`);
      }
    }

    for (const r of successfulRecords) {
      const tool = (r.toolName || r.action?.tool || "").toLowerCase();
      const filePath = r.action?.path || r.action?.filePath || r.action?.file;
      if (["read_file", "read", "cat"].includes(tool) && filePath) {
        readFiles.add(filePath);
      } else if (["edit", "edit_file", "patch_file", "write", "write_file"].includes(tool)) {
        editWriteCount++;
      } else if (["run_command", "bash", "exec"].includes(tool)) {
        if (r.action?.command) {
          executedCmds.push(r.action.command);
        }
      }
    }

    let verifiedFactsSection = "";
    if (history.length === 0) {
      verifiedFactsSection = `- （暂无已执行的物理动作成果）\n\n**已执行动作清单**:\n- 无已执行的物理工具调用\n\n**最近工具发现与上下文**:\n- 暂无显著工具发现`;
    } else {
      const parts: string[] = [];

      if (successfulRecords.length > 0) {
        parts.push(
          `- **物理工具执行汇总**: 共成功执行 ${successfulRecords.length} 项动作（读取 ${readFiles.size} 处、修改/创建 ${editWriteCount} 处、运行命令 ${executedCmds.length} 次）`
        );

        if (readFiles.size > 0) {
          parts.push(`- **已成功读取/探测的项目模块**:`);
          for (const file of Array.from(readFiles).slice(0, 15)) {
            parts.push(`  - \`${file}\``);
          }
        }

        if (executedCmds.length > 0) {
          parts.push(`- **已验证执行的基准命令**:`);
          for (const cmd of executedCmds.slice(0, 8)) {
            const preview = cmd.length > 100 ? `${cmd.slice(0, 97)}...` : cmd;
            parts.push(`  - \`${preview}\``);
          }
        }

        const insightfulThoughts = history
          .filter((h) => h.thought && /(盘点|验证|确认|发现|成功|完成)/.test(h.thought))
          .map((h) => h.thought!.trim());
        if (insightfulThoughts.length > 0) {
          parts.push(`- **关键阶段性结论与发现**:`);
          for (const thought of insightfulThoughts.slice(-3)) {
            const preview = thought.length > 120 ? `${thought.slice(0, 117)}...` : thought;
            parts.push(`  - ${preview}`);
          }
        }
      } else if (executedActions.length === 0) {
        parts.push(`- （暂无已执行的物理动作成果；已完成 ${history.length} 轮对话探索研讨）`);
      }

      // Preserve actions list and recent findings for backward compatibility and full auditability
      parts.push(``);
      parts.push(`**已执行动作清单**:`);
      parts.push(executedActions.length > 0 ? executedActions.join("\n") : "- 无已执行的物理工具调用");
      parts.push(``);
      parts.push(`**最近工具发现与上下文**:`);
      parts.push(recentFindings.length > 0 ? recentFindings.slice(-5).join("\n") : "- 暂无显著工具发现");

      verifiedFactsSection = parts.join("\n");
    }

    // Module 3: 【关键卡点、报错与最新诊断】
    const failedRecords = history.filter((h) => h.toolName && h.success === false);
    let blockersSection = "";

    if (failedRecords.length === 0) {
      blockersSection = `- （当前会话运行健康，无关键错误卡点与失败调用）`;
    } else {
      const parts: string[] = [
        `- **卡点与失败动作清单** (共 ${failedRecords.length} 次执行失败):`,
      ];

      for (const h of failedRecords.slice(-5)) {
        const target = h.action?.command
          ? `\`${h.action.command.length > 80 ? `${h.action.command.slice(0, 77)}...` : h.action.command}\``
          : h.action?.path
          ? `\`${h.action.path}\``
          : "";
        parts.push(`  - **Turn ${h.turn} [${h.toolName || "tool"}]** ${target}:`);
        const keyErr = HandoffDocumentGenerator.extractKeyError(h.toolOutput || "");
        for (const errLine of keyErr.split("\n")) {
          parts.push(`    > ${errLine}`);
        }
      }

      const diagnosticThoughts = history
        .filter((h) => h.thought && /(提权|缺失|无法|失败|原因|由于|检测到|卡点)/.test(h.thought))
        .map((h) => h.thought!.trim());
      if (diagnosticThoughts.length > 0) {
        parts.push(`- **模型最新诊断原因分析**:`);
        for (const d of diagnosticThoughts.slice(-3)) {
          const preview = d.length > 140 ? `${d.slice(0, 137)}...` : d;
          parts.push(`  - ${preview}`);
        }
      }

      blockersSection = parts.join("\n");
    }

    // Module 4: 【已修改/生成文件清单】
    const modifiedFiles = new Map<string, string>();
    for (const h of history) {
      const tool = (h.toolName || h.action?.tool || "").toLowerCase();
      const filePath = h.action?.path || h.action?.filePath || h.action?.file;
      if (["edit", "edit_file", "patch_file"].includes(tool) && filePath) {
        modifiedFiles.set(filePath, "已修改 (edit)");
      } else if (["write", "write_file"].includes(tool) && filePath) {
        modifiedFiles.set(filePath, "已创建 (write_file)");
      } else if (["run_command", "bash"].includes(tool) && h.action?.command) {
        const cmd = h.action.command;
        const redirMatch = cmd.match(/>\s*['"]?([^'">\s|&;]+\.[a-zA-Z0-9]+)['"]?/);
        if (redirMatch && redirMatch[1]) {
          modifiedFiles.set(redirMatch[1], "重定向输出生成");
        }
      }
    }

    let modifiedFilesSection = "";
    if (modifiedFiles.size === 0) {
      modifiedFilesSection = `- （会话期间未修改或新建文件，主要为只读探测）`;
    } else {
      const parts: string[] = [];
      for (const [p, status] of modifiedFiles.entries()) {
        parts.push(`- \`${p}\` (${status})`);
      }
      modifiedFilesSection = parts.join("\n");
    }

    // Module 5: 【接力第一优先级待办事项 (Actionable Next Steps)】
    let nextStepsSection = "";
    const nextSteps: string[] = [];

    if (failedRecords.length > 0) {
      const lastFailed = failedRecords[failedRecords.length - 1];
      const lastCmd =
        lastFailed.action?.command || lastFailed.action?.path || lastFailed.toolName || "未知动作";
      const shortCmd = lastCmd.length > 60 ? `${lastCmd.slice(0, 57)}...` : lastCmd;
      nextSteps.push(
        `1. **第一优先级 (立即执行/优先处理)**: 针对 Turn ${lastFailed.turn} 的关键卡点（\`${shortCmd}\`），优先解决依赖或报错。`
      );

      nextSteps.push(
        `2. **接力执行剩余需求**: 依赖或卡点解除后，接续完成未完成的原始需求：${cleanTask}`
      );
    } else {
      const lastRecord = history[history.length - 1];
      nextSteps.push(
        `1. **第一优先级 (立即执行)**: 当前所有前序动作均已验证成功，无关键卡点，直接推进下一阶段核心交付。`
      );
      if (lastRecord?.thought) {
        const shortThought =
          lastRecord.thought.length > 80
            ? `${lastRecord.thought.slice(0, 77)}...`
            : lastRecord.thought;
        nextSteps.push(`   - 接续最新思绪进度: "${shortThought}"`);
      }
      nextSteps.push(`2. **接续完成目标**: 围绕原始任务目标【${cleanTask}】继续执行。`);
    }

    nextSteps.push(
      `- **避坑提示**: 请勿重复执行前序已验证成功的步骤与文件探测，直接基于上述已验证客观事实推进。`
    );
    nextStepsSection = [
      `**接力建议**: 请接续上方成果与状态，避免重复执行已验证步骤，继续完成剩余需求。`,
      ``,
      ...nextSteps,
    ].join("\n");

    // Module 2a: 【阶段性技术审计发现与核心见解 (Review Draft)】
    let reviewDraftContent = "";
    if (workspaceRoot) {
      try {
        const reviewDraftPath = path.join(workspaceRoot, ".cph", "review_draft.md");
        if (fs.existsSync(reviewDraftPath)) {
          reviewDraftContent = fs.readFileSync(reviewDraftPath, "utf8").trim();
        }
      } catch {
        // Gracefully handle file system read issues
      }
    }

    // Module 2b: 【前序 AI 亲笔交接备忘录 (Agent Handoff Memo)】
    let handoffMemoContent = "";
    for (let i = history.length - 1; i >= 0; i--) {
      const resp = history[i]?.response || "";
      const idx = resp.indexOf("HANDOFF_MEMO:");
      if (idx !== -1) {
        let memo = resp.slice(idx + "HANDOFF_MEMO:".length).trim();
        const actionIdx = memo.indexOf("```action");
        if (actionIdx !== -1) {
          memo = memo.slice(0, actionIdx).trim();
        }
        if (memo) {
          handoffMemoContent = memo;
          break;
        }
      }
    }

    const docParts = [
      `### [阶段性成果快照 (Auto-Handoff Snapshot)]`,
      `# 🔄 CPH-PI 会话高保真接力交接文档 (Autonomous Handoff Document)`,
      ``,
      `## 1. 【任务目标与原始需求】`,
      taskSection,
      ``,
    ];

    if (reviewDraftContent) {
      docParts.push(
        `## 2. 【阶段性技术审计发现与核心见解 (Review Draft)】`,
        reviewDraftContent,
        ``
      );
    }

    if (handoffMemoContent) {
      docParts.push(
        `## 【前序 AI 亲笔交接备忘录 (Agent Handoff Memo)】`,
        handoffMemoContent,
        ``
      );
    }

    docParts.push(
      `## ${reviewDraftContent ? "3" : "2"}. 【已验证客观事实与阶段性成果】`,
      verifiedFactsSection,
      ``,
      `## ${reviewDraftContent ? "4" : "3"}. 【关键卡点、报错与最新诊断】`,
      blockersSection,
      ``,
      `## ${reviewDraftContent ? "5" : "4"}. 【已修改/生成文件清单】`,
      modifiedFilesSection,
      ``,
      `## ${reviewDraftContent ? "6" : "5"}. 【接力第一优先级待办事项 (Actionable Next Steps)】`,
      nextStepsSection,
      ``,
      `---`,
      `*注: 本文档由 CPH-PI Orchestrator 自动生成并持久化归档于 \`.cph/handoffs/\`。接力会话将自动注入此背景。*`
    );

    const doc = docParts.join("\n");

    // Persist to <workspaceRoot>/.cph/handoffs/handoff-<sessionId>.md
    if (effectiveSessionId && workspaceRoot) {
      try {
        const handoffsDir = path.join(workspaceRoot, ".cph", "handoffs");
        fs.mkdirSync(handoffsDir, { recursive: true });
        const docPath = path.join(handoffsDir, `handoff-${safeSessionId}.md`);
        fs.writeFileSync(docPath, doc, "utf8");
        lastHandoffDocPath = docPath;
      } catch {
        // Gracefully handle file system write issues
      }
    }

    return {
      document: doc,
      handoffDocPath: lastHandoffDocPath,
    };
  }
}
