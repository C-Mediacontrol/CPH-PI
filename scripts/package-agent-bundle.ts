import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

/**
 * CPH-PI Copilot Agent & Skills Packager
 * Packages system prompt and workspace-specific skills into ready-to-upload bundles.
 */

const projectRoot = path.resolve(__dirname, "..");
const promptPath = path.join(projectRoot, "cph-dev-agent-prompt.txt");
const skillsDir = path.join(projectRoot, "skills");
const distDir = path.join(projectRoot, "dist");
const bundleDir = path.join(distDir, "copilot-agent-bundle");
const zipPath = path.join(distDir, "copilot-agent-bundle.zip");

console.log("📦 [Packager] 开始构建 Copilot M365 Agent 上传包...");

// 1. Prepare dist directories
if (fs.existsSync(bundleDir)) {
  fs.rmSync(bundleDir, { recursive: true, force: true });
}
if (fs.existsSync(zipPath)) {
  fs.rmSync(zipPath, { force: true });
}
fs.mkdirSync(bundleDir, { recursive: true });

// 2. Copy and format System Prompt
if (!fs.existsSync(promptPath)) {
  console.error(`❌ 未找到系统提示词文件: ${promptPath}`);
  process.exit(1);
}
const promptContent = fs.readFileSync(promptPath, "utf8");
const targetPromptPath = path.join(bundleDir, "Instructions-系统提示词.txt");
fs.writeFileSync(targetPromptPath, promptContent, "utf8");
console.log(`✔ 已打包系统提示词 -> ${path.relative(projectRoot, targetPromptPath)} (${promptContent.length} 字符)`);

// 3. Copy workspace skills
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
      console.log(`✔ 已打包工作区专属技能: ${entry.name}`);
    }
  }
}

// 4. Generate Upload Guide
const uploadGuideContent = `# Copilot M365 Agent 一键更新与配置指南

本压缩包已为你聚合好了更新 Copilot Agent 所需的所有核心资产：

## 1. 更新系统提示词 (Instructions)
1. 访问微软 Copilot 代理编辑页：https://m365.cloud.microsoft 或 Copilot Studio；
2. 找到你的专属 Agent（如以 \`T_9feac605-5...\` 结尾的 Agent）；
3. 打开「配置」或「说明 (Instructions)」编辑框；
4. 全选清空后，直接将本目录下的 \`Instructions-系统提示词.txt\` 全文复制并粘贴进去；
5. 点击右上角「保存 (Save)」或「更新 (Update)」。

## 2. 上传知识库 / 专属技能 (Knowledge & Skills)
1. 在 Agent 配置页面的「知识 (Knowledge)」或「功能 / 技能」板块；
2. 上传本目录下 \`skills/\` 目录中的技能文档（如 \`skills/handoff/SKILL.md\`）；
3. 保存生效。

完成上述更新后，在本地终端运行 \`cph-pi <workspaceRoot>\` 即可即刻体验最新的正向引导与 File-First 原生交接！
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

