/**
 * 会话单向继承链条追踪器 (Session Lineage Tracker)
 *
 * 维护主会话与子代理会话的生命周期节点、父子关系与单向继承链条 (Lineage Chain)。
 * 支持在主会话发生 429 容灾迁移或多次接力时，通过 `resolveActiveHead` 动态解析最新的活动端点。
 */

export interface SessionLineage {
  sessionId: string;
  role: "main" | "coder" | "researcher";
  status: "active" | "handed_off" | "throttled" | "completed";
  parentSessionId?: string;
  predecessorId?: string;
  successorId?: string;
  subagentSessionIds?: string[];
}

export class SessionLineageTracker {
  private registry = new Map<string, SessionLineage>();

  /**
   * 注册或更新会话血缘节点
   */
  public register(lineage: SessionLineage): void {
    const existing = this.registry.get(lineage.sessionId);
    this.registry.set(lineage.sessionId, {
      ...existing,
      ...lineage,
      subagentSessionIds: lineage.subagentSessionIds || existing?.subagentSessionIds || [],
    });
  }

  /**
   * 关联前任会话与接力继任者会话
   */
  public linkSuccessor(predecessorId: string, successorId: string): void {
    const pred = this.registry.get(predecessorId);
    if (pred) {
      pred.successorId = successorId;
      pred.status = "handed_off";
    }
    const succ = this.registry.get(successorId);
    if (succ) {
      succ.predecessorId = predecessorId;
    }
  }

  /**
   * 关联主会话与被派发的子代理会话
   */
  public linkSubagent(mainSessionId: string, subagentSessionId: string): void {
    const main = this.registry.get(mainSessionId);
    if (main) {
      if (!main.subagentSessionIds) main.subagentSessionIds = [];
      if (!main.subagentSessionIds.includes(subagentSessionId)) {
        main.subagentSessionIds.push(subagentSessionId);
      }
    }
    const sub = this.registry.get(subagentSessionId);
    if (sub) {
      sub.parentSessionId = mainSessionId;
    }
  }

  /**
   * 获取指定会话的血缘信息
   */
  public getLineage(sessionId: string): SessionLineage | undefined {
    return this.registry.get(sessionId);
  }

  /**
   * 沿继承链解析最终的活动端点（当前最新的主会话/继承者 ID）
   * 使用 visited 集合检测并防止环状循环引用。
   */
  public resolveActiveHead(startSessionId: string): string {
    let currentId = startSessionId;
    const visited = new Set<string>();

    while (currentId && !visited.has(currentId)) {
      visited.add(currentId);
      const lineage = this.registry.get(currentId);
      if (!lineage) break;
      if (lineage.successorId && lineage.status === "handed_off") {
        currentId = lineage.successorId;
      } else {
        break;
      }
    }
    return currentId;
  }
}
