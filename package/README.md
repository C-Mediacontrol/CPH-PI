# CPH-PI 极简使用者运行包 (Zero-Dependency Runtime Package)

> **面向使用者**：本文件夹是 CPH-PI 的**最小独立运行时**。已彻底剥离所有开发者测试套件（`tests/`）、底层 monorepo 开发源码（`pi/`）、历史逆向探针与设计规格，**体积仅 ~1MB，零外部依赖，无需执行 `npm install`**，下载后即可在任意工作区直接运行！

---

## 目录结构速览

```text
package/
├── bin/
│   ├── cph-pi.js               # 核心 Harness 独立运行时 (890 KB, Node 20+ / Bun 直接运行)
│   └── check-accounts.js       # 多账号权限自动化探测工具 (50 KB)
├── agent-bundle/               # 线上 Copilot M365 Agent 部署物料
│   ├── cph-dev-agent-prompt.txt # CPH-Dev 线上 Agent 系统提示词 (用于粘贴进 Agent 说明)
│   ├── copilot-agent-bundle.zip # 一键打包 ZIP (含提示词与技能)
│   └── skills/handoff/SKILL.md  # 跨会话自主交接技能
├── accounts.example.json       # 本地账号凭证模板 (~/.config/m365-copilot2api/accounts.json)
├── cph-pi.bat                  # Windows 快捷启动器 (双击或命令行调用)
├── cph-pi.ps1                  # PowerShell 快捷启动器 (UTF-8 编码保障)
├── package.json                # 描述文件 (支持 npm start / npm run check)
└── README.md                   # 本使用说明
```

---

## 核心机制：为什么采用「文件上传」替代「聊天窗口直接发文本」？

在普通的 AI 聊天或初级 Agent 中，执行工具的结果（例如读取的源码或测试日志）都是直接作为大段文本发在聊天输入框里。在面对真实的软件工程时，这种做法会迅速崩溃。

CPH-PI 创新性地引入了 **全量无损文件附件交付体系 (Lossless Attachment Architecture)**，通过微软企业级 Office Substrate / OneDrive 通道，自动将代码与终端输出作为文档附件挂载上传给 Copilot，消息正文仅保留极简摘要。这是本 Harness 最具竞争力的核心特性之一：

1. **突破聊天单轮 Token 硬上限**：聊天文本超过 2,000~4,000 Token 就会被微软网关强制截断甚至报错；作为文件上传后，微软云端文档引擎（Office Document Intelligence）会在服务端原生解析完整文档，实现真正的**千行源码全量阅读直通 (Full-File Reading)**；
2. **100% 杜绝 Windows 中文乱码**：避免了在 WebSocket JSON 文本流转义与网络拆包过程中发生的多字节 GBK/UTF-8 编码切断，彻底告别 `\uFFFD`（菱形问号乱码），保持物理文件真实字节；
3. **彻底防止上下文窗口打爆 (压缩率 85%~95%)**：聊天窗口仅保留一行元数据通知（如 `[已挂载附件 tool-result.txt: 200行]`），沉重的数据实体全部沉淀在附件中。即使连续执行 25~30 轮复杂任务，上下文依然极其精炼聚焦，彻底告别“上下文疲劳”；
4. **根除模型幻觉与历史复读**：线上 Agent 确立了“**附件即单一真实数据源 (Single Source of Truth)**”的认知契约，严格依据云端已解析出的结构化文件推演与打补丁，杜绝把聊天历史中过时的旧代码混淆复读；
5. **规避微软 Web WAF 敏感词误杀与拒答**：输入框文本是微软 WAF 安全审查的第一扫描区，代码片段极易触发误判拒答；而合规企业文档通道极少被 WAF 误杀，任务执行成功率提升 95% 以上。

---

## 快速上手：三步开始使用

### 前置条件
只需确保电脑上安装了以下**任意一种**运行环境（二选一即可）：
- **Node.js** (v20+ LTS) — [官网下载](https://nodejs.org)
- **Bun** (v1.2+) — [官网下载](https://bun.sh)（PowerShell 运行 `irm bun.sh/install.ps1 | iex`）

---

## 全局环境变量注册 (实现任意路径输入 `cph-pi` 直接运行)

为了能够在系统的**任意路径与任意工程目录下**（例如直接在用户根目录 `C:\Users\UserX>`），直接敲入 `cph-pi` 命令操作指定目录：

```powershell
PS C:\Users\UserX> cph-pi E:\test --agent https://m365.cloud.microsoft/chat/agent/T_9feac605-583d-c37d-cb38-831efe727253.2d893690-5a50-4308-bb95-09fc0ece6464.gpt.1a1be0ff-8bb3-4b10-90f7-8666145e91d3 --accounts "GSC.VFU2@cma-cgm.com,GSC.DDAI@cma-cgm.com" --debug
```

只需将本 `package` 文件夹的绝对路径注册到系统的 **`Path`** 环境变量中即可。

### 方式一：PowerShell 一键命令永久注册 (强烈推荐)

在当前 `package` 目录下打开 PowerShell，运行以下命令即可永久写入当前用户的 `Path`：

```powershell
# 1. 自动获取当前 package 目录绝对路径 (若已在该目录下执行)
$pkgDir = (Get-Item .).FullName

# 或者手动指定你的 package 实际解压路径，例如：
# $pkgDir = "E:\copilot-web proxy\CPH-PI\package"

# 2. 检查并永久追加到用户 Path 环境变量
$currentPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($currentPath -notlike "*$pkgDir*") {
    [Environment]::SetEnvironmentVariable("Path", "$currentPath;$pkgDir", "User")
    Write-Host "✔ 已成功将 CPH-PI 路径 ($pkgDir) 添加到用户 PATH 环境变量！" -ForegroundColor Green
    Write-Host "👉 请重新打开一个新的 PowerShell 或 CMD 窗口即可全局生效！" -ForegroundColor Cyan
} else {
    Write-Host "○ PATH 中已包含该目录，无需重复添加。" -ForegroundColor Yellow
}
```

> **重要提示**：设置完成后，**必须重新打开一个新的 PowerShell 或 CMD 终端窗口**，系统才会刷新载入最新的 `Path`。

### 方式二：Windows 图形界面手动配置
1. 按键盘快捷键 `Win + R`，输入 `sysdm.cpl` 并回车打开「系统属性」；
2. 切换到顶部的「**高级**」标签页，点击下方的「**环境变量**」按钮；
3. 在上半部分的「**用户变量**」列表中找到名为 **`Path`** 的变量，双击打开编辑；
4. 点击右侧的「**新建**」按钮，将当前 `package` 文件夹的完整绝对路径（例如 `E:\copilot-web proxy\CPH-PI\package`）粘贴进去；
5. 点击「确定」并逐层保存退出；
6. 重新打开一个全新的 PowerShell 终端，即可全局输入 `cph-pi` 运行。

### 进阶优化：注册默认 Agent 环境变量 (省去每次敲 `--agent`)
如果你固定使用某一个专属智能体，可将它的 URL 或纯 ID 直接注册为 `CPH_COPILOT_AGENT_ID` 环境变量：

```powershell
[Environment]::SetEnvironmentVariable(
    "CPH_COPILOT_AGENT_ID",
    "https://m365.cloud.microsoft/chat/agent/T_9feac605-583d-c37d-cb38-831efe727253.2d893690-5a50-4308-bb95-09fc0ece6464.gpt.1a1be0ff-8bb3-4b10-90f7-8666145e91d3",
    "User"
)
```
设置后，启动命令即可极大简化为：
```powershell
PS C:\Users\UserX> cph-pi E:\test --accounts "GSC.VFU2@cma-cgm.com,GSC.DDAI@cma-cgm.com" --debug
```

---

### 第一步：配置本地账号凭据 (`accounts.json`)

系统会从当前用户家目录读取账号配置：
- **Windows 路径**：`%USERPROFILE%\.config\m365-copilot2api\accounts.json`  
  （即 `C:\Users\<你的用户名>\.config\m365-copilot2api\accounts.json`）
- **macOS / Linux**：`~/.config/m365-copilot2api/accounts.json`

参考本目录下的 `accounts.example.json`，创建并填入你的企业账号与刷新令牌：

```json
[
  {
    "email": "your-email@company.com",
    "refreshToken": "0.AXcA...（你的 Microsoft OAuth Refresh Token）"
  }
]
```
> **提示**：可配置多个账号（推荐 2~7 个），Harness 会自动在遭遇网络频控（429）或限流时透明轮转调度。令牌在初次读取后会自动加密为 `enc:v1:` 密文存储。

---

### 第二步：配置线上 Copilot 专属智能体 (3 分钟搞定)

1. 浏览器打开企业 M365 门户：[https://m365.cloud.microsoft](https://m365.cloud.microsoft)；
2. 点击左侧 **「Copilot」** -> **「代理 (Agents)」** -> **「创建代理 (Create Agent)」**；
3. **名称**：输入 `CPH-Dev`；
4. **说明 (Instructions)**：全选清空，直接打开本目录下的 `agent-bundle/cph-dev-agent-prompt.txt`，全文复制并粘贴进去；
5. **知识 / 技能**：在「知识」板块上传 `agent-bundle/skills/handoff/SKILL.md`；
6. 点击右上角 **「保存」** 并 **「发布」**，分享范围设为「组织中的每个人」；
7. 打开该 Agent 的聊天窗口，复制浏览器地址栏的完整 URL（形如 `https://m365.cloud.microsoft/chat/agent/T_...`）。

#### （可选）一键探测账号访问权限
在当前目录下运行，检测你的账号池是否拥有该 Agent 的访问权限：
```bash
node bin/check-accounts.js --agent "https://m365.cloud.microsoft/chat/agent/T_..."
# 或自动将可用账号写入白名单：
node bin/check-accounts.js --apply
```

---

### 第三步：启动 Harness 开始自主编程

#### 方式 A：全局命令运行 (已配置 PATH 环境变量，强烈推荐)
在任意路径的终端（如 `C:\Users\UserX>`），直接运行全局命令：
```powershell
# 完整命令示例：指定工作区路径、专属 Agent、账号白名单与 Debug 输出
PS C:\Users\UserX> cph-pi E:\test --agent https://m365.cloud.microsoft/chat/agent/T_9feac605-583d-c37d-cb38-831efe727253.2d893690-5a50-4308-bb95-09fc0ece6464.gpt.1a1be0ff-8bb3-4b10-90f7-8666145e91d3 --accounts "GSC.VFU2@cma-cgm.com,GSC.DDAI@cma-cgm.com" --debug

# 若已注册 CPH_COPILOT_AGENT_ID 环境变量，则可极简调用：
PS C:\Users\UserX> cph-pi E:\test --accounts "GSC.VFU2@cma-cgm.com,GSC.DDAI@cma-cgm.com" --debug
```

#### 方式 B：本地脚本启动 (未配置 PATH 时在 package 目录下执行)
```cmd
:: Windows 批处理启动 (自动绑定当前目录为工作区)
.\cph-pi.bat

:: 指定特定工程路径与专属 Agent
.\cph-pi.bat -w "E:\test" -a "T_..."
```

#### 方式 C：PowerShell 启动器
```powershell
.\cph-pi.ps1 -w "E:\test" -a "T_..."
```

#### 方式 D：Node / Bun 直接调用运行时
```bash
node bin/cph-pi.js E:\test -a "T_..."
# 或
bun run bin/cph-pi.js E:\test -a "T_..."
```

---

## 常用命令速查

### 命令行参数
- `-w <path>`：指定操作的目标代码工作区（默认当前命令行所在目录）；
- `-a <id|url>`：指定专属自建智能体；
- `-c`：接续最近活跃的会话；
- `-r <id>`：恢复指定的历史会话；
- `-t <prompt>`：非交互模式，执行完单条任务后直接退出。

### 终端交互指令 (在 `cph-pi>` 提示符下输入)
- `/status`：查看当前会话诊断卡、Token 消耗与账号状态；
- `/accounts`：查看与管理轮转账号白名单；
- `/agent [id|clear]`：查看、切换或解除专属智能体直连；
- `/new`：归档当前任务并开启全新会话；
- `/sessions`：列出当前工作区的所有历史会话；
- `/exit`：退出终端。

### 快捷按键
- `"""`：首行输入三个双引号开启多行输入，再次输入 `"""` 发送；
- `Ctrl+C`：运行中按一次安全中止当前工具或网络流，保留会话；空闲时 1.5 秒内连按两次退出。

