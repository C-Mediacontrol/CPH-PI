import { CdpClient } from "../../copilot-web proxy/src/cdp/cdp-client.ts";

async function main() {
  const targetResp = await fetch("http://127.0.0.1:9222/json/list");
  const targets = (await targetResp.json()) as any[];
  const page = targets.find((t) => t.type === "page" && t.url.includes("m365.cloud.microsoft"));

  const client = new CdpClient(page.webSocketDebuggerUrl);
  await client.connect();

  console.log("[1] 打开'添加和管理来源'菜单...");
  await client.evaluate(`
    (() => {
      const btn = Array.from(document.querySelectorAll("button, [role='button']")).find(b => 
        (b.getAttribute("aria-label") || "").includes("添加和管理来源")
      );
      if (btn) btn.click();
    })()
  `);
  await new Promise((r) => setTimeout(r, 600));

  console.log("[2] 触发'与代理聊天'...");
  await client.evaluate(`
    (() => {
      const items = Array.from(document.querySelectorAll("[role='menuitem'], .fui-MenuItem, div, span"));
      const agentMenu = items.find(it => (it.innerText || "").includes("与代理聊天"));
      if (agentMenu) {
        agentMenu.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
        agentMenu.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
        agentMenu.click();
      }
    })()
  `);
  await new Promise((r) => setTimeout(r, 800));

  console.log("[3] 获取智能体/代理列表...");
  const agentItems = await client.evaluate<any>(`
    (() => {
      const all = Array.from(document.querySelectorAll("[role='menuitem'], [role='menu'] button, [role='menu'] div, .fui-MenuItem"));
      return all.map(x => ({
        tag: x.tagName,
        text: x.innerText ? x.innerText.split("\\n")[0].trim() : "",
        aria: x.getAttribute("aria-label") || ""
      })).filter(x => x.text.length > 0 && x.text.length < 50);
    })()
  `);
  console.log("可见代理列表：", JSON.stringify(agentItems, null, 2));

  process.exit(0);
}

main().catch(err => {
  console.error("出错:", err);
  process.exit(1);
});

