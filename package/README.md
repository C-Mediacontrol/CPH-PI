# CPH-PI 独立运行包（免安装）

> 面向使用者的最小运行时：不需要 `npm install`，Node.js 20+ 或 Bun 直接运行。包含终端 Agent 本体、账号权限探测工具和线上 Copilot Agent 部署物料。

---

## 这个包是什么

- **终端运行时**：把 Microsoft 365 Copilot 接进本地工作区，执行读写文件、跑命令、文件搬运、长任务接力；绑定 SharePoint 云端工作区后，本地改动会增量镜像到云端。
- **零依赖**：`bin/cph-pi.js` 已打包全部运行时代码，下载解压即可运行，不需要安装项目依赖。
- **不包含**：开发源码（`src/`）、测试套件（`tests/`）、Web 前端产物（`web/dist`）、云端物理镜像脚本（`scripts/sp-sync-engine.ps1`）。这些都在完整仓库里。

### 使用前提

- Node.js 20+ 或 Bun 1.2+。
- 合法企业 M365 账号，以及租户内可用的 Copilot 专属 Agent 权限。
- Web 控制台需要仓库构建的 `web/dist`；云端物理镜像需要仓库里的同步脚本，并要求 Windows PowerShell 5.1。

---

## 目录结构

```text
package/
├── bin/
│   ├── cph-pi.js                          # 终端运行时（约 820 KB）
│   └── check-accounts.js                  # 账号权限探测（约 59 KB）
├── agent-bundle/                          # 线上 Copilot Agent 部署物料
│   ├── cph-main-agent-prompt.txt          # 主协调 Agent 提示词（源文件）
│   ├── cph-coder-agent-prompt.txt         # 代码实现 Agent 提示词（源文件）
│   ├── cph-dev-agent-prompt.txt           # 单智能体兼容提示词（源文件）
│   ├── Instructions-Main-主协调智能体.txt   # 直接粘贴进 Agent 的说明
│   ├── Instructions-Coder-代码实现智能体.txt
│   ├── Instructions-系统提示词.txt         # 单智能体兼容版
│   ├── skills/handoff/SKILL.md            # 跨会话交接技能
│   ├── skills/subagent/SKILL.md           # 子代理协议技能
│   ├── docs/PowerShell-Agent-Guide.*      # PowerShell 执行指南（docx / md / pdf / txt）
│   ├── UPLOAD-GUIDE.md                    # 上传与配置步骤
│   └── copilot-agent-bundle.zip           # 以上物料的打包
├── accounts.example.json                  # 账号凭据模板
├── cph-pi.bat                             # Windows 批处理启动器
├── cph-pi.ps1                             # PowerShell 启动器
├── package.json                           # 描述文件（node bin/cph-pi.js）
└── README.md
```

整个目录约 1.6 MB。

---

## 快速上手

### 第一步：注册全局命令 `cph-pi`

在当前 `package` 目录下打开 PowerShell，把该目录加入当前用户的 `Path`：

```powershell
$pkgDir = (Get-Item .).FullName
$currentPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($currentPath -notlike "*$pkgDir*") {
    [Environment]::SetEnvironmentVariable("Path", "$currentPath;$pkgDir", "User")
    Write-Host "已加入用户 PATH：$pkgDir"
}
```

重新打开一个 PowerShell 或 CMD 窗口后生效。

也可以不注册 PATH，直接在 `package` 目录里用 `.\cph-pi.bat`、`.\cph-pi.ps1` 或 `node bin/cph-pi.js` 启动。

### 第二步：配置账号

推荐用浏览器 PKCE 登录：

```powershell
cph-pi auth login
```

还没注册 PATH 时：

```powershell
node bin/cph-pi.js auth login
```

也可以手工创建凭据文件，运行时读取后会自动加密：

- Windows：`%USERPROFILE%\.config\m365-copilot2api\accounts.json`
- macOS / Linux：`~/.config/m365-copilot2api/accounts.json`
- 模板：本目录的 `accounts.example.json`；字段为 `email` + `refreshToken`，可选 `tenantId`、`userId`。

可配置多个账号（默认最多 7 个）。遇到 429 或限流时，账号池会自动冷却轮转。

### 第三步：配置线上 Copilot 智能体

1. 浏览器打开企业 M365 门户：[https://m365.cloud.microsoft](https://m365.cloud.microsoft)，进入「Copilot」→「代理 (Agents)」→「创建代理」。
2. 创建 **Main 主协调** 智能体：
   - 说明：粘贴 `agent-bundle/Instructions-Main-主协调智能体.txt`
   - 知识 / 技能：上传 `agent-bundle/skills/subagent/SKILL.md` 与 `agent-bundle/skills/handoff/SKILL.md`
3. 创建 **Coder 代码实现** 智能体：
   - 说明：粘贴 `agent-bundle/Instructions-Coder-代码实现智能体.txt`
   - 知识 / 技能：上传 `agent-bundle/skills/handoff/SKILL.md`
4. 两个 Agent 都保存并发布，分享范围设为「组织中的每个人」或包含你的轮转账号。
5. 复制各自的聊天 URL（形如 `https://m365.cloud.microsoft/chat/agent/T_...`）。

> 老的 `Instructions-系统提示词.txt` / `cph-dev-agent-prompt.txt` 只为单智能体兼容保留，新配置用 Main + Coder 两套即可。

#### 探测账号对 Agent 的访问权限

```powershell
node bin/check-accounts.js --agent "https://m365.cloud.microsoft/chat/agent/T_..."
# 把可用账号写入当前工作区白名单：
node bin/check-accounts.js --apply
```

### 第四步：启动

```powershell
# 全局命令（已配置 PATH）
cph-pi E:\test

# 绑定自己的 Agent
cph-pi E:\test -a "https://m365.cloud.microsoft/chat/agent/T_..." --coder-agent-id "T_..."

# 非交互执行单条任务
cph-pi E:\test --task "检查当前仓库并给出 TODO 列表"

# 本地启动器
.\cph-pi.bat -w "E:\test" -a "T_..."
.\cph-pi.ps1 -w "E:\test" -a "T_..."

# Node / Bun 直接调用
node bin/cph-pi.js E:\test -a "T_..."
bun run bin/cph-pi.js E:\test -a "T_..."
```

---

## 能力速览

- **本地工具**：读文件（大文件超过 1MB 需指定行范围）、局部补丁、写文件、跑命令（默认 30 秒超时）、`file_porter` 下载云端生成的文件。
- **工作区同步**：工作区绑定 SharePoint 后，每次 `edit` / `write_file` 自动把改动同步到云端；全量同步、镜像校验、URL 对账在 Web 控制台或仓库脚本里执行。
- **目录清单附件**：按账号生成 `remote-workspace-catalog.md` 挂给 Copilot，换号自动重挂。
- **无损附件交付**：大段工具输出（超过 12,000 字符或 200 行）作为 OneDrive / Substrate 附件交付，聊天正文只留摘要。
- **文件交付**：`FINAL_ANSWER` 里声明的交付文件自动落盘、同步云端，并写 `delivery-report.json`。
- **双智能体 + 长任务接力**：Main + Coder 双智能体，单任务默认 30 轮，接近上限自动生成交接文档并继续新会话（默认最多 50 次跃迁）。
- **账号池**：最多 7 个账号，AES-256-GCM 加密凭据，429 冷却轮转，支持浏览器 PKCE 登录。
- **Web 控制台**：`cph-pi web` 启动三栏工作台（需要仓库构建的 `web/dist`）。

---

## 常用参数

| 参数 | 说明 |
| --- | --- |
| `-w, --workspace <path>` | 工作区目录，默认当前目录 |
| `-a, --agent <id\|url>` | 主协调智能体 |
| `--coder-agent-id <id\|url>` | 代码实现子智能体 |
| `--researcher-agent-id <id\|url>` | 深度调研子智能体 |
| `-c, --continue` | 接续最近会话 |
| `-r, --resume <id>` | 恢复指定会话 |
| `--task <prompt>` | 非交互执行单条任务 |
| `--max-turns <n>` | 单任务最大轮数，默认 30 |
| `--max-hops <n>` | 自动接力最大跃迁次数，默认 50 |
| `-t, --timeout <seconds>` | 单轮请求超时，默认 600 秒 |
| `-d, --debug [path]` | 开启调试日志（默认 `.cph/logs/`） |

### 交互命令

- `/help`、`/status`、`/accounts`、`/agent [id|clear]`、`/model [tone]`、`/debug`
- `/new [title]`、`/reset`、`/sessions`、`/resume <id>`、`/continue [任务]`（别名 `/relay`）
- `/skills`、`/skills find <词>`、`/skill <name>`、`/exit`

快捷键：`"""` 多行输入；行尾 `\` 续行；运行中 `Ctrl+C` 中止；空闲时 1.5 秒内连按两次退出。

---

## 已知限制

- **Web 控制台**：`package` 目录内没有 `web/dist`。需要 `cph-pi web` 时，请使用完整仓库，先执行 `npm --prefix web install` 和 `bun run web:build`，再启动。
- **云端物理镜像**：自动单文件同步依赖工作区里已有 `.cph/state/sync-manifest.json`；首次绑定和全量同步需要仓库里的 `scripts/sp-sync-engine.ps1`（Windows PowerShell 5.1）与 `scripts/lib/PnPSession.psm1`。
- **凭据加密**：令牌用 AES-256-GCM 加密存储；`M365_MASTER_KEY` 在多设备间需要保持一致，否则无法解密历史凭据。
- **运行环境**：Node.js 20+ 或 Bun 1.2+；Windows、macOS、Linux 均可运行终端。

---

## 更多文档

完整能力、架构说明、开发方式与排错请看仓库根目录的 `README.md` 和 `.docs/` 目录。
