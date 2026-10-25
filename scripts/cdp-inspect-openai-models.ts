import WebSocket from "ws";

async function main() {
  const targetsRes = await fetch("http://127.0.0.1:9222/json");
  const targets = (await targetsRes.json()) as any[];
  const copilotTab = targets.find((t) => t.type === "page" && t.url.includes("m365.cloud.microsoft"));

  const ws = new WebSocket(copilotTab.webSocketDebuggerUrl);
  await new Promise((r) => ws.on("open", r));

  let id = 1;
  const send = (method: string, params: any = {}) =>
    new Promise<any>((resolve) => {
      const curId = id++;
      const handler = (data: any) => {
        const msg = JSON.parse(data.toString());
        if (msg.id === curId) {
          ws.off("message", handler);
          resolve(msg.result);
        }
      };
      ws.on("message", handler);
      ws.send(JSON.stringify({ id: curId, method, params }));
    });

  // Ensure switcher opened
  await send("Runtime.evaluate", {
    expression: `(() => {
      const btn = document.getElementById('gptModeSwitcher');
      if (btn) btn.click();
    })()`,
  });

  await new Promise((r) => setTimeout(r, 400));

  // Click or trigger mouseenter on OpenAI submenu
  const subRes = await send("Runtime.evaluate", {
    expression: `(() => {
      const openAiTrigger = document.querySelector('[data-testid="gptSubMenuModelTrigger-OpenAI"]');
      if (!openAiTrigger) return { error: "No gptSubMenuModelTrigger-OpenAI found" };
      openAiTrigger.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      openAiTrigger.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      openAiTrigger.click();
      return { triggered: true };
    })()`,
    returnByValue: true,
  });
  console.log("Trigger OpenAI sub-menu:", subRes);

  await new Promise((r) => setTimeout(r, 600));

  // Inspect all menu items now present in DOM
  const menuRes = await send("Runtime.evaluate", {
    expression: `(() => {
      const items = Array.from(document.querySelectorAll('[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], .fui-MenuItem')).map(m => ({
        text: (m.innerText || '').trim(),
        role: m.getAttribute('role'),
        checked: m.getAttribute('aria-checked'),
        testId: m.getAttribute('data-testid'),
        id: m.id
      }));
      return items;
    })()`,
    returnByValue: true,
  });

  console.log("Sub-menu items:", JSON.stringify(menuRes.result?.value, null, 2));
  ws.close();
}

main();
