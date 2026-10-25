# 真实任务验收清单（需要用户执行）

> 代码与自动化验证已完成；以下步骤需要你在真实 M365 Copilot 环境执行，用于确认“好版本行为”恢复 + 两个新功能生效。

## 0. 前置：上传新 Agent Bundle

1. 在仓库根目录运行：
   ```powershell
   bun run package
   ```
2. 上传产物：
   - `package/agent-bundle/copilot-agent-bundle.zip`（或 `dist/copilot-agent-bundle.zip`）
   - 按 `package/agent-bundle/UPLOAD-GUIDE.md` 更新 Main / Coder 两个 Agent 的 Instructions，以及 `handoff`、`subagent` 技能。
3. 确认 CPH-PI 侧绑定的是 Main Agent（否则 Harness 提示词里的 catalog/交付契约不会生效）。

## 1. 启动与工作区

```powershell
cd 'E:\copilot-web proxy\CPH-PI'
bun run src/cli.ts web
```

- 工作区选择 `E:\test_workspace`（云端 targetFolder 已校正为 `WorkSpace/test_workspace`）。
- 可选：设置 `CPH_DEBUG=1`，终端会输出每轮 `[CPH-FINGERPRINT] agentId / promptHash / attachments`。

## 2. 复现任务（与旧日志同一任务）

```text
/thermo-nuclear-code-quality-review 请审查https://cmacgmgroup.sharepoint.com/sites/CMA-GBSC_BKGDOMAIN/AFRASIA/Forms/AllItems.aspx?id=%2Fsites%2FCMA%2DGBSC%5FBKGDOMAIN%2FAFRASIA%2F01%20Team%2F03%20AFR%2FAFR%20SCHK%2F06%5FTraining%2FNew%20Hire%20Training%2F2025%2FVincent%20Fu%2FWorkSpace%2Ftest_workspace%2FLibrary%2FCNNJI%20QUERY 这个项目，最后输出一份详细的审查文档到 E:\test_workspace\test，所有的过程文件也要放在 E:\test_workspace\test
```

## 3. 观察与记录

| 指标 | 目标 | 旧版对照 |
|---|---|---|
| Turn1 本地扫描类工具调用 | ≤ 1（允许写入/验证） | 好版本 0；坏版本 13 |
| 收敛轮次 | ≤ 3 | 好版本 2；坏版本 Turn1 未收敛 |
| 首轮是否内联 `[SHAREPOINT REMOTE WORKSPACE]` 且含目标文件 URL | 是 | 好版本是；坏版本无 |
| 是否出现 `remote-workspace-catalog.md` 附件 | 是 | 坏版本有但未被利用 |
| catalog 链接是否全部属于 `WorkSpace/test_workspace` | 是 | 坏版本指向 `test/` |
| 报告是否自动落盘到声明路径 | 是（`E:\test_workspace\test\...`） | 好版本链接未落盘（当时的小瑕疵） |
| 是否出现 `已落盘/已同步至云端工作区` 回执 | 是 | 新增能力 |
| 是否出现重复同一失败动作 ≥ 2 次 | 否 | 坏版本 7 次 |

## 4. 失败时的取证

1. 保存终端日志：`E:\test_workspace\.cph\logs\cph-terminal-*.log`。
2. 保存状态：
   - `.cph/state/remote-workspace-catalog.md`
   - `.cph/state/delivery-report.json`
   - `.cph/state/sync-manifest.json`
   - `.cph/state/workspace-catalog-cache.json`
3. 若 Turn1 仍走本地扫描，优先检查：
   - 是否为 Main Agent 绑定（`[CPH-FINGERPRINT] agentId=...`）；
   - 提示词中是否出现 `[SHAREPOINT REMOTE WORKSPACE]` 与目标文件 URL；
   - catalog 附件的账号是否与当前租约账号一致。

## 5. 回退方式

任一功能异常时可用开关回退到基线行为：

- `enableAutoLanding: false`：关闭自动落盘；
- `enableWorkspaceCatalog: false`：关闭 catalog 附件；
- `CPH_TURN1_INDEX_MAX_CHARS=0` 之外的值可调整内联预算（默认 24000）。

代码级回退：

```powershell
git checkout baseline/reconstructed-good-20261026
```
