import { CdpClient } from "../../copilot-web proxy/src/cdp/cdp-client.ts";

async function main() {
  const targetResp = await fetch("http://127.0.0.1:9222/json/list");
  const targets = (await targetResp.json()) as any[];
  const page = targets.find((t) => t.type === "page" && t.url.includes("m365.cloud.microsoft"));

  const client = new CdpClient(page.webSocketDebuggerUrl);
  await client.connect();

  console.log("[1] 当前模型选择器状态...");
  const current = await client.evaluate<string>(`
    (() => {
      const btn = document.getElementById("gptModeSwitcher");
      return btn ? btn.innerText.trim() : "未找到按钮";
    })()
  `);
  console.log(`[+] 当前选择器显示: "${current}"`);

  if (current.includes("GPT-6.1 Sol")) {
    console.log("[+] 已经是 GPT-6.1 Sol，无需切换！");
    process.exit(0);
  }

  console.log("[2] 点击展开 #gptModeSwitcher...");
  await client.evaluate(`
    (() => {
      const btn = document.getElementById("gptModeSwitcher");
      if (btn) btn.click();
    })()
  `);
  await new Promise((r) => setTimeout(r, 600));

  console.log("[3] 点击展开 'GPT' 子菜单...");
  await client.evaluate(`
    (() => {
      const items = Array.from(document.querySelectorAll("[role='menuitem'], .fui-MenuItem"));
      const gpt = items.find(it => (it.innerText || "").includes("GPT"));
      if (gpt) gpt.click();
    })()
  `);
  await new Promise((r) => setTimeout(r, 600));

  console.log("[4] 点击选中 'GPT-6.1 Sol'...");
  const clicked = await client.evaluate<boolean>(`
    (() => {
      const radios = Array.from(document.querySelectorAll("[role='menuitemradio'], [role='menuitem'], .fui-MenuItem"));
      const target = radios.find(it => (it.innerText || "").includes("GPT-6.1 Sol"));
      if (target) {
        target.click();
        target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
        return true;
      }
      return false;
    })()
  `);

  console.log(`[+] 点击结果: ${clicked}`);
  await new Promise((r) => setTimeout(r, 1000));

  const after = await client.evaluate<string>(`
    (() => {
      const btn = document.getElementById("gptModeSwitcher");
      return btn ? btn.innerText.trim() : "未找到按钮";
    })()
  `);
  console.log(`[+] 切换后模型选择器显示: "${after}"`);

  process.exit(0);
}

main().catch(err => {
  console.error("切换出错:", err);
  process.exit(1);
});

