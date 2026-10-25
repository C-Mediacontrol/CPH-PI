import WebSocket from "ws";

async function inspectTiles() {
  const ws = new WebSocket("ws://127.0.0.1:9222/devtools/page/55B32AD7AC038CF9B5DDDC5B228EE25E");
  ws.on("open", () => {
    ws.send(JSON.stringify({
      id: 1,
      method: "Runtime.evaluate",
      params: {
        expression: `(() => {
          const tiles = Array.from(document.querySelectorAll('#tilesHolder, .table, [data-test-id], [role="listitem"], .tile'));
          return JSON.stringify(tiles.map(t => ({
            id: t.id,
            className: t.className,
            dataTestId: t.getAttribute('data-test-id'),
            innerText: t.innerText
          })));
        })()`
      }
    }));
  });
  ws.on("message", (d) => {
    const res = JSON.parse(d.toString());
    console.log("Tiles info:\n", JSON.parse(res.result?.result?.value || "[]"));
    ws.close();
    process.exit(0);
  });
}

inspectTiles();

