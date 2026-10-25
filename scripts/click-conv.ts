import WebSocket from "ws";

async function clickConv() {
  const ws = new WebSocket("ws://127.0.0.1:9222/devtools/page/55B32AD7AC038CF9B5DDDC5B228EE25E");
  ws.on("open", () => {
    ws.send(JSON.stringify({
      id: 1,
      method: "Runtime.evaluate",
      params: {
        expression: `(() => {
          const links = Array.from(document.querySelectorAll('*')).filter(el => 
            el.innerText && el.innerText.includes('计算代码中的最终总价')
          );
          if (links.length) {
            const target = links[0];
            const clickTarget = target.closest('a') || target.closest('button') || target;
            clickTarget.click();
            return JSON.stringify({ clicked: true, tag: clickTarget.tagName, text: clickTarget.innerText });
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

clickConv();
