import fs from "node:fs";
import path from "node:path";

/**
 * 单轮交互记录实体
 */
export interface SessionTurnRecord {
  turnNumber: number;
  timestamp: string;
  userInput: string;
  modelReasoning?: string;
  modelResponse: string;
  toolCalls?: Array<{
    tool: string;
    args?: any;
    output?: string;
    success?: boolean;
  }>;
}

/**
 * 完整会话快照契约
 */
export interface SessionRecord {
  id: string;               // 如 ses_20261010_1234_abc
  title: string;            // 任务摘要或用户首个提问
  workspaceRoot: string;
  createdAt: string;        // ISO 8601
  updatedAt: string;        // ISO 8601
  turnCount: number;
  maxTurns: number;
  modelTone: string;
  currentAccount?: string;
  status: "active" | "completed" | "handed_off";
  turns: SessionTurnRecord[];
  handoffSnapshot?: string;
  handoffDocPath?: string;
  disasterBlackbox?: string;
}

/**
 * index.json 索引表条目契约
 */
export interface SessionIndexItem {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  turnCount: number;
  status: "active" | "completed" | "handed_off";
  currentAccount?: string;
  workspaceRoot?: string;
  modelTone?: string;
  handoffSnapshot?: string;
  handoffDocPath?: string;
  disasterBlackbox?: string;
}

/**
 * 创建会话可选入参
 */
export interface CreateSessionOptions {
  id?: string;
  title?: string;
  workspaceRoot?: string;
  maxTurns?: number;
  modelTone?: string;
  currentAccount?: string;
  status?: "active" | "completed" | "handed_off";
  handoffSnapshot?: string;
  handoffDocPath?: string;
  disasterBlackbox?: string;
}

/**
 * SessionManager: 工业级会话持久化与状态管理器
 * 
 * 存储路径: <workspaceRoot>/.cph/sessions/
 * 维护全局 index.json 索引表以及独立 <sessionId>.json 会话详情。
 */
export class SessionManager {
  private workspaceRoot: string;
  private sessionsDir: string;
  private indexFile: string;

  constructor(workspaceRoot?: string) {
    this.workspaceRoot = path.resolve(workspaceRoot || process.cwd());
    this.sessionsDir = path.join(this.workspaceRoot, ".cph", "sessions");
    this.indexFile = path.join(this.sessionsDir, "index.json");
  }

  /**
   * 确保存储目录已创建
   */
  private ensureSessionsDir(): void {
    if (!fs.existsSync(this.sessionsDir)) {
      fs.mkdirSync(this.sessionsDir, { recursive: true });
    }
  }

  /**
   * 检查会话 ID 是否合法且无路径穿越风险
   */
  private isValidSessionId(id: string): boolean {
    if (!id || typeof id !== "string") return false;
    // 仅允许字母、数字、下划线、短横线
    return /^[a-zA-Z0-9_\-]+$/.test(id);
  }

  /**
   * 生成全局唯一会话 ID
   * 格式: ses_YYYYMMDD_HHmm_rand4
   */
  private generateSessionId(): string {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    const rand = Math.random().toString(36).substring(2, 6);
    return `ses_${y}${m}${d}_${hh}${mm}_${rand}`;
  }

  /**
   * 读取 index.json 索引列表，并在缺失或损坏时自动自愈重建
   */
  private readIndex(): SessionIndexItem[] {
    this.ensureSessionsDir();

    if (!fs.existsSync(this.indexFile)) {
      return this.rebuildIndex();
    }

    try {
      const raw = fs.readFileSync(this.indexFile, "utf-8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.sort(
          (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        );
      }
      return this.rebuildIndex();
    } catch {
      return this.rebuildIndex();
    }
  }

  /**
   * 写入 index.json
   */
  private writeIndex(items: SessionIndexItem[]): void {
    this.ensureSessionsDir();
    const sorted = [...items].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
    fs.writeFileSync(this.indexFile, JSON.stringify(sorted, null, 2), "utf-8");
  }

  /**
   * 自愈重建 index.json：扫描目录下的所有有效会话 JSON
   */
  private rebuildIndex(): SessionIndexItem[] {
    this.ensureSessionsDir();
    const items: SessionIndexItem[] = [];

    let files: string[] = [];
    try {
      files = fs.readdirSync(this.sessionsDir);
    } catch {
      return [];
    }

    for (const file of files) {
      if (!file.endsWith(".json") || file === "index.json") continue;
      const fullPath = path.join(this.sessionsDir, file);
      try {
        const raw = fs.readFileSync(fullPath, "utf-8");
        const session = JSON.parse(raw) as SessionRecord;
        if (session && session.id && session.title) {
          items.push({
            id: session.id,
            title: session.title,
            createdAt: session.createdAt || new Date().toISOString(),
            updatedAt: session.updatedAt || session.createdAt || new Date().toISOString(),
            turnCount: session.turnCount ?? (session.turns ? session.turns.length : 0),
            status: session.status || "active",
            currentAccount: session.currentAccount,
            workspaceRoot: session.workspaceRoot,
            modelTone: session.modelTone,
            handoffSnapshot: session.handoffSnapshot,
            handoffDocPath: session.handoffDocPath,
            disasterBlackbox: session.disasterBlackbox,
          });
        }
      } catch {
        // 忽略无法解析的脏文件
      }
    }

    this.writeIndex(items);
    return items;
  }

  /**
   * 创建并初始化新会话，落盘文件并更新索引
   */
  public createSession(options: CreateSessionOptions = {}): SessionRecord {
    this.ensureSessionsDir();

    const id = options.id || this.generateSessionId();
    const now = new Date().toISOString();

    const session: SessionRecord = {
      id,
      title: options.title || "新会话",
      workspaceRoot: options.workspaceRoot ? path.resolve(options.workspaceRoot) : this.workspaceRoot,
      createdAt: now,
      updatedAt: now,
      turnCount: 0,
      maxTurns: options.maxTurns ?? 25,
      modelTone: options.modelTone || "Creative",
      currentAccount: options.currentAccount,
      status: options.status || "active",
      turns: [],
      handoffSnapshot: options.handoffSnapshot,
      handoffDocPath: options.handoffDocPath,
      disasterBlackbox: options.disasterBlackbox,
    };

    this.saveSession(session);
    return session;
  }

  /**
   * 增量保存更新会话详情与索引
   */
  public saveSession(session: SessionRecord): void {
    if (!this.isValidSessionId(session.id)) {
      throw new Error(`Invalid session ID: ${session.id}`);
    }

    this.ensureSessionsDir();

    session.updatedAt = new Date().toISOString();
    session.turnCount = session.turns ? session.turns.length : session.turnCount;

    // 写入独立会话文件
    const sessionFile = path.join(this.sessionsDir, `${session.id}.json`);
    fs.writeFileSync(sessionFile, JSON.stringify(session, null, 2), "utf-8");

    // 同步更新 index.json
    const index = this.readIndex();
    const existingIdx = index.findIndex((item) => item.id === session.id);

    const indexEntry: SessionIndexItem = {
      id: session.id,
      title: session.title,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      turnCount: session.turnCount,
      status: session.status,
      currentAccount: session.currentAccount,
      workspaceRoot: session.workspaceRoot,
      modelTone: session.modelTone,
      handoffSnapshot: session.handoffSnapshot,
      handoffDocPath: session.handoffDocPath,
      disasterBlackbox: session.disasterBlackbox,
    };

    if (existingIdx >= 0) {
      index[existingIdx] = indexEntry;
    } else {
      index.push(indexEntry);
    }

    this.writeIndex(index);
  }

  /**
   * 读取特定会话详情
   */
  public loadSession(id: string): SessionRecord | null {
    if (!this.isValidSessionId(id)) return null;

    const sessionFile = path.join(this.sessionsDir, `${id}.json`);
    if (!fs.existsSync(sessionFile)) return null;

    try {
      const raw = fs.readFileSync(sessionFile, "utf-8");
      return JSON.parse(raw) as SessionRecord;
    } catch {
      return null;
    }
  }

  /**
   * 获取当前工作区的所有历史会话列表（按更新时间降序排列）
   */
  public listSessions(): SessionIndexItem[] {
    return this.readIndex();
  }

  /**
   * 获取最近活跃的一个未完/有效会话（供 --continue 使用）
   */
  public getLatestActiveSession(): SessionRecord | null {
    const list = this.readIndex();
    for (const item of list) {
      if (item.status === "active") {
        const fullSession = this.loadSession(item.id);
        if (fullSession && fullSession.status === "active") {
          return fullSession;
        }
      }
    }
    return null;
  }

  /**
   * 删除会话文件并从索引移除
   */
  public deleteSession(id: string): boolean {
    if (!this.isValidSessionId(id)) return false;

    this.ensureSessionsDir();
    const sessionFile = path.join(this.sessionsDir, `${id}.json`);
    let fileExisted = false;

    if (fs.existsSync(sessionFile)) {
      try {
        fs.unlinkSync(sessionFile);
        fileExisted = true;
      } catch {
        // 文件删除失败
      }
    }

    const index = this.readIndex();
    const filtered = index.filter((item) => item.id !== id);
    const indexChanged = filtered.length !== index.length;

    if (indexChanged) {
      this.writeIndex(filtered);
    }

    return fileExisted || indexChanged;
  }
}
