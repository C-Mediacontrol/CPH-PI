# CPH-PI Harness 物理立桩账本与传引用文件挂载架构设计规范
(Harness Physical Ledger & Pass-by-Reference File Mounting Design Spec)

- **文档标识**: `SPEC-20261013-HARNESS-PHYSICAL-LEDGER`
- **创建日期**: `2026-10-13`
- **状态**: `PROPOSED` (待审阅)
- **作者**: Antigravity x CPH-PI Architecture Team
- **对应目标目录**: `CPH-PI/`

---

## 1. 摘要与设计动机 (Abstract & Motivation)

### 1.1 现状与痛点
在长耗时、跨轮次自主编程任务中，LLM 面临两大核心工程矛盾：
1. **宝贵的工作内存（In-Context Working Memory）与冗余执行日志的冲突**：
   随着任务深入，工具调用累积产生海量执行结果。若将每次 `read_file`、`patch_file`、`run_command` 的完整细节长期保留在上下文中，会极速吞噬注意力预算，诱发“大海捞针”退化与 429 频控崩溃。
2. **底层物理灾备需求与业务模型专注度的冲突**：
   此前为了容灾与接力，曾尝试要求模型在工作区维护临时草稿（如 `.cph/review_draft.md`），或者在接力/灾备时将上万字前序报告机械地倾倒（Raw Value Dump）进聊天窗口。这不仅导致大模型分心、注意力被“运维者视角”污染，更在并发子代理场景下引发文件写入冲突与严重的 Token 浪费。

### 1.2 架构哲学：状态持久化与工作内存正交分层
依据《AGENTS.md》核心开发与治理准则第 7 条，确立终局架构哲学：
- **内存修剪 (Compaction) 与 物理预写日志 (WAL) 严格解耦**：模型注意力窗口仅保留高信噪比决策信息；物理世界的工具调用事实与证据，由宿主 Harness 底层以 **0 LLM Token 开销** 自动追加写入磁盘预写日志（`.cph/state/` 下的 Ledger / WAL）。
- **传引用挂载而非传值倾倒 (Pass-by-Reference over Raw Value Dump)**：无论主控唤醒、会话接力还是子任务结题，严禁向聊天窗口倾倒原始长文本。Harness 统一以物理文件形式挂载账本，Prompt 中仅注入包含路径与状态码的极简物理指纹（TOC / Fingerprint Header），引导模型使用现有工具按需调阅。

---

## 2. 总体架构与职责分层 (System Architecture)

系统划分为三个严格解耦的正交层次：

```text
 ┌────────────────────────────────────────────────────────────────────────┐
 │                      1. 业务推理层 (LLM Context)                       │
 │  - 纯粹操作者视角，全神贯注于代码与架构                                 │
 │  - 提示词仅接收【物理账本挂载指纹】(~100 Tokens)                        │
 │  - 按需通过 read_file/view_file 定向回溯细节                            │
 └───────────────────────────────────┬────────────────────────────────────┘
                                     │ 传引用 (Pass-by-Reference)
                                     ▼
 ┌────────────────────────────────────────────────────────────────────────┐
 │                  2. Harness 控制核 (Runtime Core)                      │
 │  - 拦截工具执行回调 (Tool Execution Interceptor)                       │
 │  - 异步零开销写入磁盘预写日志 (Zero-Token WAL Writer)                  │
 │  - 内存滑动窗口压缩调度 (Compaction Engine)                            │
 │  - 构造极简挂载指纹 (Fingerprint Generator)                            │
 └───────────────────────────────────┬────────────────────────────────────┘
                                     │ 原子追加落盘 (Append-only)
                                     ▼
 ┌────────────────────────────────────────────────────────────────────────┐
 │                   3. 物理存储底座 (Physical Disk)                      │
 │  - .cph/state/execution-ledger.jsonl (机器可读、无损崩溃一致性账本)    │
 │  - .cph/state/execution-ledger.md    (人类/模型可读 Markdown 投影视图) │
 │  - .docs/ (真正的业务产物：specs/plans/reports，非临时容灾草稿)        │
 └────────────────────────────────────────────────────────────────────────┘
```

### 2.1 职责边界表

| 层次 | 模块 | 职责 | 零 Token 保证 |
|---|---|---|---|
| **物理存储层** | `PhysicalLedgerWriter` | 拦截每一次 `run_command`、`patch_file`、`write_file`、`read_file` 的客观返回结果，追加写入 `.cph/state/execution-ledger.jsonl` 并同步维护 `.cph/state/execution-ledger.md`。 | **是**（由 Node.js/Bun 原生 I/O 驱动，完全不调用 LLM API） |
| **契约挂载层** | `LedgerMountManager` | 在生成 System Prompt、接力 Prompt（`handoff`）或主控唤醒 Prompt 时，计算物理指纹，注入不超过 150 Tokens 的传引用挂载头。 | **是**（模板化纯代码计算，严禁包含大文本正文） |
| **内存管理层** | `ContextCompactor` | 在运行时当 Context 达到阈值时，安全修剪早期内存中的冗余 `tool_result`，因为物理底座已存在不可篡改的 WAL 兜底。 | **是**（基于规则与 token 统计） |
| **业务推理层** | `Main / Researcher / Coder` | 依据挂载头掌握全局物理状态，全神贯注完成业务开发，按需调阅账本。 | 专注业务 |

---

## 3. 详细设计与数据契约 (Detailed Specifications)

### 3.1 物理账本数据模型 (`src/session/ledger/ledger-entry.ts`)

```typescript
export interface LedgerEntry {
  /** 单调递增的物理步数索引 */
  stepIndex: number;
  /** 时间戳 (ms) */
  timestamp: number;
  /** 执行实体角色 */
  role: 'main' | 'researcher' | 'coder';
  /** 会话标识 */
  sessionId: string;
  /** 执行的工具名称 */
  tool: string;
  /** 关键参数摘要（如目标文件路径、命令首行） */
  target: string;
  /** 执行客观状态 */
  status: 'SUCCESS' | 'FAILURE';
  /** 若涉及文件修改，记录受影响的文件相对路径 */
  modifiedFiles?: string[];
  /** 若执行单测或构建，记录关键状态标记（如 PASS 12/12 或 ERR_SYNTAX） */
  statusBadge?: string;
  /** 结构化简短指纹（截取前 5 行或关键错误，单条限制 300 字符内） */
  briefSummary: string;
}
```

### 3.2 存储文件规范
物理账本保存在工作区子目录 `.cph/state/` 中：
1. **`.cph/state/execution-ledger.jsonl`**：
   - 格式：每行一个 JSON 序列化的 `LedgerEntry`。
   - 特性：追加写（Append-only），`fs.appendFileSync` 保证断电与进程强制崩溃时的崩溃一致性（Crash Consistency）。
2. **`.cph/state/execution-ledger.md`**：
   - 格式：结构化 Markdown 表格与最近 5 步关键摘要。
   - 示例：
     ```markdown
     # CPH 物理执行账本 (Execution Ledger)
     - 更新时间: 2026-10-13T00:15:30Z
     - 当前物理基线: Git HEAD (clean)
     - 累计物理步骤: 14 步

     | 步数 | 角色 | 工具 | 目标/动作 | 状态 | 关键指标/结果 |
     |---|---|---|---|---|---|
     | 1 | main | read_file | src/cli.ts | SUCCESS | 读取 800 行 |
     | 2 | main | invoke_subagent | coder (修复池指针) | SUCCESS | 派发子会话 sub_123 |
     | ... | ... | ... | ... | ... | ... |
     | 14 | coder | run_command | bun test | SUCCESS | PASS (476/476) |
     ```

### 3.3 传引用挂载指纹规范 (Mounting Fingerprint Header)
当 Harness 组装向模型发送的首轮提示词、接力提示词或系统提示词时，调用 `formatLedgerMountHeader()` 生成挂载头：

```text
【系统物理执行账本已挂载】
- 账本路径: .cph/state/execution-ledger.md
- 累计物理操作: 14 步 | 核心变更文件: [src/auth/account-pool.ts, src/cli.ts]
- 最新验证状态: PASS (476 pass, 0 fail)
- 查阅契约: 上述客观事实已由系统物理验证。如需回溯某一步的详细改动或命令输出，请使用 read_file / view_file 工具定向查看账本文件，严禁要求在对话流中全量回放日志。
```
**严格约束**：
- 挂载头文本长度不得超过 10 行；
- Token 开销严格锁定在 **150 Tokens** 以内；
- 严禁将 `reportsSummary` 或万字日志整段拼接（彻底重构 `main-plan-snapshot.ts` 中的 `formatSuccessorTurn1Prompt`）。

---

## 4. 关键交互流程与生命周期 (Interaction Flow)

```text
Sequence Diagram:
  Main/Coder Agent ──(1. tool call: patch_file)──> Harness Runtime Core
                                                           │
                                             (2. 执行真实文件补丁)
                                                           │
                                                           ▼
  Main/Coder Agent <──(3. 返回真实执行结果)──────── Harness Runtime Core
                                                           │
                                             (4. 零 Token 异步/同步追加写)
                                                           │
                                                           ▼
                                               .cph/state/execution-ledger.jsonl
                                               .cph/state/execution-ledger.md

[发生突发异常 / 429 / 正常会话轮数上限时]
  Harness 触发接力 ──> 读取 .cph/state/execution-ledger.jsonl
                     ──> 计算 Fingerprint Header
                     ──> 组装 Successor Prompt (仅包含挂载指针)
                     ──> 唤醒 Successor Agent (零上下文污染，即刻推进)
```

---

## 5. 与现有架构模块的改造映射 (Refactoring Mapping)

| 目标文件 | 改造内容 |
|---|---|
| `src/session/ledger/execution-ledger.ts` (新建) | 实现 `ExecutionLedger` 类，负责状态记录、append-only 落盘、Markdown 投影与挂载指纹生成。 |
| `src/cli.ts` / `src/agent/` | 在工具调用成功与失败的回调管道中，埋入 `ledger.recordStep(...)`，实现透明无感立桩。 |
| `src/session/main-plan-snapshot.ts` | 改造 `formatSuccessorTurn1Prompt`，彻底移除旧版将 `reportsSummary` 全量拼接的方式，换用轻量指纹挂载。 |
| `src/session/session-manager.ts` | 会话初始化与恢复时，自动将当前工作区的账本挂载路径注入到系统上下文。 |
| `.cph/review_draft.md` (废弃) | 彻底停止向该路径写入草稿，正式业务文档一律引导至 `.docs/`。 |

---

## 6. 异常处理与鲁棒性保障 (Error Handling & Robustness)

1. **I/O 容错与无阻塞原则**：
   账本写入为辅助性底座保障，若因磁盘满或权限异常导致写入失败，仅输出 stderr warning，**绝不中断主业务工具执行流程**。
2. **并发写安全 (Concurrency Safety)**：
   在并发子代理场景下，多进程/多协程同时写账本可能引发交错。
   - 底层使用 `fs.appendFileSync` 提供 OS 级别原语保护；
   - 每个条目携带独立的 `sessionId` 与 `role` 标识，保证即便交叉写入也能无损按会话重新聚合。
3. **体积溢出防护 (Ledger Compaction/Rotation)**：
   若单一任务执行超过 500 步，Harness 自动对 `.cph/state/execution-ledger.md` 进行表格折叠归档，仅保留最近 50 步表格，历史步骤归档为 `.cph/state/execution-ledger-archive.md`，确保模型调阅时不超窗。

---

## 7. 验证计划与验收标准 (Test & Acceptance Plan)

1. **单元测试矩阵**：
   - `tests/session/execution-ledger.test.ts`：
     - 测试 `recordStep` 的 JSONL 与 Markdown 落地正确性；
     - 测试 `formatMountHeader` 生成指纹的长度与 Token 控制（< 150 tokens）；
     - 测试多并发写入下的追加完整性；
     - 测试超长工具输出截断指纹的有效性。
2. **端到端回归**：
   - 运行全量 `bun test tests/`，确保全部现有 476 个单元测试 100% 保持通过；
   - 模拟 429 容灾与接力场景，验证后继智能体通过挂载头能准确感知物理事实，且 Prompt 长度缩减 80% 以上。
