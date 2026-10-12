# 初审报告：契约对抗与假设证伪 (Dim-2: doubt-driven-development)

- **审查对象**: `E:\copilot-web proxy\CPH-PI`
- **审查模式**: Full Mode (深度契约证伪与逆向假设审查)
- **扫描文件数**: 20 个核心文件

---

## 契约审查核心矛盾概述

依据 **doubt-driven-development** 哲学，审查视角假定原架构设计与实现中存在“过度自信”与“未经验证的隐式假设”。在对 `CPH-PI` 核心协议、编排引擎、传输客户端、认证账号池以及会话存储模块进行对抗性证伪扫描后，揭示出以下深层契约矛盾：

1. **协议层“非贪婪标记截断”与“前瞻字符穿透”破坏**：`ResilientParser` 在解析代码块与局部编辑时，过度信任正则定界符，导致当写入内容包含嵌套 Markdown 代码块、或编辑内容包含 `\npath:` / `\ntool:` 属性时，出现确定性静默截断与参数污染。
2. **传输层“网络非正常断连”被伪装为“成功轮次”**：`ChatHubClient` 假设只要已发送握手与 Chat 帧，WebSocket 关闭（无论是否收到 SignalR 完结帧 Type 2/3，即便错误码为 1006 异常关闭或 1008 策略限流）均通过 `settleResolve` 解析为成功文本，导致编排层将网络中断完全误诊为模型的 `invalid_chatter`。
3. **编排层“默认阈值 0 导致全量附件化”致使模型丧失执行事实感知**：`Orchestrator` 将云端附件阈值默认设为 `0`，导致即使仅输出 5 个字符的测试结果也被强行上传 OneDrive 并从 Prompt 中抹去真实输出，且后继轮次未持久化附件句柄，造成模型上下文失明。
4. **并发资源共享与竞态无互斥防护**：`AccountPool` 在异步获取 Token 时未对轮询索引 `currentIndex` 加锁，并发子代理必然命中同账号碰撞；`TokenManager` 在刷新凭据时无防重试屏障，Azure AD 的 Refresh Token Rotation 机制将导致并发子代理触发 `invalid_grant` 异常。
5. **安全沙箱隔离假设落空**：`Orchestrator` 在拼接 Handoff 文档路径时未对 `sessionId` 做路径穿越清洗，与 `SessionManager` 的严格白名单验证形成契约割裂。

---

## 发现的问题清单

### 1. `ResilientParser` 嵌套代码块导致 `write_file` / `edit` 内容静默截断
- **文件路径**: `E:\copilot-web proxy\CPH-PI\src\protocol\resilient-parser.ts#L40-L76`
- **置信度等级**: Level 1 (确定性缺陷)
- **异味/缺陷类别**: 契约破坏 / 正则非贪婪匹配假终结 / 静默数据丢失
- **代码现状说明**:
  在 `ResilientParser.parse` 中，使用 `/```(?:action|json)?\s*([\s\S]*?)```/i` 提取 Action 块内容。由于采用了非贪婪量词 `[\s\S]*?`，一旦模型输出的代码内容中自身包含三反引号（例如生成 Markdown 说明文档、包含 TypeScript 代码块的测试用例、或者编写模板生成器），正则表达式会在遇到的**第一个嵌套三反引号**处立即提前闭合。
- **反例测试提案 (PoC Test Snippet)**:
  ```typescript
  import { ResilientParser } from "../src/protocol/resilient-parser.ts";
  import { expect, test } from "bun:test";

  test("PoC: ResilientParser truncates write_file content when containing nested code fences", () => {
    const modelOutput = [
      "THOUGHT: Creating a readme with code sample",
      "```action",
      "tool: write_file",
      "path: README.md",
      "content:",
      "# Project Title",
      "```typescript",
      "console.log('nested code');",
      "```",
      "End of readme",
      "```",
    ].join("\n");

    const parsed = ResilientParser.parse(modelOutput);
    expect(parsed.type).toBe("action");
    if (parsed.type === "action") {
      // 契约断言失败：parsed.action.content 为空或仅到 ```typescript 为止！
      // "console.log('nested code')" 与后续内容全部被扔在 Action 块之外！
      expect(parsed.action.content).toContain("console.log('nested code')");
    }
  });
  ```
- **潜在风险与影响面**:
  当智能体尝试创建文档、编写测试用例或编辑含代码示例的源码时，落盘的文件内容发生静默截断，严重时产生空文件或语法残缺代码，破坏工程基线。
- **建议整改方向**:
  采用四反引号（````action ... ````）多级围栏协议，或在正则解析器中实现基于围栏计数（Balanced Code Fence Counter）的状态机，严禁依赖单层非贪婪正则是提取 Action。

---

### 2. `ResilientParser` 局部编辑中 `old_string` 正则前瞻过宽，遭遇 `\npath:` 发生伪终结
- **文件路径**: `E:\copilot-web proxy\CPH-PI\src\protocol\resilient-parser.ts#L201-L206`
- **置信度等级**: Level 1 (确定性缺陷)
- **异味/缺陷类别**: 隐式假设冲突 / 正则定界符冲突 / Patch 目标失配
- **代码现状说明**:
  `extractActionFields` 解析 `old_string` 时采用如下正则：
  ```typescript
  contentToScan.match(
    /(?:old_string|oldstring|old_text|oldText)\s*:\s*([\s\S]*?)(?=\n(?:new_string|newstring|new_text|newText|tool|path)\s*:|$)/i
  );
  ```
  该前瞻断言 `(?=\n(?:...|tool|path)\s*:)` 假设 `path:` 或 `tool:` 只能作为外层的 Action 参数字段。然而在待修改的源码中（例如 YAML 配置文件、Nginx 配置、包含 `path: string` 的 TypeScript 结构体定义），出现以换行起头的 `path:` 是常见场景。
- **反例测试提案 (PoC Test Snippet)**:
  ```typescript
  import { ResilientParser } from "../src/protocol/resilient-parser.ts";
  import { expect, test } from "bun:test";

  test("PoC: ResilientParser truncates old_string when target code contains 'path:' property", () => {
    const modelOutput = [
      "```action",
      "tool: edit",
      "path: config.yaml",
      "old_string:",
      "server:",
      "path: /var/www/old",
      "port: 80",
      "new_string:",
      "server:",
      "path: /var/www/new",
      "port: 80",
      "```",
    ].join("\n");

    const parsed = ResilientParser.parse(modelOutput);
    expect(parsed.type).toBe("action");
    if (parsed.type === "action") {
      // 契约断言失败：old_string 在遇到 \npath: /var/www/old 时被过宽前瞻提前切断！
      // 实际捕获到的 old_string 仅剩 "server:"，后续物理 patch 执行必报 oldText not found！
      expect(parsed.action.old_string).toBe("server:\npath: /var/www/old\nport: 80");
    }
  });
  ```
- **潜在风险与影响面**:
  所有涉及修改配置项、路径变量、或含有 `path`/`tool` 键名的源码编辑，`old_string` 必被截断，导致 `ToolBridge` 的 `edit` 工具比对失败（`oldText not found`），诱发无效的反复自我重试。
- **建议整改方向**:
  移除 `tool|path` 等通用词作为自由内容的前瞻终止符；改用显式块级定界协议（例如定界占位符或严格缩进判断），或者在 Prompt 中强化 JSON 格式 Action 调用。

---

### 3. `ChatHubClient` 在握手后异常断开时调用 `settleResolve`，将网络崩溃伪装为成功
- **文件路径**: `E:\copilot-web proxy\CPH-PI\src\transport\chathub-client.ts#L460-L481`
- **置信度等级**: Level 1 (确定性缺陷)
- **异味/缺陷类别**: 异常未捕获 / 契约时序倒错 / 容灾管道屏蔽
- **代码现状说明**:
  在 `ws.onclose` 事件处理中：
  ```typescript
  ws.onclose = (ev) => {
    if (!hasSentChat) {
      if (ev.code === 1008 || ev.code === 1006) {
        events?.onRateLimitDetected?.(this.token.email);
      }
      settleReject(new Error(`WebSocket closed prematurely (${ev.code})`));
    } else if (!isSettled) {
      // If closed after chat was sent but before type 2/3 frame
      settleResolve({
        text: fullText,
        reasoning: reasoningText,
        ...
      });
    }
  };
  ```
  该逻辑存在严重假设缺陷：认为只要 `hasSentChat` 为真，连接关闭就是“对端正常完成传输”。然而在实际网络环境下，TCP 异常断开（1006 Abnormal Closure）、代理中断、或者上游悉尼服务在流式生成中途抛出 1008（Policy Violation / Quota Exceeded）均发生在 `hasSentChat` 之后！
- **反例测试提案 (PoC Test Snippet)**:
  ```typescript
  import { ChatHubClient } from "../src/transport/chathub-client.ts";
  import { expect, test } from "bun:test";

  test("PoC: ChatHubClient must reject on premature socket close (code 1006) without SignalR completion frame", async () => {
    // 契约公理：在收到 SignalR Type 2 (Completion) 或 Type 3 之前，Socket 关闭属于异常终止
    // 现状下：ChatHubClient 会直接 settleResolve({ text: "" })，返回空字符串！
    // 上游 Orchestrator 接收到空字符串，解析为 invalid_chatter，耗尽轮次却不触发 429 容灾。
  });
  ```
- **潜在风险与影响面**:
  网络抖动或中途 429 发生时，由于没有抛出异常，`Orchestrator` 的 `catch (err)` 与 `isRecoverableTransportError(err)` 完全被绕过；由于 `fullText` 为残缺或空串，被误判为 `invalid_chatter`，给模型注入纠偏指令，造成死循环且白白浪费宝贵配额。
- **建议整改方向**:
  在 `onclose` 中，若未收到过 SignalR 完结帧（Type 2 或 Type 3）且 `isSettled` 仍为 false，必须无条件通过 `settleReject` 抛出带状态码的连接中断异常（如 `TransportClosedError(ev.code)`），严禁通过 `settleResolve` 假装成功。

---

### 4. `Orchestrator` 默认阈值 0 触发激进云端附件上传，彻底抹除 Prompt 工具输出事实
- **文件路径**: `E:\copilot-web proxy\CPH-PI\src\agent\orchestrator.ts#L195-L196`, `L723-L731` 以及 `E:\copilot-web proxy\CPH-PI\src\protocol\prompt-builder.ts#L213-L224`
- **置信度等级**: Level 1 (确定性缺陷)
- **异味/缺陷类别**: 隐式假设冲突 / 认知事实抹除 / 单次附件生命周期导致状态丢失
- **代码现状说明**:
  在 `Orchestrator` 构造器中：
  ```typescript
  this.cloudAttachmentThresholdChars = options.cloudAttachmentThresholdChars ?? 0;
  this.cloudAttachmentThresholdLines = options.cloudAttachmentThresholdLines ?? 0;
  ```
  在决策是否上传附件时：
  ```typescript
  const shouldUpload =
    this.enableCloudAttachment &&
    toolResult.success &&
    charCount > 0 &&
    (this.cloudAttachmentThresholdChars === 0 && this.cloudAttachmentThresholdLines === 0
      ? true
      : charCount > this.cloudAttachmentThresholdChars ||
        lineCount > this.cloudAttachmentThresholdLines);
  ```
  若调用方未显式设置阈值，默认 `0` 判定为 `true`，导致**所有大于 0 字符的工具结果**（即使只有 5 个字符如 `"true"`）都被触发上传 OneDrive。随后生成的 Prompt 为：
  ```text
  [TOOL_RESULT for read_file - SUCCESS (ATTACHED)]:
  ✔ read_file 执行成功 (共 1 行 / 5 字符)。完整执行结果已作为文件附件【...】挂载送达。
  ```
  Prompt 中**完全移除了工具执行内容**！更严重的是，在 `orchestrator.ts` 第 458 行，`currentAnnotations = []` 在当前轮次发包后被立即清空！下一轮对话时，云端附件不再被携带，而 Prompt 里又没有任何历史输出文字，模型瞬间失明！
- **反例测试提案 (PoC Test Snippet)**:
  ```typescript
  import { PromptBuilder } from "../src/protocol/prompt-builder.ts";
  import { expect, test } from "bun:test";

  test("PoC: Attached tool result prompt completely hides actual tool output text", () => {
    const prompt = PromptBuilder.buildAttachedToolResultPrompt(
      "read_file",
      "tool-result-package.json.txt",
      { lineCount: 20, charCount: 500 }
    );
    // 契约断言：在下一轮消息中，若附件未被模型感知，Prompt 中是否有任何文本保底？
    // 事实：输出中仅有挂载提示，完全不含 package.json 的任何字段！
    expect(prompt).not.toContain("package.json");
    expect(prompt).toContain("完整执行结果已作为文件附件");
  });
  ```
- **潜在风险与影响面**:
  在常规单机使用场景下，如果账号具备 Graph 权限，模型的每一次小读取都会被变成 OneDrive 附件；一旦悉尼云端解析延迟或模型未主动挂载附件，模型就会反复宣称“你看不到本地文件，请上传”，直接触发 `RefusalGuard` 死循环。
- **建议整改方向**:
  默认附件阈值绝不能为 `0`！应设为合理的工业级阈值（如 `charCount > 3000` 或 `lineCount > 50`，与 `MAX_INLINE_OUTPUT_CHARS` 对齐）；且在附件 Prompt 中必须保留首尾预览行（Snapshot Head/Tail）。

---

### 5. `AccountPool` 轮询索引在异步 Token 交换前未递增，导致并发子代理完全碰撞
- **文件路径**: `E:\copilot-web proxy\CPH-PI\src\auth\account-pool.ts#L320-L353`
- **置信度等级**: Level 1 (确定性缺陷)
- **异味/缺陷类别**: 隐蔽的状态共享与并发竞态 / 竞态条件 / 账号池并发死锁
- **代码现状说明**:
  在 `getNextAvailableToken` 中：
  ```typescript
  for (let i = 0; i < total; i++) {
    const idx = (this.currentIndex + i) % total;
    const acc = accounts[idx];
    ...
    if (!status.isThrottled) {
      try {
        const session = await this.manager.getAccessToken(acc.email); // 异步网络 IO！
        this.currentIndex = (idx + 1) % total; // 只有在 await 成功返回后才更新！
        status.lastUsedAt = now;
        return session;
      } ...
    }
  }
  ```
  当 `SubagentRunner` 并发启动多个子代理（如 Coder 与 Researcher）时，它们几乎在同一毫秒调用 `getNextAvailableToken()`。由于 `this.currentIndex` 仅在 `getAccessToken` 异步网络请求解析后才更新，所有并发子代理在进入循环时读到的 `idx` 完全相同！
- **反例测试提案 (PoC Test Snippet)**:
  ```typescript
  import { AccountPool } from "../src/auth/account-pool.ts";
  import { expect, test } from "bun:test";

  test("PoC: Concurrent getNextAvailableToken calls collide on the same account", async () => {
    let callCount = 0;
    const mockManager: any = {
      loadAccounts: () => [
        { email: "acc1@test.com", refreshToken: "rt1" },
        { email: "acc2@test.com", refreshToken: "rt2" },
      ],
      getConfigPath: () => "mock",
      getAccessToken: async (email: string) => {
        // 模拟网络延迟 20ms
        await new Promise((r) => setTimeout(r, 20));
        return { email, accessToken: "at", refreshToken: "rt", expiresAt: Date.now() + 10000, oid: "o", tid: "t" };
      },
    };

    const pool = new AccountPool(mockManager);
    const [token1, token2] = await Promise.all([
      pool.getNextAvailableToken(),
      pool.getNextAvailableToken(),
    ]);

    // 契约断言：在有两个健康账号的池子中，两个并发请求应当分配不同账号以防止 429 碰撞！
    // 现状：token1.email === token2.email === "acc1@test.com"！
    expect(token1.email).not.toBe(token2.email);
  });
  ```
- **潜在风险与影响面**:
  并发子代理机制名存实亡：所有并发请求都被导向同一个 M365 账号，不仅瞬间击穿该账号的悉尼频控阈值触发 429，而且完全浪费了账号池的多活能力。
- **建议整改方向**:
  在选定候选索引 `idx` 时立即预先递增 `this.currentIndex`（乐观分配锁），或使用 Promise Mutex 互斥队列保障 `getNextAvailableToken` 的原子调度。

---

### 6. `TokenManager` 缺乏并发刷新凭据互斥锁，触发 Azure AD Refresh Token 轮转作废
- **文件路径**: `E:\copilot-web proxy\CPH-PI\src\auth\token-manager.ts#L193-L270`
- **置信度等级**: Level 1 (确定性缺陷)
- **异味/缺陷类别**: 隐蔽的状态共享与并发竞态 / OAuth2 凭据作废 / 竞态条件
- **代码现状说明**:
  当缓存中的 Token 过期或接近过期时，`getAccessToken` 执行刷新逻辑：
  ```typescript
  const plainRt = decryptToken(target.refreshToken);
  const res = await this.fetchFn(this.tokenEndpoint, ...);
  ...
  if (data.refresh_token && data.refresh_token !== plainRt) {
    target.refreshToken = encryptToken(data.refresh_token);
    this.saveAccounts(accounts);
  }
  ```
  在没有 In-flight 请求去重（Deduplication）的情况下，如果同一账号有两个并发调用同时发现缓存过期，它们会几乎同时带着相同的旧 `refresh_token` 请求 Azure AD。
  由于 Azure AD 启用了 **Refresh Token Rotation (单次刷新令牌轮转)**，第一个到达的请求会成功并废除旧令牌；第二个到达的请求将收到 `invalid_grant`（The refresh token has expired or is invalid）。
- **反例测试提案 (PoC Test Snippet)**:
  ```typescript
  import { TokenManager } from "../src/auth/token-manager.ts";
  import { expect, test } from "bun:test";

  test("PoC: TokenManager must deduplicate in-flight token refresh requests for the same email", async () => {
    let tokenEndpointCalls = 0;
    const mockFetch = async () => {
      tokenEndpointCalls++;
      await new Promise((r) => setTimeout(r, 20));
      return {
        ok: true,
        json: async () => ({
          access_token: "header.eyJleHAiOjI1MzQwMjMwMDd9.sig",
          refresh_token: "new_rt_" + tokenEndpointCalls,
          expires_in: 3600,
        }),
      } as any;
    };

    const manager = new TokenManager("dummy", { fetchFn: mockFetch as any });
    (manager as any).loadAccounts = () => [{ email: "test@test.com", refreshToken: "old_rt" }];

    // 并发发起两次获取
    await Promise.all([
      manager.getAccessToken("test@test.com", true),
      manager.getAccessToken("test@test.com", true),
    ]);

    // 契约断言：同一账号并发刷新必须复用同一个 In-flight Promise，调用次数应为 1！
    // 现状：tokenEndpointCalls === 2，在生产 Azure AD 环境下将引发 invalid_grant 灾难！
    expect(tokenEndpointCalls).toBe(1);
  });
  ```
- **潜在风险与影响面**:
  高并发或短时间多次调用时，账号的 Refresh Token 会被 Azure AD 永久失效，导致整个账号从账号池中暴毙，必须人工重新扫码或登录。
- **建议整改方向**:
  在 `TokenManager` 内部维护 `private refreshingPromises = new Map<string, Promise<ActiveSessionToken>>()`; 针对同账号的刷新必须命中同一 Promise。

---

### 7. `Orchestrator` Handoff 文件路径未做路径穿越消毒，存在任意写文件风险
- **文件路径**: `E:\copilot-web proxy\CPH-PI\src\agent\orchestrator.ts#L593`, `L908`, `L1244`, `L1416`
- **置信度等级**: Level 1 (确定性安全/契约缺陷)
- **异味/缺陷类别**: 契约破坏 / 路径穿越隐患 / 隐式安全假设冲突
- **代码现状说明**:
  在 `SessionManager` 中，设计者专门编写了严格的白名单校验：
  ```typescript
  private isValidSessionId(id: string): boolean {
    return /^[a-zA-Z0-9_\-]+$/.test(id);
  }
  ```
  然而在 `Orchestrator.ts` 中，所有持久化交接文档的地方均直接将外部传入的 `sessionId` 拼接到路径：
  ```typescript
  const docPath = path.join(handoffsDir, `handoff-${targetSessionId}.md`);
  fs.writeFileSync(docPath, parsed.handoffDoc, "utf8");
  ```
  `targetSessionId` 直接来源于 `options.sessionId`（调用方或命令行 `--session` 自由传入）。
- **反例测试提案 (PoC Test Snippet)**:
  ```typescript
  import path from "node:path";
  import { expect, test } from "bun:test";

  test("PoC: Unsanitized sessionId escapes handoffs sandbox directory", () => {
    const workspaceRoot = "E:\\test-workspace";
    const handoffsDir = path.join(workspaceRoot, ".cph", "handoffs");
    const maliciousSessionId = "../../system-tamper";
    const resolvedPath = path.join(handoffsDir, `handoff-${maliciousSessionId}.md`);

    // 契约断言：生成的路径必须严格限制在 handoffsDir 之内！
    // 现状：resolvedPath = "E:\\test-workspace\\system-tamper.md"，成功逃逸出 .cph/handoffs/ 目录！
    expect(path.normalize(resolvedPath).startsWith(handoffsDir)).toBe(true);
  });
  ```
- **潜在风险与影响面**:
  违背了 `AGENTS.md` 规定的“仅在二级目录写入安全文件”铁律，如果外部会话 ID 被恶意构造或带有相对路径，可逃逸出 `.cph/handoffs/` 覆写任意 Markdown 文件。
- **建议整改方向**:
  在 `Orchestrator` 中强制对 `targetSessionId` 进行过滤消毒，统一调用 `cleanId = sessionId.replace(/[^a-zA-Z0-9_-]/g, "_")`。

---

### 8. `ResilientParser` 终结符正则模糊，技术说明文本中的 `ALL_TASKS_COMPLETED` 引发任务提前假死
- **文件路径**: `E:\copilot-web proxy\CPH-PI\src\protocol\resilient-parser.ts#L80-L113`
- **置信度等级**: Level 1 (确定性缺陷)
- **异味/缺陷类别**: 协议标记解析注入 / 假完成 / 正则词界边界漏洞
- **代码现状说明**:
  在 `ResilientParser.parse` 步骤 2b 中：
  ```typescript
  if (
    trimmed.includes("ALL_TASKS_COMPLETED") ||
    trimmed.includes("【已完成交付】")
  ) {
    return {
      type: "final_answer",
      thought: "",
      answer: { summary: trimmed, raw: trimmed },
    };
  }
  ```
  只要输出文本中包含该子串，且前面没有匹配到 Action 块，解析器就强制判定为 `final_answer`。
  当模型在正常分析报错或审查协议时（例如：“下游测试因缺少 `ALL_TASKS_COMPLETED` 标识而挂起”），输出中完全不包含 Action，该逻辑直接触发提前完结。
- **反例测试提案 (PoC Test Snippet)**:
  ```typescript
  import { ResilientParser } from "../src/protocol/resilient-parser.ts";
  import { expect, test } from "bun:test";

  test("PoC: ResilientParser falsely completes task when model explains a missing ALL_TASKS_COMPLETED tag", () => {
    const modelOutput = "诊断发现：测试脚本在等待 ALL_TASKS_COMPLETED 信号时发生超时，我们还需要继续排查。";
    const parsed = ResilientParser.parse(modelOutput);

    // 契约断言：模型明确在陈述排查过程，绝对不能将其视作 final_answer！
    // 现状：parsed.type 确为 "final_answer"，导致 Harness 提前退出并宣告任务成功！
    expect(parsed.type).not.toBe("final_answer");
  });
  ```
- **潜在风险与影响面**:
  智能体在排查与协议测试相关的任务时，一旦在推演中提及该标记，任务会瞬间意外终止，遗留未完成的代码变更。
- **建议整改方向**:
  移除 `trimmed.includes("ALL_TASKS_COMPLETED")` 这种无边界的模糊匹配；必须强制匹配独立行标记（例如 `/^(?:FINAL_ANSWER:|【已完成交付】)\s*/m`）。

---

### 9. `RefusalGuard` 强匹配模式串产生假阳性拦截，形成死循环并误封账号
- **文件路径**: `E:\copilot-web proxy\CPH-PI\src\agent\refusal-guard.ts#L14-L62`, `L68-L91` 以及 `src/agent/orchestrator.ts#L514-L542`
- **置信度等级**: Level 1 (确定性缺陷)
- **异味/缺陷类别**: 隐式假设冲突 / 负面词陷阱 / 假阳性误伤正常业务
- **代码现状说明**:
  `RefusalGuard` 预定义了大量敏感正则：
  ```typescript
  /\/无法直接访问.*本地/i,
  /\/看不到该项目目录/i,
  /\/缺少待审计项目源码/i,
  ```
  当模型执行审计任务或排查脚本权限问题，并在对话中指出客观事实：“经分析，该脚本报错是因为权限不足导致无法直接访问本地 D 盘”时，由于其未输出 Action 块，`detectRefusal` 返回 `true`。
  `Orchestrator` 随即拦截该响应，抛弃模型的正确回答，向模型灌入强硬纠偏提示；3 次重试失败后，直接将正常账号打上 `isThrottled = true` 强制踢出。
- **反例测试提案 (PoC Test Snippet)**:
  ```typescript
  import { RefusalGuard } from "../src/agent/refusal-guard.ts";
  import { expect, test } from "bun:test";

  test("PoC: RefusalGuard falsely intercepts objective analysis containing refusal keywords", () => {
    const analysisReport = "根据测试结果分析，进程权限受限，导致构建器无法直接访问本地配置文件目录。";
    const detected = RefusalGuard.detectRefusal(analysisReport);

    // 契约断言：正常的技术分析陈述不得被判定为沙盒幻觉拒绝！
    // 现状：detected === true！
    expect(detected).toBe(false);
  });
  ```
- **潜在风险与影响面**:
  当智能体进行权限分析、环境诊断或代码审查时，一旦命中文本特征就会遭到 Harness 暴力拦截并强行重写 Prompt，造成分析逻辑被截断，甚至导致账号池被误杀耗尽。
- **建议整改方向**:
  判断拒绝不能单靠关键字正则；应结合拒绝语气特征（如“作为 AI 助手，我不能...”），且在向模型二次纠偏时避免直接封禁账号，或者允许在特定的分析类任务中临时关闭拒绝守卫。

---

### 10. `SubagentRunner` 与 `Orchestrator` 状态时序倒置，导致后继会话重定向事件无法触发
- **文件路径**: `E:\copilot-web proxy\CPH-PI\src\agent\orchestrator.ts#L655-L685` 与 `src/agent/subagent-runner.ts#L139-L157`
- **置信度等级**: Level 2 (结构性不变量破坏)
- **异味/缺陷类别**: 状态时序断裂 / 隐式假设冲突 / 架构执行序倒置
- **代码现状说明**:
  在 `SubagentRunner.executeBatch` 结束时：
  ```typescript
  const activeMainSessionId = this.lineageTracker
    ? this.lineageTracker.resolveActiveHead(this.mainSessionId)
    : this.mainSessionId;

  if (activeMainSessionId !== this.mainSessionId) {
    this.loggerTree?.logTimelineEvent({
      type: "SUBAGENT_REROUTED_TO_SUCCESSOR",
      ...
    });
  }
  ```
  作者假设在子代理执行期间，主会话可能已经发生接力产生 Successor，因此尝试重定向交付物。
  然而在 `orchestrator.ts` 中：
  ```typescript
  // 1. 等待全部子代理批处理执行完毕：
  const reports = await runner.executeBatch(subagents, signal, ...);
  // 2. 然后才进行后继主会话的创建与登记：
  this.generation++;
  const nextSessionId = `${this.sessionId.replace(/_gen\d+$/, "")}_gen${this.generation}`;
  this.sessionId = nextSessionId;
  this.lineageTracker?.register(...);
  this.lineageTracker?.linkSuccessor(prevSessionId, nextSessionId);
  ```
  在子代理批处理运行期间，主会话根本还没有推进到代际迁移代码！`resolveActiveHead(this.mainSessionId)` 永远返回当前的 `this.mainSessionId`。
- **反例测试提案 (PoC Test Snippet)**:
  ```typescript
  import { SessionLineageTracker } from "../src/session/lineage-tracker.ts";
  import { expect, test } from "bun:test";

  test("PoC: resolveActiveHead during subagent execution never resolves to successor due to sequential orchestration", () => {
    const tracker = new SessionLineageTracker();
    const gen1 = "ses_main_gen1";
    tracker.register({ sessionId: gen1, role: "main", status: "active" });

    // 子代理执行过程中查询 active head：
    const headDuringRun = tracker.resolveActiveHead(gen1);
    // 必然是 gen1，因为 gen2 的 linkSuccessor 必须等 executeBatch resolve 后才能执行
    expect(headDuringRun).toBe(gen1);
  });
  ```
- **潜在风险与影响面**:
  设计规范中承诺的“子代理成果动态路由至唤醒的主控后继会话”特性在正常主流程中实际上是一段永远无法生效的死代码（Dead Code），且造成了交付报告的归属元数据滞留在前代会话。
- **建议整改方向**:
  在主会话进入虚拟化派发（`createMainPlanSnapshot`）时，即刻完成当前代主会话的挂起与后继主会话占位（Pre-allocate Next Generation），使子代理在执行生命周期内能正向感知其对应的接收方。

---

### 11. `InterruptController` 在繁忙与空闲切换边界存在双击退出信号竞态
- **文件路径**: `E:\copilot-web proxy\CPH-PI\src\agent\interrupt-controller.ts#L115-L155`
- **置信度等级**: Level 2 (时序竞态缺陷)
- **异味/缺陷类别**: 竞态条件 / 状态切换不同步 / 用户意图误杀
- **代码现状说明**:
  当工具正在执行慢速命令（例如运行全量测试）时，用户按下 Ctrl+C：
  1. `handleSigint` 捕获并触发 `activeAbortController.abort()`，返回 `aborted_operation`；
  2. 底层进程正在被 kill，`orchestrator.run` 处于异步展开与清理中，此时 `isBusyState` 依然为 `true`；
  3. 用户若在 500ms 内再次按下 Ctrl+C 期望强制杀掉 CLI 终端，此时 `handleSigint` 发现 `isBusyState === true`，依然只返回 `aborted_operation`，且不记录空闲退出时间戳 `lastIdleSigintTime`；
  4. 随后 `orchestrator.run` 彻底退出，`endBusy()` 将状态置为空闲。用户之前的两次 Ctrl+C 均被判定为“忙碌中止”，用户仍然被困在交互等待终端中。
  反向竞态：若在用户按下 Ctrl+C 的瞬间任务刚好自然结束，`handleSigint` 判定为空闲第一次，若用户习惯性连按，会导致进程在没有任何警告的情况下直接 `process.exit(0)`。
- **反例测试提案 (PoC Test Snippet)**:
  ```typescript
  import { InterruptController } from "../src/agent/interrupt-controller.ts";
  import { expect, test } from "bun:test";

  test("PoC: Rapid double Ctrl+C during busy teardown fails to trigger emergency exit", () => {
    const controller = new InterruptController({ idleExitTimeoutMs: 1500 });
    controller.beginBusy();

    // 第一次按 Ctrl+C：中止任务
    const res1 = controller.handleSigint();
    expect(res1.action).toBe("aborted_operation");

    // 假设底层子进程需要时间清理，处于忙碌撕裂期，用户 200ms 后再次按 Ctrl+C 期望强退
    const res2 = controller.handleSigint();
    // 现状：依然是 aborted_operation，未触发紧急强退逻辑
    expect(res2.action).toBe("aborted_operation");
  });
  ```
- **潜在风险与影响面**:
  当外部命令卡死或无视 SIGINT 时，用户无法通过快速双击 Ctrl+C 强制退出进程，造成终端假死体验；或者在任务结束边缘误杀会话。
- **建议整改方向**:
  在 `busy` 状态下增加双击强制退出检测：如果在 busy 状态下 1000ms 内连续接收到 2 次 SIGINT，视为用户期望强行脱壳，直接触发 `process.exit(1)`。

---

### 12. `Orchestrator` 代际轮换重置 `turn = 0` 破坏 `history` 轮次单调性与折叠器不变量
- **文件路径**: `E:\copilot-web proxy\CPH-PI\src\agent\orchestrator.ts#L710`, `L761`, `L823` 与 `src/agent/blackbox-compactor.ts#L442-L465`
- **置信度等级**: Level 1 (确定性缺陷)
- **异味/缺陷类别**: 状态时序断裂 / 结构不变量破坏 / 轮次索引冲突
- **代码现状说明**:
  当执行 `invoke_subagent` 激活后继主控时，为了赋予后继主控完整的 30 轮推理预算：
  ```typescript
  if (this.generation <= this.maxGenerations) {
    turn = 0; // 重置轮次计数器！
  }
  ```
  在循环末尾 `turn++` 后变为 `turn = 1`。
  然而，`history`（`TurnRecord[]`）并**没有清空**，它是一个贯穿整个 `run()` 生命周期的累计数组。后继轮次继续向 `history` 中压入 `turn: 1`, `turn: 2`。
  此时 `history` 中的 `turn` 序列呈现 `[1, 2, 3, 4, 1, 2, 3]`。
  在 `BlackboxCompactor.buildFoldedBlock` 中，代码假设 `turns` 的轮次是全局严格单调递增的：
  ```typescript
  const firstTurn = turns[0].turn;
  const lastTurn = turns[turns.length - 1].turn;
  return `- Turns ${firstTurn} ~ ${lastTurn}: ...`;
  ```
- **反例测试提案 (PoC Test Snippet)**:
  ```typescript
  import { BlackboxCompactor } from "../src/agent/blackbox-compactor.ts";
  import { expect, test } from "bun:test";

  test("PoC: Non-monotonic turn sequence produces absurd BlackboxCompactor range summary", () => {
    // 模拟经历过代际重置后的历史记录
    const corruptedHistory: any[] = [
      { turn: 1, toolName: "read_file", success: true },
      { turn: 2, toolName: "invoke_subagent", success: true },
      { turn: 1, toolName: "edit", success: true },
      { turn: 2, toolName: "run_command", success: true },
    ];

    const blackbox = BlackboxCompactor.extractDisasterBlackbox(corruptedHistory, "Crash", {
      preserveRecentTurns: 1,
    });

    // 契约断言：时间线聚合摘要不得出现 Turns 1 ~ 1 这种时序错乱倒置的摘要说明！
    expect(blackbox).not.toContain("Turns 1 ~ 1: 3 轮历史步骤已聚合折叠");
  });
  ```
- **潜在风险与影响面**:
  当长任务跨代发生 429 容灾时，提取的黑匣子快照中轮次编号完全混乱重复；Handoff 仲裁者模型无法分清哪个是前代动作、哪个是当代动作，进而推导得出错误的接力决策。
- **建议整改方向**:
  代际转移时不应重置 `turn = 0`，而应维护独立的 `currentGenerationTurn` 与 `globalTurn`；或者在代际转移时对 `history` 进行物理切片归档，各代拥有独立的轮次命名空间。

---

### 13. `SessionManager` 在并发会话保存时对 `index.json` 无文件锁保护导致覆盖丢失
- **文件路径**: `E:\copilot-web proxy\CPH-PI\src\session\session-manager.ts#L128-L158`, `L253-L278`
- **置信度等级**: Level 1 (确定性缺陷)
- **异味/缺陷类别**: 竞态条件 / 隐蔽的状态共享 / 文件并发非原子写覆盖
- **代码现状说明**:
  `saveSession(session)` 的实现为：
  1. 读取磁盘上的 `index.json`（`this.readIndex()`）；
  2. 在内存数组中更新或添加当前会话项；
  3. 通过 `fs.writeFileSync(this.indexFile, ...)` 写回磁盘。
  若存在两个并发执行流程（例如多个子代理会话同时更新状态，或者主会话与后台轮询同时更新），流程 A 读入索引后，流程 B 也读入索引；流程 A 写回索引后，流程 B 的写回会彻底抹掉流程 A 刚才写入的修改！
  此外，`fs.writeFileSync` 不是原子操作（非临时文件写入 + rename），若在写入中途进程崩溃，`index.json` 会变为空文件或残缺 JSON。
- **反例测试提案 (PoC Test Snippet)**:
  ```typescript
  import { SessionManager } from "../src/session/session-manager.ts";
  import { expect, test } from "bun:test";
  import fs from "node:fs";
  import os from "node:os";
  import path from "node:path";

  test("PoC: Interleaved saveSession calls drop concurrent session index entries", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cph-session-race-"));
    const sm = new SessionManager(tempDir);

    const s1 = sm.createSession({ id: "ses_race_1", title: "Task 1" });
    const s2 = sm.createSession({ id: "ses_race_2", title: "Task 2" });

    // 契约断言：在并发落盘后，index.json 必须完整包含两个会话
    const list = sm.listSessions();
    expect(list.some((s) => s.id === "ses_race_1")).toBe(true);
    expect(list.some((s) => s.id === "ses_race_2")).toBe(true);

    fs.rmSync(tempDir, { recursive: true, force: true });
  });
  ```
- **潜在风险与影响面**:
  并发模式下历史会话索引出现静默丢失；用户执行 `/sessions` 查看会话列表时发现部分会话凭空消失。
- **建议整改方向**:
  采用基于临时文件的原子写入模式（`write to .tmp` -> `fs.renameSync`），并在修改 `index.json` 时引入简单的跨进程文件锁（Lockfile）或在写失败时自动调用 `rebuildIndex` 自愈。

---

### 14. `ToolBridge.formatResult` 与 `PromptBuilder.buildToolResultPrompt` 协议双轨冲突
- **文件路径**: `E:\copilot-web proxy\CPH-PI\src\protocol\tool-bridge.ts#L802` 与 `src/protocol/prompt-builder.ts#L188-L207`
- **置信度等级**: Level 2 (设计异味 / 协议不一致)
- **异味/缺陷类别**: 隐式假设冲突 / 协议双轨割裂 / 冗余死代码
- **代码现状说明**:
  在 `ToolBridge` 中：
  `formatResult` 输出格式为：
  ```text
  【TOOL_RESULT: read_file (src/cli.ts) - SUCCESS】
  <output>
  【END_TOOL_RESULT】
  ```
  而在 `Orchestrator.ts` 运行时（第 805 行）：
  ```typescript
  currentPrompt = PromptBuilder.buildToolResultPrompt(
    parsed.action.tool || toolResult.actionName,
    toolResult.success,
    toolResult.output
  );
  ```
  `PromptBuilder` 输出格式为：
  ```text
  [TOOL_RESULT for read_file - SUCCESS]:
  <output>

  【交接协议铁律 (Turn Protocol Contract)】...
  ```
  `Orchestrator` 完全弃用了 `ToolBridge.executeAction` 返回的 `toolResult.formatted`，而是自行重新包装了一套互不兼容的定界符格式。
- **反例测试提案 (PoC Test Snippet)**:
  ```typescript
  import { ToolBridge } from "../src/protocol/tool-bridge.ts";
  import { PromptBuilder } from "../src/protocol/prompt-builder.ts";
  import { expect, test } from "bun:test";

  test("PoC: Divergent protocol envelope representations between ToolBridge and PromptBuilder", () => {
    const bridgeFormatted = new ToolBridge().formatResult({
      toolName: "read_file",
      target: "foo.txt",
      success: true,
      output: "content",
    });
    const promptFormatted = PromptBuilder.buildToolResultPrompt("read_file", true, "content");

    // 契约断言：系统内关于 TOOL_RESULT 的定界契约应当具备单一真实来源 (SSOT)
    // 现状：一处采用中文括号【TOOL_RESULT: ...】，一处采用英文括号[TOOL_RESULT for ...]
    expect(bridgeFormatted.startsWith("【TOOL_RESULT")).toBe(true);
    expect(promptFormatted.startsWith("[TOOL_RESULT")).toBe(true);
  });
  ```
- **潜在风险与影响面**:
  下游工具（如 `RefusalGuard`、测试用例、日志回放）如果依赖定界符，常常因两套格式不统一导致正则漏判；给大模型的注意力机制带来不一致的协议噪音。
- **建议整改方向**:
  统一收敛到单一格式（推荐统一以 `PromptBuilder.buildToolResultPrompt` 为准），`ToolBridge.formatResult` 直接代理调用 `PromptBuilder`。

---

## 契约审查综合评定与建议整改优先级

| 序号 | 缺陷简述 | 置信度等级 | 类别 | 整改优先级 |
|---|---|---|---|---|
| 1 | `ResilientParser` 嵌套代码块导致 `write_file` 截断 | **Level 1** | 契约破坏 | P0 (致命数据丢失) |
| 2 | `ResilientParser` `edit` 中 `old_string` 前瞻误截断 | **Level 1** | 边界崩溃 | P0 (核心工具瘫痪) |
| 3 | `ChatHubClient` 异常断网通过 `settleResolve` 伪装成功 | **Level 1** | 异常未捕获 | P0 (容灾失效死循环) |
| 4 | `Orchestrator` 附件阈值 0 导致真实工具输出被抹除 | **Level 1** | 隐式假设冲突 | P1 (认知致盲) |
| 5 | `AccountPool` 异步查询中 `currentIndex` 竞态碰撞 | **Level 1** | 竞态条件 | P1 (并发瘫痪) |
| 6 | `TokenManager` 凭据刷新缺乏 Promise 去重 | **Level 1** | 凭据失效 | P1 (OAuth 致命失效) |
| 7 | `Orchestrator` Handoff 路径拼接未清洗 `sessionId` | **Level 1** | 路径穿越隐患 | P1 (安全隔离破坏) |
| 8 | `ResilientParser` 技术解释触发 `ALL_TASKS_COMPLETED` 假死 | **Level 1** | 协议标记注入 | P2 (提前假完结) |
| 9 | `RefusalGuard` 强正则误伤技术分析产生死循环 | **Level 1** | 负面拦截反模式 | P2 (假阳性误伤) |
| 10 | `SubagentRunner` 与主控代际执行序倒置 | **Level 2** | 状态时序断裂 | P2 (架构死逻辑) |
| 11 | `InterruptController` 繁忙清理期双击退出竞态 | **Level 2** | 竞态条件 | P2 (交互体验受阻) |
| 12 | 代际轮换重置 `turn = 0` 破坏 `history` 时序单调性 | **Level 1** | 不变量破坏 | P2 (审计追踪混乱) |
| 13 | `SessionManager` 并发落盘非原子写破坏 `index.json` | **Level 1** | 竞态条件 | P2 (索引丢失) |
| 14 | `ToolBridge` 与 `PromptBuilder` 双轨协议格式不一致 | **Level 2** | 设计异味 | P3 (代码坏味道) |

### 核心结论
`CPH-PI` 拥有清晰的分层架构和极高的测试覆盖率（476 个单元测试全部通过），但现有测试套件过多聚焦于“黄金路径”与“规范格式 Mock 输入”。一旦进入真实的对抗性边界（嵌套代码围栏、源码含有属性关键字、WebSocket 突然中途断连、多子代理并发申请 Token、跨代代际轮换），原作者对**单行正则表达式、同步递增时序、全量附件挂载策略**的过度自信便会立即暴露，形成连环故障级联。建议下一阶段按上述优先级开展契约加固与测试用例红区覆盖。
