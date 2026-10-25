import WebSocket from "ws";

async function findStop() {
  const ws = new WebSocket("ws://127.0.0.1:9222/devtools/page/55B32AD7AC038CF9B5DDDC5B228EE25E");
  ws.on("open", () => {
    ws.send(JSON.stringify({
      id: 1,
      method: "Runtime.evaluate",
      params: {
        expression: `(() => {
          const list = Array.from(document.querySelectorAll('button')).map(b => ({
            text: b.innerText,
            aria: b.getAttribute('aria-label'),
            id: b.id
          }));
          const matches = list.filter(b => 
            (b.text && (b.text.includes('停止') || b.text.toLowerCase().includes('stop'))) ||
            (b.aria && (b.aria.includes('停止') || b.aria.toLowerCase().includes('stop')))
          );
          return JSON.stringify(matches);
        })()`
      }
    }));
  });
  ws.on("message", (d) => {
    const res = JSON.parse(d.toString());
    console.log("Stop matches:", JSON.parse(res.result?.result?.value || "[]"));
    ws.close();
    process.exit(0);
  });
}

findStop();

