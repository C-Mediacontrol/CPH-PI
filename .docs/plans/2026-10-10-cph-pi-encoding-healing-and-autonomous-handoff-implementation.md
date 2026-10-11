# CPH-PI 编码自愈、大输出持久化与自主无感接力实施计划

## 1. 背景与目标
在真实复杂任务（如对 `CNNJI QUERY` 项目执行 30 轮全量代码审查）的实测中，发现了两个影响自主执行体验的关键痛点：
1. **Windows 控制台输出编码乱码 (CP936/GBK 与 UTF-8 错乱)**：
   Windows 下 PowerShell、cmd 及系统工具在抛出异常或错误信息时默认采用 OEM 代码页（CP936/GBK）。流式读取时被 UTF-8 解码为替换字符（`\uFFFD` 菱形问号），回填给 Copilot 的工具结果包含大量问号乱码，阻碍模型理解真实报错。
2. **25/30 轮 Auto-Handoff 自动接力未闭环**：
   当会话达到 30 轮推理上限触发脱困时，系统虽然归档了原会话并创建了新会话，但停留在 `cph-pi>` 提示符等待用户手动输入，未能实现全自动接续执行；同时缺乏结构化的高保真交接文档。

本计划旨在彻底解决上述两个问题，并配合大工具输出自动本地持久化，实现工业级的自主续航与清晰中文诊断。

---

## 2. 详细任务分解

### Task 1: Windows 控制台输出编码智能自愈 (Smart Encoding Self-Healing)
- **目标**：彻底消除 Windows 环境下的菱形问号乱码，确保所有工具输出（标准输出与标准错误）在进入 Pi 状态机前完成 GBK/UTF-8 智能识别与无损转码。
- **涉及文件**：
  - `CPH-PI/src/protocol/tool-bridge.ts`
  - `CPH-PI/tests/protocol/encoding-self-healing.test.ts`
- **实施要点**：
  1. 实现 `smartDecodeBuffer(buffer: Buffer): string`：
     - 首先尝试以严苛模式 UTF-8 (`{ fatal: true }`) 解码；
     - 若触发解码错误，自动采用 `new TextDecoder("gbk")` 解码；
     - 若仍异常，回退至安全降级字符串；
  2. 实现流式块的 GBK 边界自愈；
  3. 在 `ToolBridge` 中提供包装后的 `BashOperations`，在 `onData(chunk)` 前将 Buffer 转码为纯净的 UTF-8 Buffer 传给 Pi 的 `OutputAccumulator`；
  4. 编写针对 Windows CP936 典型报错字节流的 TDD 单元测试。

### Task 2: 大工具输出本地持久化与快照旁路 (Large Output Persistence)
- **目标**：当工具输出过大（> 3000 字符）时，自动将完整日志落盘至 `<workspace>/.cph/artifacts/`，并向模型提供清晰的截断摘要与本地文件指引。
- **涉及文件**：
  - `CPH-PI/src/protocol/tool-bridge.ts`
  - `CPH-PI/tests/protocol/large-output-persistence.test.ts`
- **实施要点**：
  1. 在 `ToolBridge.executeAction` 中检测 `output.length > 3000`；
  2. 自动在 `<workspaceRoot>/.cph/artifacts/tool-output-<timestamp>.log` 写入完整内容；
  3. 将送回模型的工具结果优化为前 20 行 + 后 20 行 + 文件路径提示，大幅节省 Token 并防止上下文溢出。

### Task 3: 高保真结构化交接文档合成器 (Handover Document Synthesizer)
- **目标**：将 30 轮的简单动作流水账升级为工业级 5 维结构化交接文档，并自动落盘保存。
- **涉及文件**：
  - `CPH-PI/src/agent/orchestrator.ts`
  - `CPH-PI/tests/agent/handover-synthesizer.test.ts`
- **实施要点**：
  1. 重构 `generateHandoffSnapshot` 为标准的 5 维交接文档：
     - 【原始任务与核心诉求】
     - 【已验证事实与阶段性成就】
     - 【关键卡点、报错与最新诊断】
     - 【已变更/生成文件清单】
     - 【接力第一优先级待办事项 (Actionable Next Steps)】；
  2. 自动将交接文档落盘到 `<workspace>/.cph/handoffs/handoff-<sessionId>.md`；
  3. 编写 TDD 单元测试验证各模块的提取逻辑与结构完整性。

### Task 4: Auto-Handoff 自主无感换会话接力循环 (Autonomous Continuation Loop)
- **目标**：达到最大轮次时，CLI 自动无缝切换到新会话并自主继续执行，无需人工干预，直到完成交付。
- **涉及文件**：
  - `CPH-PI/src/cli.ts`
  - `CPH-PI/tests/cli/autonomous-handoff.test.ts`
- **实施要点**：
  1. 在 `CphPiCli.executeTask` 中增加自主接力循环；
  2. 当 `result.handedOff` 为 true 时：
     - 保存旧会话并打印显目接力横幅；
     - 创建接力新会话；
     - 构造包含高保真交接文档的接力提示词；
     - 检查自主接力跳数限制（默认最多连续自主接力 3 次 / 120 轮）；
     - 立即自动发起下一轮 `executeTask`；
  3. 保留 Ctrl+C 随时安全暂停机制；
  4. 编写全链路模拟端到端测试。

### Task 5: 全量回归测试与文档固化
- **目标**：全量执行 `bun test` 确保 100% 绿灯无退化，更新 `README.md`。
- **涉及文件**：
  - `CPH-PI/README.md`

