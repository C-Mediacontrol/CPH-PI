import fs from "node:fs";
import path from "node:path";

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
  customLedgerMountHeader?: string
): string {
  let mountHeader = customLedgerMountHeader;
  if (!mountHeader && snapshot.workspaceRoot) {
    try {
      const { ExecutionLedger } = require("./ledger/execution-ledger.ts");
      const ledger = new ExecutionLedger(snapshot.workspaceRoot);
      mountHeader = ledger.formatMountHeader();
    } catch {
      // 容错忽略
    }
  }

  const mountSection = mountHeader
    ? `\n### 2. 物理执行账本挂载 (Pass-by-Reference)\n${mountHeader}\n`
    : "";

  return `【主控接力与成果审阅】
前序主控会话已完成工程规划并调度专项子代理完成了攻坚。系统已在本地持久化前序规划快照。

### 1. 原始工程目标与规划思路
- **原始目标**:
${snapshot.originalTask}

- **前序推演与架构思绪**:
${snapshot.thought || "按既定规范开展模块化调研与修改。"}
${mountSection}
### 3. 子任务攻坚结题成果
${reportsSummary}

---
请你作为后继主控智能体，以当前全新满额的推理配额，综合审阅上述交付物，执行交叉验证与必要测试。
若需回溯具体的执行细节，可按需调阅已挂载的物理账本；
若全部达成目标且验证充分，请直接输出 FINAL_ANSWER 完成结题；
若评估后需要第二阶段专项攻坚，可继续派发 invoke_subagent。`;
}

