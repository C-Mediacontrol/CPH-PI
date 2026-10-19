# 实施计划：Harness 纯粹中立性保障与 PowerShell 双轨认知架构

## 任务背景与目标
基于架构规范 `.docs/specs/2026-10-19-harness-neutrality-and-powershell-knowledge-design.md`，执行以下 5 项任务，实现 Harness 客观中立性、斥候两阶段解耦与 PowerShell 双轨认知保障。

---

## 任务分解

### Task 1: 净化 Harness 提示词构建器 (Harness Neutrality Cleanup)
- **目标文件**: `src/protocol/prompt-builder.ts`, `tests/protocol/prompt-builder.test.ts`
- **实施要点**:
  - 在 `PromptBuilder.buildToolResultPrompt` 中，删除失败场景下的 `请根据错误进行分析并尝试排查修复：`；
  - 更新单测 `tests/protocol/prompt-builder.test.ts`，验证失败提示词仅包含状态行、Error、Output 和协议提醒，断言绝不包含任何主观排查指令；
  - 运行 `bun test tests/protocol/prompt-builder.test.ts` 确保通过。

### Task 2: 斥候工单解耦与物理大纲标准重构 (Pure Scout Outline Refactoring)
- **目标文件**: `cph-main-agent-prompt.txt`, `skills/subagent/SKILL.md`
- **实施要点**:
  - 在 `cph-main-agent-prompt.txt` 中：
    - 正向阐明主控在第一阶段向斥候派发工单时，聚焦于物理大纲三大指标（类/函数行号范围、输入输出数据流、≤300 行后续切片建议）；
    - 所有高阶业务技能（深度审查、排错、安全）完全由主控在心智中统筹内化，留待第二阶段调派集群工单时精准注入；
    - 消除提示词中的负面禁止词（如“严禁……”、“切勿……”），转为正向建设性引导；
  - 在 `skills/subagent/SKILL.md` 中：
    - 更新斥候模板的标准内容，聚焦于三大物理指标的大纲梳理；
    - 完善两阶段派发指引，消除模板中的高阶审查引导。

### Task 3: 系统提示词内置原生 PowerShell 执行指引 (Embedded PowerShell Guide)
- **目标文件**: `cph-main-agent-prompt.txt`, `cph-researcher-agent-prompt.txt`, `cph-coder-agent-prompt.txt`
- **实施要点**:
  - 在三个系统提示词的命令执行说明中，统一嵌入 10 行原生稳健的 PowerShell 执行指引：
    1. 字符串拼接优先使用原生变量内插（`"$($_.Name): $($_.Extent.StartLineNumber)"`），避免使用 `-f` 格式化操作符；
    2. 多行复杂脚本或 AST 语法统一通过原生文件生成落盘为 `.ps1` 脚本，再通过 `-File script.ps1` 执行，彻底避开跨平台 Shell 引号剥离与转义陷阱；
    3. 语法以 Windows PowerShell 5.1 基础子集为准，避免使用 `&&`、`||` 或三元运算符；
  - 遵循正向引导铁律，语言精炼，不增加认知负担。

### Task 4: 编写并打包专属知识库《PowerShell-Agent-Guide.md》 (Track B Knowledge)
- **目标文件**: `docs/PowerShell-Agent-Guide.md`, `scripts/package-agent-bundle.ts`, `UPLOAD-GUIDE.md`
- **实施要点**:
  - 创建 `docs/PowerShell-Agent-Guide.md`，内容涵盖：
    1. PowerShell 在 Agent 自动化环境下的执行机制与版本差异（Windows PowerShell 5.1 vs Core 7+）；
    2. 命令行引号剥离与嵌套陷阱（为什么 `-f` 操作符会变成冒号语法错误）；
    3. 常见报错根因与标准正向写法对照表（ParserError、MissingVariableName、Where-Object 语法、.NET 静态类调用）；
    4. 复杂任务黄金范式：生成独立 `.ps1` 脚本并使用 `-File` 执行；
  - 更新 `scripts/package-agent-bundle.ts`，将 `docs/PowerShell-Agent-Guide.md` 拷贝到发布包根目录与 `dist/copilot-agent-bundle/` 下；
  - 更新 `UPLOAD-GUIDE.md`，增加知识库上传指引。

### Task 5: 自动化测试套件扩展、全量回归与打包验证 (Verification & Bundle Rebuild)
- **目标文件**: `tests/skills/tri-agent-prompts.test.ts`
- **实施要点**:
  - 扩展 `tests/skills/tri-agent-prompts.test.ts`，验证：
    1. 三个系统提示词均包含原生 PowerShell 执行指引；
    2. 提示词与技能文档中无负面禁止词；
    3. 斥候模板聚焦于物理大纲三大指标；
    4. 发布包构建脚本能正确打包知识库文档；
  - 运行 `bun test` 确保 100% 测试通过；
  - 运行 `bun run build:package` 与 `bun run package` 生成最终发布包。

