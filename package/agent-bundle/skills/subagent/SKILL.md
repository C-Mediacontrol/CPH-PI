---
name: subagent
description: 云原生双智能体（Main + Coder）正交并行编码派发与 DAG 阶段屏障调度指南。当主控智能体基于云端工作区完成全景架构分析后，需要对多个正交模块并行实施代码修改与单元测试验证时使用。
---

# 云原生专项编码子代理（Coder Subagent）调度规范

## 1. 适用场景与主控直读边界

在 SharePoint 云端工作区（提示词内联的 `[SHAREPOINT REMOTE WORKSPACE]` 精简映射表 + 本轮附件 `remote-workspace-catalog.md` 完整清单）架构下，主控智能体（`CPH-Main`）具备零本地 I/O 往返的全景源码直读能力：
- **主控直接闭环场景**：代码审查、架构审计、跨文件逻辑核对、Bug 根因诊断、技术问答以及单模块敏捷修改，均由 `CPH-Main` 直接通过 SharePoint 云端 URL 阅读并完成交付，直达 `FINAL_ANSWER`。
- **`Coder` 子代理派发场景**：当工程任务涉及 **多个独立模块的并行代码重构、跨子系统功能开发或繁重的模块级单元测试迭代** 时，主控在云端完成全景架构设计与接口契约定义后，调用 `invoke_subagent` 派发 `role: "coder"` 子代理正交并发落地。

## 2. Coder 派发四大核心门禁（Four Coder Dispatch Gates）

### Gate 1：云端认知先行与契约锚定
主控先通过 `[SHAREPOINT REMOTE WORKSPACE]` 精简映射表与 `remote-workspace-catalog.md` 完整清单审阅相关源码，明确每个待修改模块的文件路径、SharePoint URL、函数签名与边界条件，确保下发给 `coder` 的工单具备清晰的修改坐标。

### Gate 2：文件正交隔离与 DAG 阶段屏障（Stage Barrier）
在 `invoke_subagent` 的 `subagents` 数组中，通过 `stage`（正整数，默认 `1`）编排因果执行拓扑，遵循“契约先于实现、底座先于应用、研判先于重构、实施先于集成”的因果序：
- **同一 `stage` 正交并发**：将修改不同文件、彼此无写冲突的子任务设为相同的 `stage`（如 `stage: 1`），确保同一 `stage` 内各 `coder` 的 `targetFiles` 完全互不重叠。
- **跨 `stage` 阶段屏障**：当下游模块适配依赖前置公共接口或底座变更时，将公共接口修改设为 `stage: 1`，下游模块适配与集成验证设为 `stage: 2`。系统确保 `stage: 1` 全部成功并实时热同步至 SharePoint 云端工作区后，再开启 `stage: 2`。

### Gate 3：技能内化与无名化具象派发
将 TDD、重构模式或代码质量标准内化为工单 `prompt` 中的具体文件路径、SharePoint URL、修改逻辑描述与明确的测试验证命令（如 `bun test tests/xxx.test.ts`），使 `coder` 直接聚焦于纯工程实施。

### Gate 4：`plan.md` 物理任务清单对账与派发即提交
- 派发前，使用 `patch_file`（或首次创建时写入）维护工作区根目录下的 `plan.md` 物理任务清单（以 `- [ ]` 列出待办项）。
- **派发即提交**：输出 `invoke_subagent` 块后，系统自动保留规划上下文并在 `coder` 批次执行完毕后唤醒后继主控会话。

## 3. 标准 `invoke_subagent` 调用范式

```json:action
{
  "tool": "invoke_subagent",
  "subagents": [
    {
      "role": "coder",
      "stage": 1,
      "description": "重构鉴权中间件并补充单元测试",
      "targetFiles": ["src/auth/middleware.ts", "tests/auth/middleware.test.ts"],
      "prompt": "请基于 [SHAREPOINT REMOTE WORKSPACE] 中的云端 URL 审阅 src/auth/middleware.ts 与 tests/auth/middleware.test.ts。1. 使用 patch_file 为 verifyToken 增加过期宽限期参数 graceSeconds?: number；2. 更新 tests/auth/middleware.test.ts 覆盖宽限期边界场景；3. 运行 bun test tests/auth/middleware.test.ts 验证绿灯后输出 FINAL_ANSWER。"
    },
    {
      "role": "coder",
      "stage": 1,
      "description": "升级会话存储适配器接口",
      "targetFiles": ["src/session/store.ts", "tests/session/store.test.ts"],
      "prompt": "请基于 [SHAREPOINT REMOTE WORKSPACE] 中的云端 URL 审阅 src/session/store.ts。1. 使用 patch_file 新增 touchSession(id: string) 方法；2. 在 tests/session/store.test.ts 中补充对应单测；3. 运行 bun test tests/session/store.test.ts 确认绿灯后输出 FINAL_ANSWER。"
    }
  ]
}
```

## 4. 成果回收与对账收敛

当 `Coder` 批次执行完毕后，主控将收到结构化结题摘要与物理报告路径（`.cph/reports/report-coder-sub-N.md`），同时所有已修改文件均已实时同步至 SharePoint 云端工作区：
1. **对账打勾**：使用 `patch_file` 将 `plan.md` 中已成功的子任务更新为 `- [x]`。
2. **单点补缺**：若个别子任务未达成，按需调阅对应 `.cph/reports/` 报告或云端最新文件，仅对未完成项发起定向修复，保护已完成的模块成果。
3. **终局交付**：当 `plan.md` 所有事项均已达成（`- [x]`）并通过验证时，立即输出完整的 `FINAL_ANSWER` 向用户交付最终成果。
