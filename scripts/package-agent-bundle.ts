import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

/**
 * CPH-PI Copilot Agent & Skills Packager
 * Packages system prompts and workspace-specific skills into ready-to-upload bundles.
 */

const projectRoot = path.resolve(__dirname, "..");
const skillsDir = path.join(projectRoot, "skills");
const distDir = path.join(projectRoot, "dist");
const bundleDir = path.join(distDir, "copilot-agent-bundle");
const zipPath = path.join(distDir, "copilot-agent-bundle.zip");

console.log("📦 [Packager] 开始构建 Copilot M365 Agent 上传包 (Tri-Agent 架构)...");

// 1. Prepare dist directories
if (fs.existsSync(bundleDir)) {
  fs.rmSync(bundleDir, { recursive: true, force: true });
}
if (fs.existsSync(zipPath)) {
  fs.rmSync(zipPath, { force: true });
}
fs.mkdirSync(bundleDir, { recursive: true });

// 2. Copy and format System Prompts for Tri-Agent architecture
const promptMappings = [
  {
    src: "cph-main-agent-prompt.txt",
    dest: "Instructions-Main-主协调智能体.txt",
    title: "Main 主协调智能体",
    agentId: "T_9ace94c8-cb78-caab-ddf7-4ae2d8f5a40d.93a3fbbc-c122-4a07-b670-857581a51135.gpt.94067efc-1741-4e5f-a603-b0573efa2852",
    url: "https://m365.cloud.microsoft/chat/agent/T_9ace94c8-cb78-caab-ddf7-4ae2d8f5a40d.93a3fbbc-c122-4a07-b670-857581a51135.gpt.94067efc-1741-4e5f-a603-b0573efa2852",
  },
  {
    src: "cph-coder-agent-prompt.txt",
    dest: "Instructions-Coder-代码实现智能体.txt",
    title: "Coder 代码实现智能体",
    agentId: "T_c7c2ff36-0f20-091f-6f1b-e6d9a241b5ea.4a89c07f-839b-4880-9ce0-d769c4ec9375.gpt.b5725a70-9850-4f60-8446-cb4fe2345296",
    url: "https://m365.cloud.microsoft/chat/agent/T_c7c2ff36-0f20-091f-6f1b-e6d9a241b5ea.4a89c07f-839b-4880-9ce0-d769c4ec9375.gpt.b5725a70-9850-4f60-8446-cb4fe2345296",
  },
  {
    src: "cph-researcher-agent-prompt.txt",
    dest: "Instructions-Researcher-深度调研智能体.txt",
    title: "Researcher 深度调研智能体",
    agentId: "T_970346be-8c26-0c5a-2f5e-e9f341d7614d.ac4af79e-acec-4578-8b0c-8d725dcf21ee.gpt.c0b8b1d4-a865-4c4c-a30e-dd3508e2bd7c",
    url: "https://m365.cloud.microsoft/chat/agent/T_970346be-8c26-0c5a-2f5e-e9f341d7614d.ac4af79e-acec-4578-8b0c-8d725dcf21ee.gpt.c0b8b1d4-a865-4c4c-a30e-dd3508e2bd7c",
  },
];

for (const p of promptMappings) {
  const srcPath = path.join(projectRoot, p.src);
  if (!fs.existsSync(srcPath)) {
    console.warn(`⚠️ 未找到提示词文件: ${p.src}`);
    continue;
  }
  const content = fs.readFileSync(srcPath, "utf8");
  const targetPath = path.join(bundleDir, p.dest);
  fs.writeFileSync(targetPath, content, "utf8");
  console.log(`✔ 已打包提示词: [${p.title}] -> ${p.dest} (${content.length} 字符)`);
}

// Backward-compatible Instructions-系统提示词.txt
const devPromptPath = path.join(projectRoot, "cph-dev-agent-prompt.txt");
const fallbackMainPromptPath = path.join(projectRoot, "cph-main-agent-prompt.txt");
const legacySrc = fs.existsSync(devPromptPath) ? devPromptPath : fallbackMainPromptPath;
if (fs.existsSync(legacySrc)) {
  const content = fs.readFileSync(legacySrc, "utf8");
  fs.writeFileSync(path.join(bundleDir, "Instructions-系统提示词.txt"), content, "utf8");
  console.log(`✔ 已保留兼容提示词 -> Instructions-系统提示词.txt (${content.length} 字符)`);
}

// 3. Copy workspace skills (including skills/subagent & skills/handoff)
const targetSkillsDir = path.join(bundleDir, "skills");
fs.mkdirSync(targetSkillsDir, { recursive: true });

let skillCount = 0;
if (fs.existsSync(skillsDir)) {
  const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const srcSkillDir = path.join(skillsDir, entry.name);
      const destSkillDir = path.join(targetSkillsDir, entry.name);
      fs.cpSync(srcSkillDir, destSkillDir, { recursive: true });
      skillCount++;
      console.log(`✔ 已打包工作区技能: ${entry.name}`);
    }
  }
}

// Verify that skills/subagent is packaged
const subagentSkillDir = path.join(targetSkillsDir, "subagent");
if (fs.existsSync(subagentSkillDir)) {
  console.log(`✔ 校验通过: skills/subagent 已成功纳入发布包`);
} else {
  console.warn(`⚠️ 警告: 发布包内未检测到 skills/subagent`);
}

// 4. Generate Upload Guide with Tri-Agent links
const uploadGuideContent = `# Copilot M365 Agent 一键更新与配置指南 (Tri-Agent 架构)

本压缩包已为你聚合好了更新 Copilot Agent 体系所需的所有核心资产：包含 3 个专项智能体的提示词以及工作区专属技能包。

---

## 智能体配置与在线更新直达

### 1. Main - 主协调智能体 (Master Coordinator)
- **直达配置链接**: [Main Agent 编辑页](https://m365.cloud.microsoft/chat/agent/T_9ace94c8-cb78-caab-ddf7-4ae2d8f5a40d.93a3fbbc-c122-4a07-b670-857581a51135.gpt.94067efc-1741-4e5f-a603-b0573efa2852)
- **Agent ID**: \`T_9ace94c8-cb78-caab-ddf7-4ae2d8f5a40d.93a3fbbc-c122-4a07-b670-857581a51135.gpt.94067efc-1741-4e5f-a603-b0573efa2852\`
- **提示词文件**: \`Instructions-Main-主协调智能体.txt\`
- **更新步骤**:
  1. 点击上方直达链接进入 Agent 配置页面；
  2. 打开「配置」或「说明 (Instructions)」编辑框；
  3. 全选清空后，将 \`Instructions-Main-主协调智能体.txt\` 全文复制并粘贴进去；
  4. 点击右上角「保存 (Save)」或「更新 (Update)」。

### 2. Coder - 代码实现智能体 (Execution Subagent)
- **直达配置链接**: [Coder Agent 编辑页](https://m365.cloud.microsoft/chat/agent/T_c7c2ff36-0f20-091f-6f1b-e6d9a241b5ea.4a89c07f-839b-4880-9ce0-d769c4ec9375.gpt.b5725a70-9850-4f60-8446-cb4fe2345296)
- **Agent ID**: \`T_c7c2ff36-0f20-091f-6f1b-e6d9a241b5ea.4a89c07f-839b-4880-9ce0-d769c4ec9375.gpt.b5725a70-9850-4f60-8446-cb4fe2345296\`
- **提示词文件**: \`Instructions-Coder-代码实现智能体.txt\`
- **更新步骤**:
  1. 点击上方直达链接进入 Agent 配置页面；
  2. 打开「配置」或「说明 (Instructions)」编辑框；
  3. 全选清空后，将 \`Instructions-Coder-代码实现智能体.txt\` 全文复制并粘贴进去；
  4. 点击右上角「保存 (Save)」或「更新 (Update)」。

### 3. Researcher - 深度调研智能体 (Read-Only Analysis Subagent)
- **直达配置链接**: [Researcher Agent 编辑页](https://m365.cloud.microsoft/chat/agent/T_970346be-8c26-0c5a-2f5e-e9f341d7614d.ac4af79e-acec-4578-8b0c-8d725dcf21ee.gpt.c0b8b1d4-a865-4c4c-a30e-dd3508e2bd7c)
- **Agent ID**: \`T_970346be-8c26-0c5a-2f5e-e9f341d7614d.ac4af79e-acec-4578-8b0c-8d725dcf21ee.gpt.c0b8b1d4-a865-4c4c-a30e-dd3508e2bd7c\`
- **提示词文件**: \`Instructions-Researcher-深度调研智能体.txt\`
- **更新步骤**:
  1. 点击上方直达链接进入 Agent 配置页面；
  2. 打开「配置」或「说明 (Instructions)」编辑框；
  3. 全选清空后，将 \`Instructions-Researcher-深度调研智能体.txt\` 全文复制并粘贴进去；
  4. 点击右上角「保存 (Save)」或「更新 (Update)」。

---

## 4. 上传知识库 / 专属技能 (Knowledge & Skills)

在各 Agent 的「知识 (Knowledge)」或「功能 / 技能」板块：
- **Main Agent**: 可上传 \`skills/subagent/SKILL.md\` 与 \`skills/handoff/SKILL.md\`；
- **Coder & Researcher**: 子代理默认以纯净上下文运行，无需上传额外冗余技能，最大化保留代码与分析上下文。

---

## 本地启动验证

配置生效后，在终端直接运行：
\`\`\`bash
# 默认自动绑定 Tri-Agent 黄金三角架构
cph-pi <workspaceRoot>
\`\`\`
或指定自定义 Agent：
\`\`\`bash
cph-pi --agent <main-id> --coder-agent-id <coder-id> --researcher-agent-id <researcher-id> <workspaceRoot>
\`\`\`
`;

fs.writeFileSync(path.join(bundleDir, "UPLOAD-GUIDE.md"), uploadGuideContent, "utf8");

// 5. Compress into ZIP using PowerShell
try {
  const psCmd = `powershell -NoProfile -Command "Compress-Archive -Path '${bundleDir}\\*' -DestinationPath '${zipPath}' -Force"`;
  execSync(psCmd, { stdio: "pipe" });
  console.log(`\n🎉 打包完成！ZIP 文件已生成至:`);
  console.log(`👉 ${zipPath}`);
  console.log(`👉 文件夹目录: ${bundleDir}`);
} catch (e: any) {
  console.warn(`⚠️ ZIP 压缩命令执行警告: ${e.message}，但解压文件夹已就绪: ${bundleDir}`);
}
