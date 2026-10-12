export interface LedgerEntry {
  /** 单调递增的物理步数索引 (从 1 开始) */
  stepIndex: number;
  /** 时间戳 (ms) */
  timestamp: number;
  /** 执行实体角色 */
  role: "main" | "researcher" | "coder";
  /** 会话标识 */
  sessionId: string;
  /** 执行的工具名称 */
  tool: string;
  /** 关键参数摘要（如目标文件路径、命令首行） */
  target: string;
  /** 执行客观状态 */
  status: "SUCCESS" | "FAILURE";
  /** 若涉及文件修改，记录受影响的文件相对路径 */
  modifiedFiles?: string[];
  /** 若执行单测或构建，记录关键状态标记（如 PASS 12/12 或 ERR_SYNTAX） */
  statusBadge?: string;
  /** 结构化简短指纹（截取前 5 行或关键错误，单条限制 300 字符内） */
  briefSummary: string;
}
