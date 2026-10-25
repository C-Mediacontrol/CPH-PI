import WebSocket from "ws";
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
            if (msg.error) reject(new Error(JSON.stringify(msg.error)));
            else resolve(msg.result);
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
  if (!copilotTab) throw new Error("Copilot tab not found on port 9222");
  const client = new CdpClient(copilotTab.webSocketDebuggerUrl);
  await client.connect();
  return client;
}

async function askRetry(client: CdpClient, promptText: string): Promise<string> {
  const insertRes = await client.send("Runtime.evaluate", {
    expression: `(() => {
      const editor = document.getElementById('m365-chat-editor-target-element');
      if (!editor) return { error: "Editor not found" };
      editor.focus();
      document.execCommand('selectAll', false, null);
      document.execCommand('delete', false, null);
      const success = document.execCommand('insertText', false, ${JSON.stringify(promptText)});
      return { success };
    })()`,
    returnByValue: true,
  });

  if (!insertRes.result?.value?.success) {
    throw new Error(`Failed to insert prompt`);
  }

  await new Promise((r) => setTimeout(r, 600));

  await client.send("Runtime.evaluate", {
    expression: `(() => {
      const sendBtn = Array.from(document.querySelectorAll('button')).find(b => b.getAttribute('aria-label') === '发送');
      if (sendBtn && !sendBtn.disabled) sendBtn.click();
    })()`,
    returnByValue: true,
  });

  let completed = false;
  let finalAnswer = "";
  let lastLength = 0;
  let stableCount = 0;
  const startTime = Date.now();
  const maxWaitMs = 120000;

  while (!completed && Date.now() - startTime < maxWaitMs) {
    await new Promise((r) => setTimeout(r, 3000));

    const pollRes = await client.send("Runtime.evaluate", {
      expression: `(() => {
        const stopBtn = Array.from(document.querySelectorAll('button')).find(b => 
          (b.innerText || '').includes('停止') || 
          (b.getAttribute('aria-label') || '').includes('停止') ||
          (b.getAttribute('aria-label') || '').toLowerCase().includes('stop')
        );

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

    console.log(`[POLL +${elapsed}s] Generating: ${isGenerating}, Length: ${currentLength}, Tail: ${JSON.stringify(val?.preview?.slice(-50) || "")}`);

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

async function main() {
  const client = await getCopilotClient();
  const uploadTime = new Date("2026-10-20T12:54:00Z").getTime();
  const now = Date.now();
  const elapsedMin = ((now - uploadTime) / 60000).toFixed(1);
  console.log(`\n=== POLLING PROBE: T+${elapsedMin} min after upload ===`);

  const pollPrompt = `请再次检索 SharePoint 文件夹（/sites/CMA-GBSC_BKGDOMAIN/AFRASIA/01 Team/03 AFR/AFR SCHK/06_Training/New Hire Training/2025/Vincent Fu/WorkSpace/live test）。
目前该目录下同时放置了 .py 文件与 .txt 文件（app_entry.py / app_entry.txt, pricing_service.py / pricing_service.txt, kernel_calc.py / kernel_calc.txt）。
请检查企业搜索是否已经检索到这组文件？如果能检索到并打开其中任意一组，请给出各个变量（BASE_PRICE, KERNEL_MULTIPLIER, SECURITY_OFFSET）的值并计算 FINAL_TOTAL。如果仍未检索到，请说明检索状态。`;

  const answer = await askRetry(client, pollPrompt);
  console.log("\n--- ANSWER ---");
  console.log(answer);

  // Write answer to state file
  fs.writeFileSync(
    path.join(__dirname, `../.cph/state/live-test-response-T${Math.round(Number(elapsedMin))}m.txt`),
    answer,
    "utf8"
  );

  client.close();
}

main().catch(console.error);

