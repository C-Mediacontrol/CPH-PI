# 端到端实战联调对账指南 (E2E Live Verification Playbook)

> **目标**: 指导研发人员与系统管理员在真实 Microsoft 365 Copilot Agent / Sydney 网关环境中验证 v1.3.1 统一增压与物理镜像体系的端到端能力。

---

## 一、环境就绪确认

1. **构建分发制品**:
   ```powershell
   cd 'E:\copilot-web proxy\CPH-PI'
   bun run build:package
   bun run package
   ```
   确认产物：
   - `dist/copilot-agent-bundle.zip`
   - `package/bin/cph-pi.js`
   - `package/agent-bundle/`

2. **部署/更新 Copilot M365 Agent**:
   - 登录 [Microsoft 365 Copilot Studio / Agent Portal](https://m365.cloud.microsoft/chat)；
   - 更新系统提示词：
     - Main 智能体：上传 `package/agent-bundle/Instructions-Main-主协调智能体.txt`；
     - Coder 智能体：上传 `package/agent-bundle/Instructions-Coder-代码实现智能体.txt`；
     - Researcher 智能体：上传 `package/agent-bundle/Instructions-Researcher-深度调研智能体.txt`；
     - 单智能体兼容通道：上传 `package/agent-bundle/Instructions-系统提示词.txt`；
   - 确保技能 `subagent` 与 `handoff` 部署生效。

---

## 二、端到端真机验证步骤

### 1. Turn 1 源码全景快照就绪与卡片观测
- **操作**: 启动全新长任务会话；
- **预期控制台与 TUI 表现**:
  - TUI 启动输出检测到首次会话，`SnapshotGenerator` 产出 `workspace-snapshot-<sha256>.txt`（157+ 文件，约 1.49 MiB）；
  - `SubstrateUploader.uploadDocumentAuto` 自动判定并分流上传；
  - 观察会话即时附件卡片 `workspace-v1.txt` 呈现；卡片就绪时延约为 20~25 秒；
  - 本地 `.cph/state/workspace-snapshot-cache.json` 记录完整 `UploadDocumentResult` 与 SHA256 哈希。

### 2. 未变更哈希与完整注解复用验证 (P8/I13)
- **操作**: 在同一工作区开启下一个同代次会话任务；
- **预期表现**:
  - `Orchestrator` 比对当前 Git 树哈希与缓存匹配；
  - 跳过重复上传，0 秒延迟直接复用缓存注解，终端不重复触发 20s 上传等待。

### 3. 首轮快照异常降级感知验证 (M2/I20)
- **模拟**: 临时切断网络或构造无效 Graph Token；
- **预期表现**:
  - TUI 终端显式黄色告警：`[WARN: Turn 1 workspace snapshot upload failed]`；
  - 错误堆栈落盘至 `.cph/state/upload-error.log`；
  - **绝不**将 1.3MB 文本倾倒进 Prompt；
  - 模型 Turn 1 Prompt 头部接收降级感知通知：
    `[WORKSPACE NOTICE: 全景代码快照上传暂未就绪，当前进入增量探查降级模式，请按需调用 read_file 探查所需文件]`；
  - 模型自主转入局部探测模式，零盲跑、零崩溃。

### 4. 单点编码测试绿灯与 PnP 物理镜像增量推送
- **操作**: 派发 Coder 修复任一单元测试或修改代码；
- **预期表现**:
  - 单测 100% 绿灯通过；
  - `Orchestrator` 拦截全量上传，下发 5 行物理指纹头 `[WORKSPACE STATE UPDATE]`；
  - 后台静默调用 `scripts/sp-sync-engine.ps1`，依据 `.cph/state/sync-manifest.json` 仅对变更文件进行单文件推送；
  - 未变更文件输出 `[SKIP]`，成功后更新 manifest。

### 5. 跨会话 Handoff 代际递增对齐
- **操作**: 当会话接近轮次上限触发交接时；
- **预期表现**:
  - `generateHandoffSnapshot` 生成下一版本全景快照元数据（`workspace-v2.txt`）；
  - 接力智能体唤醒时无缝继承 `plan.md` 任务清单与新版快照视野。

---

## 三、全生命周期验收标准

| 验收项 | 达标判定准则 |
|---|---|
| **附件就绪时延** | ≤ 30 秒（实测 ~20-25s） |
| **模型多跳推理** | 能依据快照推演出 3 跳以上跨文件符号引用与架构逻辑 |
| **增量同步准确率** | 未修改文件 100% 跳过，修改文件在单测绿灯后秒级推入 SharePoint |
| **凭据物理安全** | Windows ACL 限定当前用户，敏感 Cookie 零入库 |
| **全仓回归** | 全项目测试用例 ≥ 710，零失败 |

