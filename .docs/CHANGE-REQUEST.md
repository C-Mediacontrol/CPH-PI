# CHANGE-REQUEST (变更请求台账)

## 进行中的变更请求

### CR-2026-10-19-01: 全工作区源码快照增压、大文件分块直传、SharePoint 物理镜像与子代理微切片隔离体系
- **发起日期**: 2026-10-19
- **状态**: 批准待实施 (Approved - Ready for Implementation)
- **关联分支**: `feat/workspace-snapshot-supercharger`
- **唯一权威技术规范**: [`.docs/specs/2026-10-19-unified-workspace-supercharger-and-pnp-mirror-architecture.md`](./specs/2026-10-19-unified-workspace-supercharger-and-pnp-mirror-architecture.md)
- **审查与审计报告**: [`.docs/audit/report-C-spec-neutral-review.md`](./audit/report-C-spec-neutral-review.md)
- **核心变更摘要**:
  1. **纯协议大文件分块直传**: 在 `SubstrateUploader` 中实现 `createUploadSession` 与 8,000 KB 分块状态机，支持断点续传（由 `nextExpectedRanges` 驱动与 429/503 退避）；
  2. **SharePoint 物理镜像**: 新增 `scripts/sp-sync-engine.ps1`，强制锁定 Windows PowerShell 5.1 运行，复用 `PnPSession.psm1` 三级 Cookie 机制，提供企业级容量的单向物理归档；
  3. **Git-Aware 工作区快照器**: 在 `src/workspace/snapshot-generator.ts` 中基于 `git ls-files` 构建全景快照，天然排除子模块与构建产物，将快照规模精准控制在 ~2MB / 200 级条目；
  4. **Subagent 局部微切片隔离**: 子代理严格隔离于全量快照之外，仅接收工单声明的目标源码切片（10~30KB）及前序审查文档；
  5. **双层流与 TDD 门禁**: 消除快照时效性崩塌，本地单测绿灯后才触发单文件 SharePoint 推送，向后续轮次下发 5 行极简 `[WORKSPACE STATE UPDATE]` 状态头；
  6. **Tri-Agent 认知重塑与 DAG 调度**: 重构三大提示词与 `subagent`/`handoff` 技能，确立因果时序与阶段屏障，杜绝盲目并发。
