import { CdpClient } from "../../copilot-web proxy/src/cdp/cdp-client.ts";

async function main() {
  const targetResp = await fetch("http://127.0.0.1:9222/json/list");
  const targets = (await targetResp.json()) as any[];
  const page = targets.find((t) => t.type === "page" && t.url.includes("m365.cloud.microsoft"));

  const client = new CdpClient(page.webSocketDebuggerUrl);
  await client.connect();

  console.log("[1] 寻找输入框附近的添加按钮 (+ 按钮)...");
  const addButtons = await client.evaluate<any>(`
    (() => {
      const btns = Array.from(document.querySelectorAll("button, [role='button']"));
      const candidates = btns.filter(b => {
        const aria = b.getAttribute("aria-label") || "";
        const title = b.getAttribute("title") || "";
        const text = b.innerText || "";
        return aria.includes("添加") || aria.includes("内容") || aria.includes("功能") ||
               aria.includes("Add") || title.includes("添加") || text === "+";
      }).map(b => ({
        tag: b.tagName,
        aria: b.getAttribute("aria-label") || "",
        title: b.getAttribute("title") || "",
        text: b.innerText.trim(),
        id: b.id,
        className: b.className
      }));
      return candidates;
    })()
  `);

  console.log("候选添加按钮：", JSON.stringify(addButtons, null, 2));

  // 尝试点击第一个匹配为添加内容的按钮
  const targetBtn = addButtons.find((b: any) => b.aria.includes("添加") || b.title.includes("添加") || b.text === "+");
  if (targetBtn) {
    console.log(`[2] 尝试点击按钮: aria="${targetBtn.aria}", title="${targetBtn.title}"...`);
    await client.evaluate(`
      ((targetAria, targetId) => {
        let btn = targetId ? document.getElementById(targetId) : null;
        if (!btn && targetAria) {
          btn = Array.from(document.querySelectorAll("button, [role='button']")).find(b => 
            (b.getAttribute("aria-label") || "") === targetAria
          );
        }
        if (btn) btn.click();
      })(${JSON.stringify(targetBtn.aria)}, ${JSON.stringify(targetBtn.id)})
    `);

    await new Promise((r) => setTimeout(r, 600));

    const popoverItems = await client.evaluate<any>(`
      (() => {
        const all = Array.from(document.querySelectorAll("[role='menuitem'], [role='menu'] button, [role='menu'] div, .fui-MenuItem, [role='dialog'] button"));
        return all.map(x => ({
          tag: x.tagName,
          text: x.innerText ? x.innerText.split("\\n")[0].trim() : "",
          aria: x.getAttribute("aria-label") || ""
        })).filter(x => x.text.length > 0 && x.text.length < 50);
      })()
    `);
    console.log("弹出菜单/功能项：", JSON.stringify(popoverItems, null, 2));
  }

  process.exit(0);
}

main().catch(err => {
  console.error("探测出错:", err);
  process.exit(1);
});

