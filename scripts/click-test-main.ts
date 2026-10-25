import WebSocket from "ws";

async function clickTestMain() {
  const ws = new WebSocket("ws://127.0.0.1:9222/devtools/page/55B32AD7AC038CF9B5DDDC5B228EE25E");
  ws.on("open", () => {
    ws.send(JSON.stringify({
      id: 1,
      method: "Runtime.evaluate",
      params: {
        expression: `(() => {
          const all = Array.from(document.querySelectorAll('*'));
          const tm = all.find(el => el.innerText && el.innerText.trim() === 'Test-Main');
          if (tm) {
            const btn = tm.closest('a') || tm.closest('button') || tm;
            btn.click();
            return JSON.stringify({ clicked: true, text: tm.innerText, tag: btn.tagName });
          }
          return JSON.stringify({ clicked: false });
        })()`
      }
    }));
  });
  ws.on("message", (d) => {
    const res = JSON.parse(d.toString());
    console.log("Result:", JSON.parse(res.result?.result?.value || "{}"));
    ws.close();
    process.exit(0);
  });
}

clickTestMain();

