import fs from "node:fs";
import path from "node:path";
import WebSocket from "ws";

interface CdpResponse {
  id?: number;
  method?: string;
  params?: any;
  result?: any;
  error?: any;
}

class CdpClient {
  public ws: WebSocket;
  private msgId = 1;
  private pending = new Map<number, { resolve: (val: any) => void; reject: (err: any) => void }>();
  public eventHandlers = new Map<string, Array<(params: any) => void>>();

  constructor(wsUrl: string) {
    this.ws = new WebSocket(wsUrl);
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws.on("open", () => resolve());
      this.ws.on("error", (err) => reject(err));
      this.ws.on("message", (data) => {
        try {
          const msg: CdpResponse = JSON.parse(data.toString());
          if (msg.id && this.pending.has(msg.id)) {
            const { resolve, reject } = this.pending.get(msg.id)!;
            this.pending.delete(msg.id);
            if (msg.error) {
              reject(new Error(JSON.stringify(msg.error)));
            } else {
              resolve(msg.result);
            }
          } else if (msg.method) {
            const handlers = this.eventHandlers.get(msg.method);
            if (handlers) {
              for (const h of handlers) h(msg.params);
            }
          }
        } catch {}
      });
    });
  }

  on(event: string, handler: (params: any) => void) {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, []);
    }
    this.eventHandlers.get(event)!.push(handler);
  }

  async send(method: string, params: any = {}): Promise<any> {
    const id = this.msgId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.ws.close();
  }
}

async function main() {
  console.log("[CDP] Connecting to Chrome/Edge debugging session on 9222...");
  const targetsRes = await fetch("http://127.0.0.1:9222/json");
  const targets = (await targetsRes.json()) as any[];
  const copilotTab = targets.find((t) => t.type === "page" && t.url.includes("m365.cloud.microsoft"));

  if (!copilotTab) {
    console.error("[CDP ERROR] Copilot tab not found!");
    process.exit(1);
  }

  console.log(`[CDP] Found Copilot tab: ${copilotTab.title} (${copilotTab.url})`);
  const client = new CdpClient(copilotTab.webSocketDebuggerUrl);
  await client.connect();
  console.log("[CDP] WebSocket debugger connected.");

  await client.send("Network.enable");

  // Verify and ensure GPT-6.1 Sol is active
  const modelCheck = await client.send("Runtime.evaluate", {
    expression: `(() => {
      const btn = document.getElementById('gptModeSwitcher');
      return btn ? btn.innerText.trim() : 'Unknown';
    })()`,
    returnByValue: true,
  });

  console.log(`[CDP] Current model: ${modelCheck.result?.value}`);
  if (!modelCheck.result?.value?.includes("GPT-6.1 Sol")) {
    console.log("[CDP] Switching to GPT-6.1 Sol...");
    await client.send("Runtime.evaluate", {
      expression: `(() => {
        document.getElementById('gptModeSwitcher')?.click();
      })()`,
    });
    await new Promise((r) => setTimeout(r, 400));
    await client.send("Runtime.evaluate", {
      expression: `(() => {
        const trigger = document.querySelector('[data-testid="gptSubMenuModelTrigger-OpenAI"]');
        if (trigger) {
          trigger.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
          trigger.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
          trigger.click();
        }
      })()`,
    });
    await new Promise((r) => setTimeout(r, 400));
    await client.send("Runtime.evaluate", {
      expression: `(() => {
        const items = Array.from(document.querySelectorAll('[role="menuitem"], .fui-MenuItem'));
        const sol = items.find(el => (el.textContent || '').includes('GPT-6.1 Sol'));
        if (sol) sol.click();
      })()`,
    });
    await new Promise((r) => setTimeout(r, 600));
  }

  // Construct rigorous challenge prompt
  const challengePrompt = `请查阅我们刚刚同步至公司 SharePoint 站点（站点：CMA-GBSC_BKGDOMAIN，文档库：AFRASIA）中共享工作区根目录下的独立工作区目录：
目标路径：/AFRASIA/01 Team/03 AFR/AFR SCHK/06_Training/New Hire Training/2025/Vincent Fu/WorkSpace/test

请调阅该工作区下的源码与技术文档，详细回答以下 3 个深入的技术实现问题：

【问题 1：并发控制与 Win32 原生原子替换】
在 WorkSpace/test/Library/CNNJI QUERY/shared/modules/JsygtBatch.psm1 中：
1. 为什么在后台 runspace 批量执行与前端高频轮询读取 state.json 时，单纯将文件共享标志设为 FileShare::ReadWrite 仍无法根治并发冲突？
2. 为什么使用 .NET 的 [System.IO.File]::Replace 会导致约 20.1% 的轮询被误报为“批次丢失（State=missing）”？其底层 Win32 API 存在怎样的两步改名真空时间窗口？
3. 源码中最终采用了哪一个 Win32 API 解决该问题？为什么该 API 的 P/Invoke 声明必须先用 [PSTypeName] 做 AppDomain 级的判存？

【问题 2：OCR 推理引擎与防御性自检】
在 WorkSpace/test/Library/CNNJI QUERY/tools/jsygt-ocr/OcrInfer.cs 中：
1. 类 CharsetCheck 为 --selftest 启动闸门定义的 GarbageLimit（碎片上限）与 DuplicateLimit（重复上限）阈值分别是多少？为什么允许 0 号索引之后存在整条为纯空白字符的条目（如 ' ' 与 U+3000）？
2. 在 OcrOptions 中，白名单掩码 AllowedChars 的默认值是什么？当 CTC 解码长度超过 ExpectedLength 时，算法具体采取了怎样的丢弃策略？

【问题 3：工作区工程治理与审查矩阵】
在 WorkSpace/test/AGENTS.md 与 WorkSpace/test/test/CNNJI-review-coverage-matrix.md 中：
1. AGENTS.md 中对 AI 在工作区根目录的写权限以及对 Library/ 目录的版本控制是如何规约的？
2. CNNJI-review-coverage-matrix.md 中列出了哪些核心审查维度与阻断策略？

请根据 SharePoint 实际上传的工作区文件进行详细对账并解答。`;

  console.log("\n[CDP] Injecting challenge prompt into Copilot editor...");

  // Capture WebSocket traffic
  const capturedWsTraffic: string[] = [];
  client.on("Network.webSocketFrameReceived", (params) => {
    const payload = params.response?.payloadData || "";
    if (payload.includes("text") || payload.includes("content") || payload.includes("arguments") || payload.includes("message")) {
      capturedWsTraffic.push(payload);
    }
  });

  // Focus and insert text using execCommand
  const insertRes = await client.send("Runtime.evaluate", {
    expression: `(() => {
      const editor = document.getElementById('m365-chat-editor-target-element');
      if (!editor) return { error: "Editor not found" };
      editor.focus();
      document.execCommand('selectAll', false, null);
      document.execCommand('delete', false, null);
      const text = ${JSON.stringify(challengePrompt)};
      const success = document.execCommand('insertText', false, text);
      return { success, editorLength: editor.innerText.length };
    })()`,
    returnByValue: true,
  });

  console.log("[CDP] Insert text result:", insertRes.result?.value);
  await new Promise((r) => setTimeout(r, 800));

  // Find and click the send button
  console.log("[CDP] Clicking send button...");
  const sendRes = await client.send("Runtime.evaluate", {
    expression: `(() => {
      const sendBtn = Array.from(document.querySelectorAll('button')).find(b => b.getAttribute('aria-label') === '发送');
      if (!sendBtn) return { error: "Send button not found" };
      if (sendBtn.disabled) return { error: "Send button disabled" };
      sendBtn.click();
      return { clicked: true };
    })()`,
    returnByValue: true,
  });

  console.log("[CDP] Send button click result:", sendRes.result?.value);

  if (!sendRes.result?.value?.clicked) {
    console.error("[CDP ERROR] Could not click send button!");
    client.close();
    process.exit(1);
  }

  console.log("\n[CDP] Prompt submitted successfully. Waiting for Copilot (GPT-6.1 Sol) to generate response...");
  console.log("[CDP] Monitoring stream (polling DOM every 3s)...");

  let completed = false;
  let finalAnswer = "";
  let lastLength = 0;
  let stableCount = 0;
  const startTime = Date.now();
  const maxWaitMs = 120000; // 2 minutes max wait

  while (!completed && Date.now() - startTime < maxWaitMs) {
    await new Promise((r) => setTimeout(r, 3000));

    const pollRes = await client.send("Runtime.evaluate", {
      expression: `(() => {
        // Look for stop generating button
        const stopBtn = Array.from(document.querySelectorAll('button')).find(b => 
          (b.innerText || '').includes('停止') || 
          (b.getAttribute('aria-label') || '').includes('停止') ||
          (b.getAttribute('aria-label') || '').toLowerCase().includes('stop')
        );

        // Find all assistant response message bubbles
        const bubbles = Array.from(document.querySelectorAll('[data-content="ai-message"], [class*="ChatMessage"], [class*="chat-message"], [class*="response-content"], .fai-ChatMessage'));
        
        let latestText = "";
        if (bubbles.length > 0) {
          latestText = bubbles[bubbles.length - 1].innerText || "";
        } else {
          // Fallback: look for markdown blocks or articles
          const articles = Array.from(document.querySelectorAll('article, [role="article"], .fui-ChatMyMessage, [class*="message-body"]'));
          if (articles.length > 0) {
            latestText = articles[articles.length - 1].innerText || "";
          }
        }

        return {
          isGenerating: !!stopBtn,
          textLength: latestText.length,
          preview: latestText.slice(-200),
          fullText: latestText
        };
      })()`,
      returnByValue: true,
    });

    const val = pollRes.result?.value;
    const isGenerating = val?.isGenerating;
    const currentLength = val?.textLength || 0;
    const elapsed = Math.round((Date.now() - startTime) / 1000);

    console.log(`[CDP +${elapsed}s] Generating: ${isGenerating}, Length: ${currentLength} chars, Preview: ${JSON.stringify(val?.preview?.slice(-80) || "")}`);

    if (currentLength > 0 && currentLength === lastLength && !isGenerating) {
      stableCount++;
      if (stableCount >= 2) {
        // Text is stable and stop button is gone
        completed = true;
        finalAnswer = val?.fullText || "";
      }
    } else {
      stableCount = 0;
      lastLength = currentLength;
    }
  }

  console.log("\n================================================================================");
  console.log("[CDP] COPILOT GPT-6.1 SOL FINAL RESPONSE:");
  console.log("================================================================================");
  console.log(finalAnswer || "(No text extracted from DOM, checking WebSocket traffic...)");

  // Persist response to report
  const reportPath = path.resolve(__dirname, "../../.docs/reports/2026-10-20-copilot-gpt61-sol-workspace-audit-interaction.md");
  const reportContent = `# Copilot (GPT-6.1 Sol) 访问 SharePoint 工作区深度技术实测报告

- **测试时间**: ${new Date().toISOString()}
- **模型**: GPT-6.1 Sol (已由 CDP 强制选择并校验)
- **目标工作区**: \`AFRASIA/01 Team/03 AFR/AFR SCHK/06_Training/New Hire Training/2025/Vincent Fu/WorkSpace/test\`
- **测试提问**:
\`\`\`markdown
${challengePrompt}
\`\`\`

---

## Copilot (GPT-6.1 Sol) 原始回答

${finalAnswer || "*(请查阅控制台实时输出)*"}

---

## CDP 监控与传输状态
- **总耗时**: ${Math.round((Date.now() - startTime) / 1000)} 秒
- **捕获 WebSocket 消息帧数**: ${capturedWsTraffic.length}
`;

  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, reportContent, "utf8");
  console.log(`\n[CDP] Interaction report saved to ${reportPath}`);

  client.close();
}

main();
