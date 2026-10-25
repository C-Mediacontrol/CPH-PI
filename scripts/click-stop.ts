import WebSocket from "ws";

async function clickStop() {
  const ws = new WebSocket("ws://127.0.0.1:9222/devtools/page/55B32AD7AC038CF9B5DDDC5B228EE25E");
  ws.on("open", () => {
    ws.send(JSON.stringify({
      id: 1,
      method: "Runtime.evaluate",
      params: {
        expression: `(() => {
          const stopBtn = Array.from(document.querySelectorAll('button')).find(b => (b.getAttribute('aria-label') || '').includes('停止'));
          if (stopBtn) {
            stopBtn.click();
            return "Clicked stop button";
          }
          return "No stop button";
        })()`
      }
    }));
  });
  ws.on("message", (d) => {
    const res = JSON.parse(d.toString());
    console.log("Result:", res.result?.result?.value);
    ws.close();
    process.exit(0);
  });
}

clickStop();

