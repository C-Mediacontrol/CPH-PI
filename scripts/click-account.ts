import WebSocket from "ws";

async function clickAccount() {
  const ws = new WebSocket("ws://127.0.0.1:9222/devtools/page/55B32AD7AC038CF9B5DDDC5B228EE25E");
  ws.on("open", () => {
    ws.send(JSON.stringify({
      id: 1,
      method: "Runtime.evaluate",
      params: {
        expression: `(() => {
          const tiles = Array.from(document.querySelectorAll('[data-test-id*="tiles"], [role="button"], div, span'));
          const target = tiles.find(el => (el.innerText || '').includes('GSC.VFU2@cma-cgm.com'));
          if (target) {
            const btn = target.closest('[role="button"]') || target.closest('div[tabindex]') || target;
            btn.click();
            return JSON.stringify({ clicked: true, text: target.innerText });
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

clickAccount();
