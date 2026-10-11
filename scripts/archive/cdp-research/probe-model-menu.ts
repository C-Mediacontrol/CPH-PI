import { CdpClient } from "../../copilot-web proxy/src/cdp/cdp-client.ts";

async function main() {
  const targetResp = await fetch("http://127.0.0.1:9222/json/list");
  const targets = (await targetResp.json()) as any[];
  const page = targets.find((t) => t.type === "page" && t.url.includes("m365.cloud.microsoft"));

  const client = new CdpClient(page.webSocketDebuggerUrl);
  await client.connect();

  console.log("[1] 点击 #gptModeSwitcher 展开模型选择器菜单...");
  await client.evaluate(`
    (() => {
      const btn = document.getElementById("gptModeSwitcher");
      if (btn) btn.click();
    })()
  `);

  await new Promise((r) => setTimeout(r, 600));

  const menuInfo = await client.evaluate<any>(`
    (() => {
      const items = Array.from(document.querySelectorAll("[role='menuitem'], [role='menuitemradio'], .fui-MenuItem, [role='menu'] button, [role='menu'] div"));
      return items.map(it => ({
        tag: it.tagName,
        role: it.getAttribute("role") || "",
        text: it.innerText ? it.innerText.split("\\n")[0].trim() : "",
        aria: it.getAttribute("aria-label") || "",
        ariaChecked: it.getAttribute("aria-checked")
      })).filter(x => x.text.length > 0 && x.text.length < 50);
    })()
  `);

  console.log("模型菜单第一层选项：", JSON.stringify(menuInfo, null, 2));

  // 检查是否包含 GPT 子菜单
  const hasGptSubmenu = menuInfo.some((x: any) => x.text.includes("GPT"));
  if (hasGptSubmenu) {
    console.log("[2] 发现 GPT 菜单项，尝试展开 GPT 子菜单...");
    await client.evaluate(`
      (() => {
        const items = Array.from(document.querySelectorAll("[role='menuitem'], .fui-MenuItem"));
        const gpt = items.find(it => (it.innerText || "").includes("GPT"));
        if (gpt) gpt.click();
      })()
    `);

    await new Promise((r) => setTimeout(r, 600));

    const subMenuInfo = await client.evaluate<any>(`
      (() => {
        const items = Array.from(document.querySelectorAll("[role='menuitemradio'], [role='menuitem'], .fui-MenuItem"));
        return items.map(it => ({
          tag: it.tagName,
          role: it.getAttribute("role") || "",
          text: it.innerText ? it.innerText.split("\\n")[0].trim() : "",
          aria: it.getAttribute("aria-label") || "",
          ariaChecked: it.getAttribute("aria-checked")
        })).filter(x => x.text.length > 0 && x.text.length < 50);
      })()
    `);
    console.log("GPT 子菜单所有选项：", JSON.stringify(subMenuInfo, null, 2));
  }

  process.exit(0);
}

main().catch(err => {
  console.error("探测出错:", err);
  process.exit(1);
});

