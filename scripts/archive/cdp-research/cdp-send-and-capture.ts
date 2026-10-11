import WebSocket from "ws";

async function main() {
  const targetsRes = await fetch("http://127.0.0.1:9222/json");
  const targets = (await targetsRes.json()) as any[];
  const copilotTab = targets.find((t) => t.type === "page" && t.url.includes("m365.cloud.microsoft"));

  const ws = new WebSocket(copilotTab.webSocketDebuggerUrl);
  await new Promise((r) => ws.on("open", r));

  let id = 1;
  const send = (method: string, params: any = {}) =>
    new Promise<any>((resolve) => {
      const curId = id++;
      const handler = (data: any) => {
        const msg = JSON.parse(data.toString());
        if (msg.id === curId) {
          ws.off("message", handler);
          resolve(msg.result);
        }
      };
      ws.on("message", handler);
      ws.send(JSON.stringify({ id: curId, method, params }));
    });

  const capturedFrames: string[] = [];
  ws.on("message", (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.method === "Network.webSocketFrameSent") {
      const payload = msg.params?.response?.payloadData || "";
      if (payload.includes("chat") || payload.includes("arguments") || payload.includes("cdp-test-file")) {
        console.log("\n🔥 [CAPTURED CHAT WS FRAME SENT]:\n", payload);
        capturedFrames.push(payload);
      }
    }
  });

  await send("Network.enable");

  // Check input box and submit button
  const evalRes = await send("Runtime.evaluate", {
    expression: `(() => {
      const input = document.querySelector('textarea, [contenteditable="true"]');
      if (!input) return { error: "No input found" };
      
      // Focus and type
      input.focus();
      if (input.tagName === 'TEXTAREA') {
        input.value = "请基于附件 cdp-test-file.txt，复述第一行内容。";
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        input.textContent = "请基于附件 cdp-test-file.txt，复述第一行内容。";
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }

      // Find submit button
      const btn = document.querySelector('button[aria-label*="发送"], button[aria-label*="Submit"], button[aria-label*="Send"], button[type="submit"]') ||
                  Array.from(document.querySelectorAll('button')).find(b => (b.innerText || '').includes('发送') || (b.getAttribute('aria-label') || '').includes('发送'));
      
      if (!btn) return { error: "No send button found" };
      
      return {
        buttonLabel: btn.getAttribute('aria-label'),
        disabled: Boolean(btn.disabled),
        ready: true
      };
    })()`,
    returnByValue: true,
  });

  console.log("Input prep:", evalRes);

  // If button ready, click it!
  const clickRes = await send("Runtime.evaluate", {
    expression: `(() => {
      const btn = document.querySelector('button[aria-label*="发送"], button[aria-label*="Submit"], button[aria-label*="Send"], button[type="submit"]') ||
                  Array.from(document.querySelectorAll('button')).find(b => (b.innerText || '').includes('发送') || (b.getAttribute('aria-label') || '').includes('发送'));
      if (btn && !btn.disabled) {
        btn.click();
        return { clicked: true };
      }
      return { clicked: false, disabled: btn ? Boolean(btn.disabled) : true };
    })()`,
    returnByValue: true,
  });

  console.log("Click result:", clickRes);

  console.log("Listening for WebSocket chat frame for 10 seconds...");
  await new Promise((r) => setTimeout(r, 10000));

  if (capturedFrames.length > 0) {
    fs.writeFileSync("./.cph/cdp-captured-chat-frame.json", capturedFrames[0], "utf-8");
    console.log("Saved chat frame to .cph/cdp-captured-chat-frame.json");
  } else {
    console.log("No chat frame captured during 10s wait.");
  }

  ws.close();
}

import fs from "fs";
main().catch(console.error);
