import WebSocket from "ws";
import { execSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";

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

async function getCopilotClient(): Promise<CdpClient> {
  const targetsRes = await fetch("http://127.0.0.1:9222/json");
  const targets = (await targetsRes.json()) as any[];
  const copilotTab = targets.find((t) => t.type === "page" && t.url.includes("m365.cloud.microsoft"));

  if (!copilotTab) {
    throw new Error("Copilot tab not found on port 9222");
  }

  const client = new CdpClient(copilotTab.webSocketDebuggerUrl);
  await client.connect();
  return client;
}

async function submitPrompt(client: CdpClient, promptText: string): Promise<string> {
  // Focus and insert text using execCommand
  const insertRes = await client.send("Runtime.evaluate", {
    expression: `(() => {
      const editor = document.getElementById('m365-chat-editor-target-element');
      if (!editor) return { error: "Editor not found" };
      editor.focus();
      document.execCommand('selectAll', false, null);
      document.execCommand('delete', false, null);
      const success = document.execCommand('insertText', false, ${JSON.stringify(promptText)});
      return { success, editorLength: editor.innerText.length };
    })()`,
    returnByValue: true,
  });

  if (!insertRes.result?.value?.success) {
    throw new Error(`Failed to insert prompt: ${JSON.stringify(insertRes.result?.value)}`);
  }

  await new Promise((r) => setTimeout(r, 600));

  // Click send button
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

  if (!sendRes.result?.value?.clicked) {
    throw new Error(`Failed to click send button: ${JSON.stringify(sendRes.result?.value)}`);
  }

  console.log("[CDP] Prompt submitted. Waiting for answer...");

  // Poll for completion
  let completed = false;
  let finalAnswer = "";
  let lastLength = 0;
  let stableCount = 0;
  const startTime = Date.now();
  const maxWaitMs = 120000; // 2 minutes

  while (!completed && Date.now() - startTime < maxWaitMs) {
    await new Promise((r) => setTimeout(r, 3000));

    const pollRes = await client.send("Runtime.evaluate", {
      expression: `(() => {
        const stopBtn = Array.from(document.querySelectorAll('button')).find(b => 
          (b.innerText || '').includes('停止') || 
          (b.getAttribute('aria-label') || '').includes('停止') ||
          (b.getAttribute('aria-label') || '').toLowerCase().includes('stop')
        );

        // Find all message bubbles
        const bubbles = Array.from(document.querySelectorAll('[data-content="ai-message"], [class*="ChatMessage"], [class*="chat-message"], [class*="response-content"], .fai-ChatMessage, article, [role="article"]'));
        let latestText = "";
        if (bubbles.length > 0) {
          latestText = bubbles[bubbles.length - 1].innerText || "";
        }

        return {
          isGenerating: !!stopBtn,
          textLength: latestText.length,
          preview: latestText.slice(-100),
          fullText: latestText
        };
      })()`,
      returnByValue: true,
    });

    const val = pollRes.result?.value;
    const isGenerating = val?.isGenerating;
    const currentLength = val?.textLength || 0;
    const elapsed = Math.round((Date.now() - startTime) / 1000);

    console.log(`[CDP +${elapsed}s] Generating: ${isGenerating}, Length: ${currentLength}, Tail: ${JSON.stringify(val?.preview?.slice(-60) || "")}`);

    if (currentLength > 0 && currentLength === lastLength && !isGenerating) {
      stableCount++;
      if (stableCount >= 2) {
        completed = true;
        finalAnswer = val?.fullText || "";
      }
    } else {
      stableCount = 0;
      lastLength = currentLength;
    }
  }

  return finalAnswer;
}

const QUESTION_PROMPT = `请查阅我们刚刚同步至公司 SharePoint 站点（站点：CMA-GBSC_BKGDOMAIN，文档库：AFRASIA）中以下路径下的文件：
路径：/sites/CMA-GBSC_BKGDOMAIN/AFRASIA/01 Team/03 AFR/AFR SCHK/06_Training/New Hire Training/2025/Vincent Fu/WorkSpace/live test

该文件夹中包含三个相互引用的 Python 源码文件：
1. app_entry.py (Web: https://cmacgmgroup.sharepoint.com/sites/CMA-GBSC_BKGDOMAIN/AFRASIA/01%20Team/03%20AFR/AFR%20SCHK/06_Training/New%20Hire%20Training/2025/Vincent%20Fu/WorkSpace/live%20test/app_entry.py)
2. pricing_service.py (Web: https://cmacgmgroup.sharepoint.com/sites/CMA-GBSC_BKGDOMAIN/AFRASIA/01%20Team/03%20AFR/AFR%20SCHK/06_Training/New%20Hire%20Training/2025/Vincent%20Fu/WorkSpace/live%20test/pricing_service.py)
3. kernel_calc.py (Web: https://cmacgmgroup.sharepoint.com/sites/CMA-GBSC_BKGDOMAIN/AFRASIA/01%20Team/03%20AFR/AFR%20SCHK/06_Training/New%20Hire%20Training/2025/Vincent%20Fu/WorkSpace/live%20test/kernel_calc.py)

请阅读这三个文件，按照它们之间的函数调用与变量引用链路（app_entry.py -> pricing_service.py -> kernel_calc.py），计算出 app_entry.py 中最终计算出的 FINAL_TOTAL 数值是多少？
请给出各个变量（BASE_PRICE, KERNEL_MULTIPLIER, SECURITY_OFFSET）的具体数值以及最终算术结果。`;

async function main() {
  console.log("=== PHASE 1: ASKING BASELINE QUESTION ===");
  const client = await getCopilotClient();
  console.log("Connected to Copilot. Sending initial question for v1 (expected: 3555)...");
  const response1 = await submitPrompt(client, QUESTION_PROMPT);
  console.log("\n--- RESPONSE 1 ---");
  console.log(response1);

  // Save response to log
  fs.writeFileSync(
    path.join(__dirname, "../.cph/state/live-test-response-phase1.txt"),
    response1,
    "utf8"
  );

  client.close();
}

main().catch(console.error);

