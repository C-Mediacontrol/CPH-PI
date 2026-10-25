import WebSocket from "ws";

async function inspectFullMessage() {
  const ws = new WebSocket("ws://127.0.0.1:9222/devtools/page/55B32AD7AC038CF9B5DDDC5B228EE25E");
  ws.on("open", () => {
    ws.send(JSON.stringify({
      id: 1,
      method: "Runtime.evaluate",
      params: {
        expression: `(() => {
          const aiMessages = Array.from(document.querySelectorAll('[data-content="ai-message"], article, [role="article"]'));
          const lastEl = aiMessages[aiMessages.length - 1];
          if (!lastEl) return "No last element";
          return lastEl.outerHTML;
        })()`
      }
    }));
  });
  ws.on("message", (d) => {
    const res = JSON.parse(d.toString());
    console.log("outerHTML length:", (res.result?.result?.value || "").length);
    console.log("outerHTML sample:\n", (res.result?.result?.value || "").slice(0, 1500));
    ws.close();
    process.exit(0);
  });
}

inspectFullMessage();

