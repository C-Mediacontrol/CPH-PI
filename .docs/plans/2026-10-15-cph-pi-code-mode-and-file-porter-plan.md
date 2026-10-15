# CPH-PI Code Mode 与 File Porter 实施计划
(Implementation Plan: Code Mode & Native File Porter)

- **计划标识**: `PLAN-20261015-CODE-MODE-AND-FILE-PORTER`
- **基于设计规范**: [`CPH-PI/.docs/specs/2026-10-15-cph-pi-code-mode-and-file-porter-design.md`](file:///e:/copilot-web%20proxy/CPH-PI/.docs/specs/2026-10-15-cph-pi-code-mode-and-file-porter-design.md)
- **创建日期**: `2026-10-15`
- **状态**: `IN_PROGRESS`
- **对应目标目录**: `CPH-PI/`

---

## 阶段目标

构建“Copilot 原生文件生成 ➔ Harness 搬运工秒级下载 ➔ 宿主解释器执行 ➔ 结果对账回传”的完整闭环，从根本上解决内联长代码截断与微单步工具调用耗尽会话轮次的问题。

---

## 任务拆解与检查清单

- [ ] **任务 1：系统提示词升级 (Prompts Enhancement)**
  - 更新 [cph-main-agent-prompt.txt](file:///e:/copilot-web%20proxy/CPH-PI/cph-main-agent-prompt.txt)：将 `write_file(content=...)` 替换为正向的原生文件生成与 Code Mode 契约，遵循纯正向铁律（无“不要/切勿/严禁”）；
  - 更新 [cph-dev-agent-prompt.txt](file:///e:/copilot-web%20proxy/CPH-PI/cph-dev-agent-prompt.txt)：同步替换；
  - 更新 [cph-coder-agent-prompt.txt](file:///e:/copilot-web%20proxy/CPH-PI/cph-coder-agent-prompt.txt) 与 [cph-researcher-agent-prompt.txt](file:///e:/copilot-web%20proxy/CPH-PI/cph-researcher-agent-prompt.txt)；
  - 验证命令：测试各 Prompt 文件中不含负面禁止词，且规范格式完好。

- [ ] **任务 2：下行文件下载卡片解析 (ResilientParser Extension)**
  - 在 `CPH-PI/src/protocol/resilient-parser.ts` 中增强对原生下载链接（如 `<a ... download="filename" href="...">` 或 `[下载 filename](...)`）的解析；
  - 当模型未显式输出 `action` 代码块但输出了下载文件卡片时，识别为 `file_generated` 或自动映射为执行/搬运动作。

- [ ] **任务 3：落地 File Porter 搬运模块 (File Porter Module)**
  - 创建 `CPH-PI/src/transport/file-porter.ts`：
    - 针对 CDP 模式：通过页面上下文直接 `fetch(blobUrl)` 并无损保存至目标路径；
    - 针对独立脚本（`.py`, `.ts`, `.js`, `.ps1`）：自动调度本地解释器（`python.exe`, `node.exe`, `bun`, `pwsh.exe`）执行；
    - 执行结果捕获并包装为标准 `【TOOL_RESULT: file_execution】` 格式回传。

- [ ] **任务 4：单元测试与行为验证 (Unit Testing & Verification)**
  - 在 `CPH-PI/tests/` 下编写针对 `FilePorter` 与 `ResilientParser` 下载解析的单元测试；
  - 运行 `bun test` 确保所有既有测试与新测试 100% 通过。

