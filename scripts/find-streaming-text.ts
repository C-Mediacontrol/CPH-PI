import WebSocket from "ws";

async function findStreamingText() {
  const ws = new WebSocket("ws://127.0.0.1:9222/devtools/page/55B32AD7AC038CF9B5DDDC5B228EE25E");
  ws.on("open", () => {
    ws.send(JSON.stringify({
      id: 1,
      method: "Runtime.evaluate",
      params: {
        expression: `(() => {
          const allElements = Array.from(document.querySelectorAll('*'));
          const candidates = allElements.filter(el => {
            const txt = el.innerText || '';
            return txt.includes('app_entry') || txt.includes('FINAL_TOTAL') || txt.includes('SharePoint') || txt.includes('稍等') || txt.includes('检索');
          });
          return JSON.stringify(candidates.map(c => ({
            tag: c.tagName,
            cls: c.className,
            len: (c.innerText || '').length,
            sample: (c.innerText || '').slice(0, 200)
          })).slice(-10));
        })()`
      }
    }));
  });
  ws.on("message", (d) => {
    const res = JSON.parse(d.toString());
    console.log("Candidates:\n", JSON.parse(res.result?.result?.value || "[]"));
    ws.close();
    process.exit(0);
  });
}

findStreamingText();

