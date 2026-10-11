# CDP Research & Reverse-Engineering Scripts Archive

本目录归档了在开发 CPH-PI 早期阶段，通过 Chrome DevTools Protocol (CDP, 端口 9222) 对 Microsoft Copilot Web 前端及 M365 Agent Builder 界面进行逆向探索与实证分析的历史脚本。

## 归档脚本清单

| 脚本文件 | 探索目的与实证成果 |
|---|---|
| `cdp-inspect-submit.ts` | 拦截分析 Copilot Web 消息提交帧与 UI 事件 |
| `cdp-send-and-capture.ts` | 捕获 Web 端发送消息后的 Sydney WebSocket 传输流 |
| `probe-add-features.ts` | 探测 Web 端功能特性开关与灰度参数 |
| `probe-agent-menu.ts` | 逆向捕获 M365 Agent 下拉列表中的专属 Agent ID 格式 |
| `probe-draft-and-capture.ts` | 探测草稿态消息与附件暂存机制 |
| `probe-model-menu.ts` | 逆向分析 Web 界面模型切换器（GPT-4 vs GPT-6.1）的 DOM 行为 |
| `probe-select-draft.ts` | 自动化选择与注入提示词草稿测试 |
| `probe-ui.ts` | 探测 Copilot Web 聊天窗口各 DOM 容器节点与输入框状态 |
| `test-custom-agent-and-capture.ts` | 实证自建 Agent 的 WebSocket 握手参数 (`gptId`, `agentHost` 等) |
| `test-send-and-capture.ts` | 调试全链路端到端发送与帧捕获 |
| `test-switch-gpt61.ts` | 验证 `Gpt_61_Sol_Reasoning` 模型锁定的协议帧有效性 |

> **说明**：这些脚本主要用于早期逆向取证。CPH-PI 目前已直接采用原生 WebSocket/SignalR 双工连接（位于 `src/transport/`），无需再挂载 Chrome CDP 实例。

