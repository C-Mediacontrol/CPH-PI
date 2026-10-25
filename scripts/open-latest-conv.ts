import WebSocket from "ws";

async function openLatestConv() {
  const ws = new WebSocket("ws://127.0.0.1:9222/devtools/page/55B32AD7AC038CF9B5DDDC5B228EE25E");
  ws.on("open", () => {
    ws.send(JSON.stringify({
      id: 1,
      method: "Runtime.evaluate",
      params: {
        expression: `(() => {
          const links = Array.from(document.querySelectorAll('a, [role="button"], span, div'));
          const target = links.find(el => (el.innerText || '').trim() === '计算代码中的最终总价');
          if (target) {
            target.click();
            return { found: true, tag: target.tagName, text: target.innerText };
          }
          return { found: false };
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

openLatestConv();

