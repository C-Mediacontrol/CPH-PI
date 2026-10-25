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

  const check = await send("Runtime.evaluate", {
    expression: `(() => {
      // Find input area
      const input = document.querySelector('textarea, [contenteditable="true"], #userInput, [role="textbox"]');
      const submitBtn = document.querySelector('button[aria-label*="发送"], button[aria-label*="Submit"], button[aria-label*="Send"], button[type="submit"]') ||
                        Array.from(document.querySelectorAll('button')).find(b => (b.innerText || '').includes('发送') || (b.getAttribute('aria-label') || '').includes('发送'));

      // Check current model display
      const modelSwitcher = document.getElementById('gptModeSwitcher');

      return {
        inputTag: input?.tagName,
        inputId: input?.id,
        inputClass: input?.className,
        inputContentEditable: input?.getAttribute('contenteditable'),
        submitBtnFound: !!submitBtn,
        submitBtnLabel: submitBtn?.getAttribute('aria-label'),
        submitBtnDisabled: submitBtn?.disabled,
        currentModelText: modelSwitcher?.innerText?.trim(),
      };
    })()`,
    returnByValue: true,
  });

  console.log("Input Area Check:", JSON.stringify(check.result?.value, null, 2));
  ws.close();
}

main();
