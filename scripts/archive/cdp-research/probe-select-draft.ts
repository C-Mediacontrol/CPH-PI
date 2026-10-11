import { CdpClient } from "../../copilot-web proxy/src/cdp/cdp-client.ts";

async function main() {
  const targetResp = await fetch("http://127.0.0.1:9222/json/list");
  const targets = (await targetResp.json()) as any[];
  const page = targets.find((t) => t.type === "page" && t.url.includes("m365.cloud.microsoft"));

  const client = new CdpClient(page.webSocketDebuggerUrl);
  await client.connect();

  console.log("[1] 打开菜单...");
  await client.evaluate(`
    (() => {
      const btn = Array.from(document.querySelectorAll("button, [role='button']")).find(b => 
        (b.getAttribute("aria-label") || "").includes("添加和管理来源")
      );
      if (btn) btn.click();
    })()
  `);
  await new Promise((r) => setTimeout(r, 600));

  console.log("[2] 触发'添加功能' hover/click...");
  await client.evaluate(`
    (() => {
      const items = Array.from(document.querySelectorAll("[role='menuitem'], .fui-MenuItem, div, span"));
      const addFeature = items.find(it => it.innerText && it.innerText.trim() === "添加功能");
      if (addFeature) {
        addFeature.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
        addFeature.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
        addFeature.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
        addFeature.click();
      }
    })()
  `);
  await new Promise((r) => setTimeout(r, 800));

  console.log("[3] 扫描全页面所有包含'草稿'或'代码'的元素...");
  const matches = await client.evaluate<any>(`
    (() => {
      const all = Array.from(document.querySelectorAll("*"));
      const filtered = all.filter(el => {
        const text = el.innerText || "";
        return text.includes("草稿页") || text.includes("代码") || text.includes("Pages");
      }).map(el => ({
        tag: el.tagName,
        className: el.className,
        role: el.getAttribute("role") || "",
        aria: el.getAttribute("aria-label") || "",
        text: (el.innerText || "").slice(0, 40)
      }));
      return filtered.slice(0, 15);
    })()
  `);
  console.log("匹配到的元素：", JSON.stringify(matches, null, 2));

  // 如果找到，尝试点击最底层的叶子节点
  await client.evaluate(`
    (() => {
      const all = Array.from(document.querySelectorAll("[role='menuitem'], .fui-MenuItem, div, button"));
      const target = all.find(el => (el.innerText || "").trim() === "草稿页或代码");
      if (target) {
        target.click();
        target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      }
    })()
  `);
  await new Promise((r) => setTimeout(r, 1000));

  // 检查是否有任何状态改变（例如输入框上方多了一个标签，或者 URL 改变）
  const uiState = await client.evaluate<any>(`
    (() => {
      const fullText = document.body.innerText || "";
      const hasChip = fullText.includes("页面") || fullText.includes("草稿") || fullText.includes("代码");
      const chips = Array.from(document.querySelectorAll("[role='button'], div, span")).filter(el => {
        const t = (el.innerText || "").trim();
        return (t === "页面" || t === "草稿页或代码" || t.includes("页面 ✕")) && el.children.length <= 1;
      }).map(el => el.innerText.trim());

      return { chips, url: window.location.href };
    })()
  `);
  console.log("[4] 选中后的状态：", uiState);

  process.exit(0);
}

main().catch(err => {
  console.error("出错:", err);
  process.exit(1);
});

