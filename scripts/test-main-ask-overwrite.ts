import WebSocket from "ws";
import fs from "node:fs";
import path from "node:path";

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

async function getClient(): Promise<CdpClient> {
  const targetsRes = await fetch("http://127.0.0.1:9222/json/list");
  const targets = (await targetsRes.json()) as any[];
  const tab = targets.find((t) => t.type === "page" && t.url.includes("m365.cloud.microsoft"));
  if (!tab) throw new Error("Copilot tab not found");
  const client = new CdpClient(tab.webSocketDebuggerUrl);
  await client.connect();
  return client;
}

const OVERWRITE_PROMPT = `我刚刚在底层使用 PnP PowerShell 覆盖更新了该目录下的 kernel_calc.py 与 kernel_calc.txt。
请重新检索并阅读该 SharePoint 目录（/sites/CMA-GBSC_BKGDOMAIN/AFRASIA/01 Team/03 AFR/AFR SCHK/06_Training/New Hire Training/2025/Vincent Fu/WorkSpace/live test）下的最新代码，重新计算 FINAL_TOTAL 的值是多少？
请明确给出当前你读取到的 BASE_PRICE, KERNEL_MULTIPLIER, SECURITY_OFFSET 各自的最新数值，并给出最终算式结果。`;

async function main() {
  const client = await getClient();
  const overwriteTime = new Date("2026-10-20T13:17:05Z").getTime();
  const now = Date.now();
  const elapsedSec = Math.round((now - overwriteTime) / 1000);
  console.log(`\n=== PROBING OVERWRITE: T+${elapsedSec}s after overwrite ===`);

  const insertRes = await client.send("Runtime.evaluate", {
    expression: `(() => {
      const editor = document.getElementById('m365-chat-editor-target-element');
      if (!editor) return JSON.stringify({ error: "Editor not found" });
      editor.focus();
      document.execCommand('selectAll', false, null);
      document.execCommand('delete', false, null);
      const ok = document.execCommand('insertText', false, ${JSON.stringify(OVERWRITE_PROMPT)});
      return JSON.stringify({ success: ok, len: editor.innerText.length });
    })()`,
    returnByValue: true,
  });

  console.log("Insert result:", JSON.parse(insertRes.result?.value || "{}"));
  await new Promise((r) => setTimeout(r, 600));

  const sendRes = await client.send("Runtime.evaluate", {
    expression: `(() => {
      const sendBtn = Array.from(document.querySelectorAll('button')).find(b => b.getAttribute('aria-label') === '发送');
      if (!sendBtn) return JSON.stringify({ error: "Send button not found" });
      if (sendBtn.disabled) return JSON.stringify({ error: "Send button disabled" });
      sendBtn.click();
      return JSON.stringify({ clicked: true });
    })()`,
    returnByValue: true,
  });

  console.log("Send result:", JSON.parse(sendRes.result?.value || "{}"));
  console.log("Waiting for answer stream...");

  let completed = false;
  let finalAnswer = "";
  let lastLength = 0;
  let stableCount = 0;
  const startTime = Date.now();
  const maxWaitMs = 180000;

  while (!completed && Date.now() - startTime < maxWaitMs) {
    await new Promise((r) => setTimeout(r, 3000));

    const pollRes = await client.send("Runtime.evaluate", {
      expression: `(() => {
        const stopBtn = Array.from(document.querySelectorAll('button')).find(b => 
          (b.getAttribute('aria-label') || '').includes('停止')
        );

        const messages = Array.from(document.querySelectorAll('.fai-CopilotMessage, [data-content="ai-message"]'));
        let latestText = "";
        if (messages.length > 0) {
          latestText = messages[messages.length - 1].innerText || "";
        }

        return JSON.stringify({
          isGenerating: !!stopBtn,
          textLength: latestText.length,
          preview: latestText.slice(-120),
          fullText: latestText
        });
      })()`,
      returnByValue: true,
    });

    const val = JSON.parse(pollRes.result?.value || "{}");
    const isGenerating = val.isGenerating;
    const currentLength = val.textLength || 0;
    const elapsed = Math.round((Date.now() - startTime) / 1000);

    console.log(`[T+${elapsed}s] Generating: ${isGenerating}, Length: ${currentLength}, Tail: ${JSON.stringify(val.preview?.slice(-50) || "")}`);

    if (currentLength > 0 && currentLength === lastLength && !isGenerating) {
      stableCount++;
      if (stableCount >= 2) {
        completed = true;
        finalAnswer = val.fullText || "";
      }
    } else {
      stableCount = 0;
      lastLength = currentLength;
    }
  }

  console.log("\n=======================================================");
  console.log("ANSWER TO OVERWRITE PROBE:");
  console.log("=======================================================");
  console.log(finalAnswer);

  fs.writeFileSync(
    path.join(__dirname, `../.cph/state/live-test-overwrite-T${elapsedSec}s.txt`),
    finalAnswer,
    "utf8"
  );

  client.close();
}

main().catch(console.error);

