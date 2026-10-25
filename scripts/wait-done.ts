import WebSocket from "ws";

async function waitDone() {
  const ws = new WebSocket("ws://127.0.0.1:9222/devtools/page/55B32AD7AC038CF9B5DDDC5B228EE25E");
  await new Promise((resolve) => ws.on("open", resolve));

  console.log("Waiting for '停止生成' to finish...");
  let done = false;
  while (!done) {
    await new Promise((r) => setTimeout(r, 3000));
    const res: any = await new Promise((resolve) => {
      const id = Date.now();
      const handler = (data: any) => {
        const msg = JSON.parse(data.toString());
        if (msg.id === id) {
          ws.off("message", handler);
          resolve(msg.result?.result?.value);
        }
      };
      ws.on("message", handler);
      ws.send(JSON.stringify({
        id,
        method: "Runtime.evaluate",
        params: {
          expression: `(() => {
            const stop = Array.from(document.querySelectorAll('button')).some(b => (b.getAttribute('aria-label') || '').includes('停止'));
            const bubbles = Array.from(document.querySelectorAll('[data-content="ai-message"], article, [role="article"]'));
            const last = bubbles.length ? bubbles[bubbles.length - 1].innerText : "";
            return JSON.stringify({ isStop: stop, textLength: last.length, textTail: last.slice(-150) });
          })()`
        }
      }));
    });

    const parsed = JSON.parse(res || "{}");
    console.log(`[WAIT] isStop: ${parsed.isStop}, Length: ${parsed.textLength}, Tail: ${JSON.stringify(parsed.textTail)}`);
    if (!parsed.isStop) {
      done = true;
    }
  }

  // Get full text
  const finalRes: any = await new Promise((resolve) => {
    const id = Date.now() + 1;
    const handler = (data: any) => {
      const msg = JSON.parse(data.toString());
      if (msg.id === id) {
        ws.off("message", handler);
        resolve(msg.result?.result?.value);
      }
    };
    ws.on("message", handler);
    ws.send(JSON.stringify({
      id,
      method: "Runtime.evaluate",
      params: {
        expression: `(() => {
          const bubbles = Array.from(document.querySelectorAll('[data-content="ai-message"], article, [role="article"]'));
          return bubbles.length ? bubbles[bubbles.length - 1].innerText : "";
        })()`
      }
    }));
  });

  console.log("\n=== COMPLETED RESPONSE ===");
  console.log(finalRes);
  ws.close();
  process.exit(0);
}

waitDone().catch(console.error);

