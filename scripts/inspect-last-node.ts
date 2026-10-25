import WebSocket from "ws";

async function inspectLastNode() {
  const ws = new WebSocket("ws://127.0.0.1:9222/devtools/page/55B32AD7AC038CF9B5DDDC5B228EE25E");
  ws.on("open", () => {
    ws.send(JSON.stringify({
      id: 1,
      method: "Runtime.evaluate",
      params: {
        expression: `(() => {
          const msgs = document.querySelectorAll('.fai-CopilotMessage');
          const last = msgs[msgs.length - 1];
          return JSON.stringify({
            busy: last.getAttribute('aria-busy'),
            allText: last.innerText,
            allParagraphs: Array.from(last.querySelectorAll('p, div.fai-CopilotMessage__content')).map(e => e.innerText)
          });
        })()`
      }
    }));
  });
  ws.on("message", (d) => {
    const res = JSON.parse(d.toString());
    console.log("Details:", JSON.parse(res.result?.result?.value || "{}"));
    ws.close();
    process.exit(0);
  });
}

inspectLastNode();

