# 架构设计规范：Harness 纯粹中立性保障与 PowerShell 双轨认知架构

## 1. 背景与问题诊断

在多智能体长时运行日志（`E:\test\.cph\logs\cph-terminal-2026-10-18T16-02-06.log` 与 `ses_20261019_0002_v7ux/subagents/sub-1-6eaaae-researcher.log`）中，系统暴露了三项相互关联的深层架构问题：

1. **Harness 提示词干预导致死循环 (Violation of Harness Neutrality)**：
   - `src/protocol/prompt-builder.ts` 中的 `buildToolResultPrompt` 在工具执行失败时，机械附带了 `请根据错误进行分析并尝试排查修复：`；
   - 模型在收到该指令后，将其视为必须执行的下步命令，导致其在同一个语法错误的 PowerShell 命令上连续重试 26 轮以上，耗尽推理预算；
   - 这严重违背了《AGENTS.md》核心治理准则第一条【Harness 纯粹与中立原则】：Harness 绝不对模型决策做先验引导，严禁替模型擦屁股。

2. **主控工单被高阶业务 Skill 深度污染 (Cognitive Coupling in Scout Dispatch)**：
   - 主控在第一阶段向轻量级斥候（Scout / Researcher）派发工单时，将当前激活的高阶业务 Skill（如 `thermo-nuclear-code-quality-review`）的 1433 行深层审查规范、重构建议与状态所有权分析全部倾倒进 Prompt；
   - 导致本应仅负责“快速摸清结构大纲与函数行号范围”的斥候不堪重负，试图使用复杂 AST 脚本深度分析整个文件，引发认知超载与超时。

3. **跨环境 Shell 转义与 PowerShell 语法盲区 (PowerShell Syntax & Escaping Pitfalls)**：
   - 大模型在 Windows / Git Bash 环境下使用 `powershell.exe -Command "..."` 时，对引号嵌套、格式化操作符 `-f`（如 `"{0}: {1}" -f ...` 缺少外层保护导致冒号触发 `Unexpected token ':'`）、`Where-Object` 语法及 PowerShell 5.1 / 7+ 版本差异缺乏稳健认知；
   - 在日志中频繁出现 `ParserError: (:)`、`MissingVariableNameAfterForeach`、`ObjectNotFound: (=Stop:String)` 等典型错误。

---

## 2. 核心架构决策

### 决策 1：Harness 纯粹与客观事实中立 (Pure ToolBridge Neutrality)
- **目标**：彻底删除 `prompt-builder.ts` 中的主观引导词。
- **协议契约**：
  - 成功时返回：
    ```text
    [TOOL_RESULT for <tool> - SUCCESS]:
    <output>

    <PROTOCOL_REMINDER>
    ```
  - 失败时返回：
    ```text
    [TOOL_RESULT for <tool> - FAILED]:
    Error: <error>
    Output: <output>

    <PROTOCOL_REMINDER>
    ```
  - Harness 保持 100% 客观中立，只陈述客观事实，不指导、不干预模型下步动作。

### 决策 2：斥候提示词纯粹化与认知正向解耦 (Pure Scout Outline & Two-Stage Decoupling)
- **目标**：主控派发斥候时，严格遵循物理三大指标，与高阶业务技能完全解耦。
- **两阶段调度契约**：
  - **第一阶段（斥候领航）**：派发 Prompt 专注于物理大纲三大指标：
    1. 顶层结构列表（类、函数清单与大致行号范围）；
    2. 输入/输出数据流拓扑简图；
    3. 建议的后续精细切片范围（按物理行号划分，每切片 ≤300 行）。
  - **第二阶段（集群攻坚）**：主控审阅大纲并落盘 `plan.md` 后，调派 Coder / Reviewer 集群时，才将内化的高阶业务技能标准（深度审查重点、状态与并发排查、测试命令等）定向注入具体工单。
- **正向引导铁律**：Prompt 与 Skill 文档全面摒弃“严禁/切勿/不要/杜绝”等负面禁止词，采用建设性正向引导。

### 决策 3：PowerShell 双轨认知架构 (Dual-Track PowerShell Knowledge)
- **形态 2（系统提示词内置原生指引 - Track A）**：
  - 在 `cph-main-agent-prompt.txt`、`cph-researcher-agent-prompt.txt`、`cph-coder-agent-prompt.txt` 的命令执行章节中，直接嵌入 10 行原生稳健的 PowerShell 执行指引：
    1. 字符串拼接优先使用原生变量内插（`"$($_.Name): $($_.Extent.StartLineNumber)"`），避免使用 `-f` 格式化操作符；
    2. 多行复杂脚本或 AST 语法统一通过原生文件生成落盘为 `.ps1` 脚本，再通过 `-File script.ps1` 执行，彻底避开跨平台 Shell 引号剥离与转义陷阱；
    3. 语法以 Windows PowerShell 5.1 基础子集为准，避免使用 `&&`、`||` 或三元运算符。
- **形态 1（专属知识库文档 - Track B）**：
  - 编写深度指南 `docs/PowerShell-Agent-Guide.md`；
  - 提炼常见语法错误清单（ParserError、Colon Token、MissingVariableName、Where-Object 语法、.NET 静态方法调用等）；
  - 更新打包脚本 `scripts/package-agent-bundle.ts` 与指南 `UPLOAD-GUIDE.md`，将该知识库自动打包至 `copilot-agent-bundle.zip`，供 Copilot Studio 知识库挂载。

---

## 3. 组件影响面与变更矩阵

| 组件/文件 | 变更性质 | 核心修改点 |
|---|---|---|
| `src/protocol/prompt-builder.ts` | 核心协议 | 移除 `请根据错误进行分析并尝试排查修复：` |
| `tests/protocol/prompt-builder.test.ts` | 单元测试 | 更新单测断言，确保失败提示词中无主观引导词 |
| `cph-main-agent-prompt.txt` | 系统提示词 | 注入 PowerShell 原生执行指引；正向重构斥候工单与派发规范 |
| `cph-researcher-agent-prompt.txt` | 系统提示词 | 注入 PowerShell 原生执行指引与 `-File` 模式说明 |
| `cph-coder-agent-prompt.txt` | 系统提示词 | 注入 PowerShell 原生执行指引与测试命令规范 |
| `skills/subagent/SKILL.md` | 工作区技能 | 重构斥候模板为物理大纲三指标，正向描述技能延后注入 |
| `docs/PowerShell-Agent-Guide.md` | 知识库文档 | 新建完整的 Agent PowerShell 避坑与实战指南 |
| `scripts/package-agent-bundle.ts` | 发布打包 | 将知识库文档纳入 bundle 并在上传指南中指引挂载 |
| `UPLOAD-GUIDE.md` | 文档指引 | 同步更新知识库上传说明 |

---

## 4. 验证与验收标准

1. **协议中立性测试**：`tests/protocol/prompt-builder.test.ts` 100% 绿灯，验证 `buildToolResultPrompt` 在失败场景下仅输出错误与输出事实，绝不包含排查引导。
2. **系统提示词规范测试**：`tests/skills/tri-agent-prompts.test.ts` 验证三大 Agent 提示词均包含 PowerShell 引导，且不包含负面禁止词（如“严禁”、“切勿”）。
3. **打包闭环验证**：执行 `bun run build:package` 与 `bun run package`，验证 ZIP 包完整包含所有系统提示词、工作区技能及 `PowerShell-Agent-Guide.md`。
4. **全量回归测试**：全量执行 `bun test` 确保无任何已有测试受损。

