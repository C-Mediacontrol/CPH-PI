import fs from "node:fs";
import path from "node:path";
import { ExecutionLedger } from "./ledger/execution-ledger.ts";
import { PnPWorkspaceSyncEngine } from "../workspace/pnp-sync-engine.ts";

export interface MainPlanSnapshot {
  snapshotId: string;
  originalSessionId: string;
  originalTask: string;
  thought: string;
  workspaceRoot: string;
  gitBaseline: string;
  plannedSubagents: any[];
  createdAt: number;
}

export function createMainPlanSnapshot(params: {
  originalSessionId: string;
  originalTask: string;
  thought?: string;
  workspaceRoot: string;
  gitBaseline?: string;
  plannedSubagents: any[];
}): MainPlanSnapshot {
  return {
    snapshotId: `snap_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    originalSessionId: params.originalSessionId,
    originalTask: params.originalTask,
    thought: params.thought || "",
    workspaceRoot: params.workspaceRoot,
    gitBaseline: params.gitBaseline || "HEAD",
    plannedSubagents: params.plannedSubagents || [],
    createdAt: Date.now(),
  };
}

export function saveMainPlanSnapshot(
  snapshot: MainPlanSnapshot,
  workspaceRoot: string
): { jsonPath: string; mdPath: string } {
  const handoffsDir = path.join(workspaceRoot, ".cph", "handoffs");
  fs.mkdirSync(handoffsDir, { recursive: true });

  const cleanId = snapshot.originalSessionId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const jsonPath = path.join(handoffsDir, `main-plan-${cleanId}.json`);
  const mdPath = path.join(handoffsDir, `main-plan-${cleanId}.md`);

  fs.writeFileSync(jsonPath, JSON.stringify(snapshot, null, 2), "utf8");

  const mdContent = `# 主控规划快照: ${snapshot.snapshotId}

- **前序会话**: ${snapshot.originalSessionId}
- **生成时间**: ${new Date(snapshot.createdAt).toISOString()}
- **Git 基准**: ${snapshot.gitBaseline}

## 1. 原始工程任务
${snapshot.originalTask}

## 2. 前序主控推演与架构思考
${snapshot.thought || "（无额外思考推演）"}

## 3. 本次派发的专项子任务 (${snapshot.plannedSubagents.length} 个)
${snapshot.plannedSubagents
  .map(
    (sub, idx) => `### 子任务 ${idx + 1}: [${sub.role || "unknown"}] ${sub.description || ""}
- **Prompt**:
\`\`\`text
${sub.prompt || ""}
\`\`\`
`
  )
  .join("\n")}
`;

  fs.writeFileSync(mdPath, mdContent, "utf8");

  return { jsonPath, mdPath };
}

export function loadMainPlanSnapshot(
  sessionId: string,
  workspaceRoot: string
): MainPlanSnapshot | null {
  const cleanId = sessionId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const jsonPath = path.join(workspaceRoot, ".cph", "handoffs", `main-plan-${cleanId}.json`);
  if (!fs.existsSync(jsonPath)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(jsonPath, "utf8");
    return JSON.parse(raw) as MainPlanSnapshot;
  } catch {
    return null;
  }
}

export function formatSuccessorTurn1Prompt(
  snapshot: MainPlanSnapshot,
  reportsSummary: string,
  customLedgerMountHeader?: string,
  concurrencyWorkers?: number,
  dirSkeleton?: string
): string {
  let mountHeader = customLedgerMountHeader;
  if (!mountHeader && snapshot.workspaceRoot) {
    try {
      const ledger = new ExecutionLedger(snapshot.workspaceRoot);
      mountHeader = ledger.formatMountHeader();
    } catch {
      // 容错忽略
    }
  }

  const mountSection = mountHeader
    ? `\n### 2. 物理执行账本挂载 (Pass-by-Reference)\n${mountHeader}\n`
    : "";

  const clusterFact =
    concurrencyWorkers !== undefined && concurrencyWorkers > 0
      ? `\n- **并发集群容量**: ${concurrencyWorkers} 个并行 Worker (推荐单批派发与此容量匹配的正交子任务以实现最高吞吐)`
      : "";

  const wsNorm = snapshot.workspaceRoot ? snapshot.workspaceRoot.replace(/\\/g, "/") : "";
  const workspaceFact = wsNorm ? `\n- **工作区绝对路径**: ${wsNorm}` : "";
  const catalogFact =
    "\n- **工作区目录与云端文件索引**: 已作为云端附件 `remote-workspace-catalog.md` 随本轮消息挂载";

  return `【主控接力与成果审阅】
前序主控会话已完成工程规划并调度专项子代理完成了攻坚。系统已在本地持久化前序规划快照。

【本地宿主机工作区事实】${workspaceFact}${catalogFact}${clusterFact}

### 1. 原始工程目标与规划思路
- **原始目标**:
${snapshot.originalTask}

- **前序推演与架构思绪**:
${snapshot.thought || "按既定规范开展模块化调研与修改。"}${mountSection}
### 3. 子任务攻坚结题成果
${reportsSummary}

---
请你作为后继主控智能体，以当前全新满额的推理配额，推进工程对账与收敛：
1. 【对账打勾】：根据上述各子任务结题成果，使用 patch_file 立即将 plan.md 中已成功的任务项更新打勾为 - [x] 步骤描述；
2. 【成果引用】：完整调研报告与证据链已由底层自动落盘至物理报告文件（.cph/reports/），若需回溯执行细节可按需调阅已挂载的物理账本或使用 read_file 调阅；
3. 【局部补缺】：若存在未成功的子任务，仅对该失败项进行单点定向重试或补充派发，保护已完成的规划与成果；
4. 【自闭环攻坚心智】：你正处于既定工程战役的收敛攻坚阶段，工作区已具备明确的战役目标与 plan.md 待办项。请直接基于上述成果与物理事实推进对账或补缺派发，优先基于受控目录骨架定位真实文件路径展开工作，无需中断执行向用户重问初始需求；
5. 【终局结题】：只有当 plan.md 中所有规划项均已达成 (- [x]) 且全部验证通过时，输出 FINAL_ANSWER 完成结题。`;
}

