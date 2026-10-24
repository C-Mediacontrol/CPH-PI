import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

/**
 * CPH-PI Copilot Agent & Skills Packager
 * Packages system prompts and workspace-specific skills into ready-to-upload bundles.
 * Synchronizes outputs to both dist/copilot-agent-bundle and package/agent-bundle/.
 */

const projectRoot = path.resolve(__dirname, "..");
const skillsDir = path.join(projectRoot, "skills");
const distDir = path.join(projectRoot, "dist");
const bundleDir = path.join(distDir, "copilot-agent-bundle");
const zipPath = path.join(distDir, "copilot-agent-bundle.zip");
const packageBundleDir = path.join(projectRoot, "package", "agent-bundle");

console.log("📦 [Packager] 开始构建 Copilot M365 Agent 上传包 (Dual-Agent & Dev 兼容架构)...");

// 1. Prepare dist & package directories
if (fs.existsSync(bundleDir)) {
  fs.rmSync(bundleDir, { recursive: true, force: true });
}
if (fs.existsSync(zipPath)) {
  fs.rmSync(zipPath, { force: true });
}
fs.mkdirSync(bundleDir, { recursive: true });
fs.mkdirSync(packageBundleDir, { recursive: true });

// Clean up stale researcher artifacts from package/agent-bundle/
const stalePackageFiles = [
  path.join(packageBundleDir, "Instructions-Researcher-深度调研智能体.txt"),
  path.join(packageBundleDir, "cph-researcher-agent-prompt.txt"),
];
for (const sf of stalePackageFiles) {
  if (fs.existsSync(sf)) {
    fs.rmSync(sf, { force: true });
    console.log(`🧹 已清理旧版 Researcher 产物: ${path.basename(sf)}`);
  }
}

// 2. Copy and format System Prompts for Dual-Agent architecture
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
];

for (const p of promptMappings) {
  const srcPath = path.join(projectRoot, p.src);
  if (!fs.existsSync(srcPath)) {
    console.warn(`⚠️ 未找到提示词文件: ${p.src}`);
    continue;
  }
  const content = fs.readFileSync(srcPath, "utf8");
  // Write to dist/copilot-agent-bundle
  const targetPath = path.join(bundleDir, p.dest);
  fs.writeFileSync(targetPath, content, "utf8");
  // Sync to package/agent-bundle/
  fs.writeFileSync(path.join(packageBundleDir, p.dest), content, "utf8");
  console.log(`✔ 已打包提示词: [${p.title}] -> ${p.dest} (${content.length} 字符)`);
}

// Backward-compatible Instructions-系统提示词.txt (from cph-dev-agent-prompt.txt)
const devPromptPath = path.join(projectRoot, "cph-dev-agent-prompt.txt");
const fallbackMainPromptPath = path.join(projectRoot, "cph-main-agent-prompt.txt");
const legacySrc = fs.existsSync(devPromptPath) ? devPromptPath : fallbackMainPromptPath;
if (fs.existsSync(legacySrc)) {
  const content = fs.readFileSync(legacySrc, "utf8");
  fs.writeFileSync(path.join(bundleDir, "Instructions-系统提示词.txt"), content, "utf8");
  fs.writeFileSync(path.join(packageBundleDir, "Instructions-系统提示词.txt"), content, "utf8");
  console.log(`✔ 已保留兼容提示词 -> Instructions-系统提示词.txt (${content.length} 字符)`);
}

// 2.5 Sync raw prompt files to package/agent-bundle/
const rawPromptFiles = [
  "cph-main-agent-prompt.txt",
  "cph-coder-agent-prompt.txt",
  "cph-dev-agent-prompt.txt",
];
for (const pf of rawPromptFiles) {
  const srcPath = path.join(projectRoot, pf);
  if (fs.existsSync(srcPath)) {
    const content = fs.readFileSync(srcPath, "utf8");
    fs.writeFileSync(path.join(packageBundleDir, pf), content, "utf8");
    console.log(`✔ 已同步源码提示词至 package/agent-bundle/: ${pf}`);
  }
}

// 3. Copy workspace skills (including skills/subagent & skills/handoff)
const targetSkillsDir = path.join(bundleDir, "skills");
const packageSkillsDir = path.join(packageBundleDir, "skills");
fs.mkdirSync(targetSkillsDir, { recursive: true });
fs.mkdirSync(packageSkillsDir, { recursive: true });

let skillCount = 0;
if (fs.existsSync(skillsDir)) {
  const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const srcSkillDir = path.join(skillsDir, entry.name);
      const destSkillDir = path.join(targetSkillsDir, entry.name);
      const destPackageSkillDir = path.join(packageSkillsDir, entry.name);
      fs.cpSync(srcSkillDir, destSkillDir, { recursive: true });
      fs.cpSync(srcSkillDir, destPackageSkillDir, { recursive: true });
      skillCount++;
      console.log(`✔ 已打包工作区技能: ${entry.name}`);
    }
  }
}

// Verify that skills/subagent and skills/handoff are packaged
const subagentSkillDir = path.join(targetSkillsDir, "subagent");
const handoffSkillDir = path.join(targetSkillsDir, "handoff");
if (fs.existsSync(subagentSkillDir)) {
  console.log(`✔ 校验通过: skills/subagent 已成功纳入发布包`);
} else {
  console.warn(`⚠️ 警告: 发布包内未检测到 skills/subagent`);
}
if (fs.existsSync(handoffSkillDir)) {
  console.log(`✔ 校验通过: skills/handoff 已成功纳入发布包`);
} else {
  console.warn(`⚠️ 警告: 发布包内未检测到 skills/handoff`);
}

// 3.5 Copy Knowledge documents (PowerShell Agent Guide in docx, txt, pdf, md formats)
const docsDir = path.join(projectRoot, "docs");
const targetDocsDir = path.join(bundleDir, "docs");
const packageDocsDir = path.join(packageBundleDir, "docs");
fs.mkdirSync(targetDocsDir, { recursive: true });
fs.mkdirSync(packageDocsDir, { recursive: true });

const knowledgeFiles = [
  "PowerShell-Agent-Guide.docx",
  "PowerShell-Agent-Guide.txt",
  "PowerShell-Agent-Guide.pdf",
  "PowerShell-Agent-Guide.md",
];

for (const kf of knowledgeFiles) {
  const src = path.join(docsDir, kf);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(targetDocsDir, kf));
    fs.copyFileSync(src, path.join(bundleDir, kf));
    fs.copyFileSync(src, path.join(packageDocsDir, kf));
    fs.copyFileSync(src, path.join(packageBundleDir, kf));
    console.log(`✔ 已打包知识库文档: ${kf}`);
  }
}

// 4. Generate Upload Guide with Dual-Agent links, Knowledge upload, and skill mounting matrix
const uploadGuideContent = `# Copilot M365 Agent 一键更新与配置指南 (Dual-Agent 架构)

本压缩包已为你聚合好了更新 Copilot Agent 体系所需的所有核心资产：包含 2 个专项智能体（Main 主协调智能体与 Coder 代码实现智能体）的提示词、PowerShell 执行指南知识库以及工作区专属技能包。

---

## 智能体配置与在线更新直达

### 1. Main 智能体 (Main Agent - 主协调中枢)
- **直达配置链接**: [Main Agent 编辑页](https://m365.cloud.microsoft/chat/agent/T_9ace94c8-cb78-caab-ddf7-4ae2d8f5a40d.93a3fbbc-c122-4a07-b670-857581a51135.gpt.94067efc-1741-4e5f-a603-b0573efa2852)
- **Agent ID**: \`T_9ace94c8-cb78-caab-ddf7-4ae2d8f5a40d.93a3fbbc-c122-4a07-b670-857581a51135.gpt.94067efc-1741-4e5f-a603-b0573efa2852\`
- **提示词文件**: \`Instructions-Main-主协调智能体.txt\`
- **更新步骤**:
  1. 点击上方直达链接进入 Agent 配置页面；
  2. 打开「配置」或「说明 (Instructions)」编辑框；
  3. 全选清空后，将 \`Instructions-Main-主协调智能体.txt\` 全文复制并粘贴进去；
  4. 点击右上角「保存 (Save)」或「更新 (Update)」。

### 2. Coder 智能体 (Coder Agent - 代码实现)
- **直达配置链接**: [Coder Agent 编辑页](https://m365.cloud.microsoft/chat/agent/T_c7c2ff36-0f20-091f-6f1b-e6d9a241b5ea.4a89c07f-839b-4880-9ce0-d769c4ec9375.gpt.b5725a70-9850-4f60-8446-cb4fe2345296)
- **Agent ID**: \`T_c7c2ff36-0f20-091f-6f1b-e6d9a241b5ea.4a89c07f-839b-4880-9ce0-d769c4ec9375.gpt.b5725a70-9850-4f60-8446-cb4fe2345296\`
- **提示词文件**: \`Instructions-Coder-代码实现智能体.txt\`
- **更新步骤**:
  1. 点击上方直达链接进入 Agent 配置页面；
  2. 打开「配置」或「说明 (Instructions)」编辑框；
  3. 全选清空后，将 \`Instructions-Coder-代码实现智能体.txt\` 全文复制并粘贴进去；
  4. 点击右上角「保存 (Save)」或「更新 (Update)」。

---

## 3. 专属知识库挂载指引 (Knowledge Base)

根据 Copilot Studio / M365 Agent 知识库格式支持（仅限 \`*.docx; *.txt; *.pdf; *.pptx; *.xlsx; *.doc\` 等格式，不支持 \`.md\`），本压缩包已为你生成多种可直接上传的文件（位于压缩包根目录及 \`docs/\` 目录）：
- **可选文件格式（三选一，均原生支持）**：
  1. \`PowerShell-Agent-Guide.docx\`（Word 文档，保留章节与排版）
  2. \`PowerShell-Agent-Guide.txt\`（纯文本文档，极简轻量，100% 原始字节保真）
  3. \`PowerShell-Agent-Guide.pdf\`（PDF 文档，标准固定版面）
- **挂载建议**: 推荐在 **Main** 与 **Coder** 2 个 Agent 的「知识 (Knowledge)」板块均上传上述任一格式文件；
- **核心价值**:
  1. 规避跨 Shell 引号剥离与 \`-f\` 格式化操作符造成的冒号语法报错（\`ParserError: (:)\`）；
  2. 引导模型对多行逻辑采用生成独立 \`.ps1\` 脚本并以 \`-File\` 模式免转义执行；
  3. 兼容 Windows PowerShell 5.1 基础子集，阻断 PS 7+ 语法泄漏，消除命令行空转。

---

## 4. 专属技能挂载矩阵 (Skill Mounting Matrix)

在各 Agent 的「知识 (Knowledge)」或「功能 / 技能」板块分别挂载对应技能文件（位于本压缩包 \`skills/\` 目录）：

### 智能体技能挂载矩阵总览
- Main Agent: \`skills/subagent\` + \`skills/handoff\`
- Coder Agent: \`skills/handoff\` (no subagent)

### 详细挂载指引：
1. **Main 智能体** (Main Agent)：
   - **上传提示词**: \`Instructions-Main-主协调智能体.txt\`
   - **挂载技能**: \`skills/subagent\` 与 \`skills/handoff\`
   - **协作定位**: 作为总控中枢，使用 \`skills/subagent\` 拆解并分派子任务，使用 \`skills/handoff\` 处理主会话接力与全流程宏观容灾。
2. **Coder 智能体** (Coder Agent)：
   - **上传提示词**: \`Instructions-Coder-代码实现智能体.txt\`
   - **挂载技能**: \`skills/handoff\` (no subagent)
   - **协作定位**: 保持单层扁平执行，仅挂载 \`skills/handoff\`（不挂载 \`subagent\`），在子任务轮次达到上限时自主接力续写代码。

---

## 本地启动验证

配置生效后，在终端直接运行：
\`\`\`bash
# 默认自动绑定 Dual-Agent 架构
cph-pi <workspaceRoot>
\`\`\`
或指定自定义 Agent：
\`\`\`bash
cph-pi --agent <main-id> --coder-agent-id <coder-id> <workspaceRoot>
\`\`\`
`;

fs.writeFileSync(path.join(bundleDir, "UPLOAD-GUIDE.md"), uploadGuideContent, "utf8");
fs.writeFileSync(path.join(packageBundleDir, "UPLOAD-GUIDE.md"), uploadGuideContent, "utf8");

// 5. Compress into ZIP using PowerShell
try {
  const psCmd = `powershell -NoProfile -Command "Compress-Archive -Path '${bundleDir}\\*' -DestinationPath '${zipPath}' -Force"`;
  execSync(psCmd, { stdio: "pipe" });
  console.log(`\n🎉 打包完成！ZIP 文件已生成至:`);
  console.log(`👉 ${zipPath}`);
  console.log(`👉 文件夹目录: ${bundleDir}`);
  // Copy zip to package/agent-bundle/copilot-agent-bundle.zip
  fs.copyFileSync(zipPath, path.join(packageBundleDir, "copilot-agent-bundle.zip"));
  console.log(`👉 同步至 package/agent-bundle/: ${packageBundleDir}`);
} catch (e: any) {
  console.warn(`⚠️ ZIP 压缩命令执行警告: ${e.message}，但解压文件夹已就绪: ${bundleDir}`);
}
