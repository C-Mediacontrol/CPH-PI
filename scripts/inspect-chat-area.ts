import WebSocket from "ws";

async function inspectChatArea() {
  const ws = new WebSocket("ws://127.0.0.1:9222/devtools/page/55B32AD7AC038CF9B5DDDC5B228EE25E");
  ws.on("open", () => {
    ws.send(JSON.stringify({
      id: 1,
      method: "Runtime.evaluate",
      params: {
        expression: `(() => {
          const main = document.querySelector('main, [role="main"], [data-testid*="chat"]');
          const stop = Array.from(document.querySelectorAll('button')).find(b => (b.getAttribute('aria-label') || '').includes('停止'));
          return JSON.stringify({
            mainText: main ? main.innerText.slice(0, 1000) : "No main",
            hasStop: !!stop
          });
        })()`
      }
    }));
  });
  ws.on("message", (d) => {
    const res = JSON.parse(d.toString());
    console.log("Chat area:\n", JSON.parse(res.result?.result?.value || "{}"));
    ws.close();
    process.exit(0);
  });
}

inspectChatArea();

