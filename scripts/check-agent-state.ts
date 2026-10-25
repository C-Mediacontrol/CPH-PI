import WebSocket from "ws";

async function checkAgent() {
  const ws = new WebSocket("ws://127.0.0.1:9222/devtools/page/55B32AD7AC038CF9B5DDDC5B228EE25E");
  ws.on("open", () => {
    ws.send(JSON.stringify({
      id: 1,
      method: "Runtime.evaluate",
      params: {
        expression: `(() => {
          const title = document.title;
          const h1 = document.querySelector('h1, [class*="agent-title"], [data-testid*="agent"]')?.innerText || '';
          const gptSwitcher = document.getElementById('gptModeSwitcher')?.innerText || 'None';
          const editor = document.getElementById('m365-chat-editor-target-element');
          return JSON.stringify({
            title,
            h1,
            gptSwitcher,
            hasEditor: !!editor
          });
        })()`
      }
    }));
  });
  ws.on("message", (data) => {
    const msg = JSON.parse(data.toString());
    console.log("Agent info:", msg.result?.result?.value);
    ws.close();
    process.exit(0);
  });
}

checkAgent();

