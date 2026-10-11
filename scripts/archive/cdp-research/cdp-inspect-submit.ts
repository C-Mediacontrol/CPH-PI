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
  const targetsRes = await fetch("http://127.0.0.1:9222/json");
  const targets = (await targetsRes.json()) as any[];
  const copilotTab = targets.find((t) => t.type === "page" && t.url.includes("m365.cloud.microsoft"));

  const client = new CdpClient(copilotTab.webSocketDebuggerUrl);
  await client.connect();

  const capturedWsFrames: any[] = [];
  client.on("Network.webSocketFrameSent", (params) => {
    const payload = params.response?.payloadData || "";
    console.log(`[WS FRAME SENT] Length: ${payload.length}`);
    capturedWsFrames.push(payload);
  });

  await client.send("Network.enable");

  // Check current attachments in DOM
  const check = await client.send("Runtime.evaluate", {
    expression: `(() => {
      const att = document.querySelector('.fx-Attachment');
      const textarea = document.querySelector('textarea, [contenteditable="true"]');
      const submitBtn = document.querySelector('button[aria-label*="发送"], button[aria-label*="Send"], button[type="submit"]');
      return {
        hasAttachment: !!att,
        attachmentId: att ? att.id : null,
        attachmentText: att ? att.innerText : null,
        textareaFound: !!textarea,
        submitBtnFound: !!submitBtn,
        submitBtnDisabled: submitBtn ? (submitBtn as any).disabled : null
      };
    })()`,
    returnByValue: true,
  });

  console.log("Check before submit:", check);

  // We can inspect the React/Internal component state to see the exact message annotation object
  const reactState = await client.send("Runtime.evaluate", {
    expression: `(() => {
      const attEl = document.querySelector('.fx-Attachment');
      if (!attEl) return { error: "no attachment element" };
      return {
        id: attEl.id,
        className: attEl.className,
        ariaLabel: attEl.getAttribute('aria-label'),
        keys: Object.keys(attEl).filter(k => k.startsWith('__react'))
      };
    })()`,
    returnByValue: true,
  });

  console.log("React fiber attachment inspect:", reactState);

  client.close();
}

main().catch(console.error);
