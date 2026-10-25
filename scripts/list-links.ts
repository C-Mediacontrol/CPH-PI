import WebSocket from "ws";

async function listLinks() {
  const ws = new WebSocket("ws://127.0.0.1:9222/devtools/page/55B32AD7AC038CF9B5DDDC5B228EE25E");
  ws.on("open", () => {
    ws.send(JSON.stringify({
      id: 1,
      method: "Runtime.evaluate",
      params: {
        expression: `(() => {
          const links = Array.from(document.querySelectorAll('a, [role="link"], [role="treeitem"], .fui-NavSubItem'));
          return JSON.stringify(links.map(l => ({
            text: l.innerText.trim(),
            href: l.getAttribute('href')
          })).slice(0, 10));
        })()`
      }
    }));
  });
  ws.on("message", (d) => {
    const res = JSON.parse(d.toString());
    console.log("Links found:\n", JSON.parse(res.result?.result?.value || "[]"));
    ws.close();
    process.exit(0);
  });
}

listLinks();

