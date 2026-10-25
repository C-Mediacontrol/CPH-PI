import WebSocket from "ws";

async function getDom() {
  const ws = new WebSocket("ws://127.0.0.1:9222/devtools/page/55B32AD7AC038CF9B5DDDC5B228EE25E");
  ws.on("open", () => {
    ws.send(JSON.stringify({
      id: 1,
      method: "Runtime.evaluate",
      params: {
        expression: `(() => {
          const stopBtn = Array.from(document.querySelectorAll('button')).find(b => 
            (b.innerText || '').includes('停止') || 
            (b.getAttribute('aria-label') || '').includes('停止') ||
            (b.getAttribute('aria-label') || '').toLowerCase().includes('stop')
          );
          const bubbles = Array.from(document.querySelectorAll('[data-content="ai-message"], [class*="ChatMessage"], [class*="chat-message"], [class*="response-content"], .fai-ChatMessage, article, [role="article"]'));
          const last = bubbles.length ? bubbles[bubbles.length - 1].innerText : "No bubbles";
          return JSON.stringify({ isGenerating: !!stopBtn, text: last });
        })()`
      }
    }));
  });
  ws.on("message", (d) => {
    const res = JSON.parse(d.toString());
    const val = JSON.parse(res.result?.result?.value || "{}");
    console.log("Generating:", val.isGenerating);
    console.log("Latest Text:\n", val.text);
    ws.close();
    process.exit(0);
  });
}

getDom();

