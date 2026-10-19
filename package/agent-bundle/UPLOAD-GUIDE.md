# Copilot M365 Agent 一键更新与配置指南 (Tri-Agent 架构)

本压缩包已为你聚合好了更新 Copilot Agent 体系所需的所有核心资产：包含 3 个专项智能体的提示词、PowerShell 执行指南知识库以及工作区专属技能包。

---

## 智能体配置与在线更新直达

### 1. Main 智能体 (Main Agent - 主协调中枢)
- **直达配置链接**: [Main Agent 编辑页](https://m365.cloud.microsoft/chat/agent/T_9ace94c8-cb78-caab-ddf7-4ae2d8f5a40d.93a3fbbc-c122-4a07-b670-857581a51135.gpt.94067efc-1741-4e5f-a603-b0573efa2852)
- **Agent ID**: `T_9ace94c8-cb78-caab-ddf7-4ae2d8f5a40d.93a3fbbc-c122-4a07-b670-857581a51135.gpt.94067efc-1741-4e5f-a603-b0573efa2852`
- **提示词文件**: `Instructions-Main-主协调智能体.txt`
- **更新步骤**:
  1. 点击上方直达链接进入 Agent 配置页面；
  2. 打开「配置」或「说明 (Instructions)」编辑框；
  3. 全选清空后，将 `Instructions-Main-主协调智能体.txt` 全文复制并粘贴进去；
  4. 点击右上角「保存 (Save)」或「更新 (Update)」。

### 2. Coder 智能体 (Coder Agent - 代码实现)
- **直达配置链接**: [Coder Agent 编辑页](https://m365.cloud.microsoft/chat/agent/T_c7c2ff36-0f20-091f-6f1b-e6d9a241b5ea.4a89c07f-839b-4880-9ce0-d769c4ec9375.gpt.b5725a70-9850-4f60-8446-cb4fe2345296)
- **Agent ID**: `T_c7c2ff36-0f20-091f-6f1b-e6d9a241b5ea.4a89c07f-839b-4880-9ce0-d769c4ec9375.gpt.b5725a70-9850-4f60-8446-cb4fe2345296`
- **提示词文件**: `Instructions-Coder-代码实现智能体.txt`
- **更新步骤**:
  1. 点击上方直达链接进入 Agent 配置页面；
  2. 打开「配置」或「说明 (Instructions)」编辑框；
  3. 全选清空后，将 `Instructions-Coder-代码实现智能体.txt` 全文复制并粘贴进去；
  4. 点击右上角「保存 (Save)」或「更新 (Update)」。

### 3. Researcher 智能体 (Researcher Agent - 深度调研)
- **直达配置链接**: [Researcher Agent 编辑页](https://m365.cloud.microsoft/chat/agent/T_970346be-8c26-0c5a-2f5e-e9f341d7614d.ac4af79e-acec-4578-8b0c-8d725dcf21ee.gpt.c0b8b1d4-a865-4c4c-a30e-dd3508e2bd7c)
- **Agent ID**: `T_970346be-8c26-0c5a-2f5e-e9f341d7614d.ac4af79e-acec-4578-8b0c-8d725dcf21ee.gpt.c0b8b1d4-a865-4c4c-a30e-dd3508e2bd7c`
- **提示词文件**: `Instructions-Researcher-深度调研智能体.txt`
- **更新步骤**:
  1. 点击上方直达链接进入 Agent 配置页面；
  2. 打开「配置」或「说明 (Instructions)」编辑框；
  3. 全选清空后，将 `Instructions-Researcher-深度调研智能体.txt` 全文复制并粘贴进去；
  4. 点击右上角「保存 (Save)」或「更新 (Update)」。

---

## 4. 专属知识库挂载指引 (Knowledge Base)

根据 Copilot Studio / M365 Agent 知识库格式支持（仅限 `*.docx; *.txt; *.pdf; *.pptx; *.xlsx; *.doc` 等格式，不支持 `.md`），本压缩包已为你生成多种可直接上传的文件（位于压缩包根目录及 `docs/` 目录）：
- **可选文件格式（三选一，均原生支持）**：
  1. `PowerShell-Agent-Guide.docx`（Word 文档，保留章节与排版）
  2. `PowerShell-Agent-Guide.txt`（纯文本文档，极简轻量，100% 原始字节保真）
  3. `PowerShell-Agent-Guide.pdf`（PDF 文档，标准固定版面）
- **挂载建议**: 推荐在 **Main**、**Coder** 与 **Researcher** 3 个 Agent 的「知识 (Knowledge)」板块均上传上述任一格式文件；
- **核心价值**:
  1. 规避跨 Shell 引号剥离与 `-f` 格式化操作符造成的冒号语法报错（`ParserError: (:)`）；
  2. 引导模型对多行逻辑采用生成独立 `.ps1` 脚本并以 `-File` 模式免转义执行；
  3. 兼容 Windows PowerShell 5.1 基础子集，阻断 PS 7+ 语法泄漏，消除命令行空转。

---

## 5. 专属技能挂载矩阵 (Skill Mounting Matrix)

在各 Agent 的「知识 (Knowledge)」或「功能 / 技能」板块分别挂载对应技能文件（位于本压缩包 `skills/` 目录）：

### 智能体技能挂载矩阵总览
- Main Agent: `skills/subagent` + `skills/handoff`
- Coder Agent: `skills/handoff` (no subagent)
- Researcher Agent: `skills/handoff` (no subagent)

### 详细挂载指引：
1. **Main 智能体** (Main Agent)：
   - **上传提示词**: `Instructions-Main-主协调智能体.txt`
   - **挂载技能**: `skills/subagent` 与 `skills/handoff`
   - **协作定位**: 作为总控中枢，使用 `skills/subagent` 拆解并分派子任务，使用 `skills/handoff` 处理主会话接力与全流程宏观容灾。
2. **Coder 智能体** (Coder Agent)：
   - **上传提示词**: `Instructions-Coder-代码实现智能体.txt`
   - **挂载技能**: `skills/handoff` (no subagent)
   - **协作定位**: 保持单层扁平执行，仅挂载 `skills/handoff`（不挂载 `subagent`），在子任务轮次达到上限时自主接力续写代码。
3. **Researcher 智能体** (Researcher Agent)：
   - **上传提示词**: `Instructions-Researcher-深度调研智能体.txt`
   - **挂载技能**: `skills/handoff` (no subagent)
   - **协作定位**: 保持单层扁平执行，仅挂载 `skills/handoff`（不挂载 `subagent`），在长调研分析达到轮次上限时自主接力交付报告。

---

## 本地启动验证

配置生效后，在终端直接运行：
```bash
# 默认自动绑定 Tri-Agent 黄金三角架构
cph-pi <workspaceRoot>
```
或指定自定义 Agent：
```bash
cph-pi --agent <main-id> --coder-agent-id <coder-id> --researcher-agent-id <researcher-id> <workspaceRoot>
```
