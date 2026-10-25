import WebSocket from "ws";

async function clickTargetAccount() {
  const ws = new WebSocket("ws://127.0.0.1:9222/devtools/page/55B32AD7AC038CF9B5DDDC5B228EE25E");
  ws.on("open", () => {
    ws.send(JSON.stringify({
      id: 1,
      method: "Runtime.evaluate",
      params: {
        expression: `(() => {
          const el = document.querySelector('[data-test-id="gsc.vfu2@cma-cgm.com"]');
          if (el) {
            el.click();
            return JSON.stringify({ clicked: true, text: el.innerText });
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

clickTargetAccount();

