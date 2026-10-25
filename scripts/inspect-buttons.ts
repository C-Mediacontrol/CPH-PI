import WebSocket from "ws";

async function inspectButtonsAndStatus() {
  const ws = new WebSocket("ws://127.0.0.1:9222/devtools/page/55B32AD7AC038CF9B5DDDC5B228EE25E");
  ws.on("open", () => {
    ws.send(JSON.stringify({
      id: 1,
      method: "Runtime.evaluate",
      params: {
        expression: `(() => {
          const buttons = Array.from(document.querySelectorAll('button')).map(b => ({
            text: b.innerText.trim(),
            ariaLabel: b.getAttribute('aria-label'),
            disabled: b.disabled
          })).filter(b => b.text || b.ariaLabel);

          const aiMessages = Array.from(document.querySelectorAll('[data-content="ai-message"], article, [role="article"]')).map(el => el.innerText);

          return JSON.stringify({
            buttons: buttons.slice(0, 15),
            messageCount: aiMessages.length,
            lastMessage: aiMessages[aiMessages.length - 1] || ""
          });
        })()`
      }
    }));
  });
  ws.on("message", (d) => {
    const res = JSON.parse(d.toString());
    const val = JSON.parse(res.result?.result?.value || "{}");
    console.log("Buttons:", val.buttons);
    console.log("Message Count:", val.messageCount);
    console.log("Last Message:\n", val.lastMessage);
    ws.close();
    process.exit(0);
  });
}

inspectButtonsAndStatus();

