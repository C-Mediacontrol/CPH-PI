import WebSocket from "ws";

async function dumpAll() {
  const ws = new WebSocket("ws://127.0.0.1:9222/devtools/page/55B32AD7AC038CF9B5DDDC5B228EE25E");
  ws.on("open", () => {
    ws.send(JSON.stringify({
      id: 1,
      method: "Runtime.evaluate",
      params: {
        expression: `(() => {
          const items = Array.from(document.querySelectorAll('[data-content="ai-message"], [data-content="user-message"], article, [role="article"], .fai-CopilotMessage'));
          return JSON.stringify(items.map(it => ({
            role: it.getAttribute('data-content') || it.className,
            text: it.innerText
          })));
        })()`
      }
    }));
  });
  ws.on("message", (d) => {
    const res = JSON.parse(d.toString());
    const list = JSON.parse(res.result?.result?.value || "[]");
    console.log("Found items:", list.length);
    for (let i = 0; i < list.length; i++) {
      console.log(`\n--- ITEM ${i} (${list[i].role}) ---`);
      console.log(list[i].text);
    }
    ws.close();
    process.exit(0);
  });
}

dumpAll();

