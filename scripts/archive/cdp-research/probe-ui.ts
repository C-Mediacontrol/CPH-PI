import { CdpClient } from "../../copilot-web proxy/src/cdp/cdp-client.ts";

async function main() {
  const targetResp = await fetch("http://127.0.0.1:9222/json/list");
  const targets = (await targetResp.json()) as any[];
  const page = targets.find((t) => t.type === "page" && t.url.includes("m365.cloud.microsoft"));

  if (!page) {
    console.error("未找到 M365 Copilot 页面！当前页面列表：", targets.map(t => ({ title: t.title, url: t.url })));
    process.exit(1);
  }

  console.log(`[+] 命中目标页面: "${page.title}" (${page.url})`);
  const client = new CdpClient(page.webSocketDebuggerUrl);
  await client.connect();
  console.log("[+] CDP 连接成功！");

  // 检查页面元素：模型选择器、添加功能按钮、当前模型等
  const info = await client.evaluate<any>(`
    (() => {
      // 1. 查找模型选择器
      const allButtons = Array.from(document.querySelectorAll("button, [role='button']"));
      const modelBtns = allButtons.filter(b => 
        (b.getAttribute("aria-label") || "").includes("模型") ||
        (b.innerText || "").includes("GPT") ||
        (b.innerText || "").includes("自动") ||
        (b.getAttribute("aria-label") || "").includes("Model")
      ).map(b => ({
        tag: b.tagName,
        text: b.innerText.trim(),
        aria: b.getAttribute("aria-label") || "",
        id: b.id,
        className: b.className
      }));

      // 2. 查找添加功能按钮
      const addBtns = allButtons.filter(b =>
        (b.getAttribute("aria-label") || "").includes("添加") ||
        (b.innerText || "").includes("添加") ||
        (b.getAttribute("aria-label") || "").includes("功能") ||
        (b.innerText || "").includes("功能")
      ).map(b => ({
        text: b.innerText.trim(),
        aria: b.getAttribute("aria-label") || ""
      }));

      // 3. 查找智能体 / Agent 相关入口
      const agentLinks = Array.from(document.querySelectorAll("a, button")).filter(el =>
        (el.innerText || "").includes("智能体") ||
        (el.getAttribute("aria-label") || "").includes("智能体") ||
        (el.innerText || "").includes("Agent") ||
        (el.getAttribute("aria-label") || "").includes("Agent")
      ).map(el => ({
        text: el.innerText.trim().slice(0, 50),
        aria: el.getAttribute("aria-label") || "",
        href: el.getAttribute("href") || ""
      }));

      // 4. 输入框状态
      const lexical = document.getElementById("m365-chat-editor-target-element");
      const textarea = document.querySelector("textarea");

      return {
        modelBtns,
        addBtns,
        agentLinks,
        hasInput: !!lexical || !!textarea,
        inputDetails: lexical ? "Lexical Editor" : (textarea ? "Standard Textarea" : "None")
      };
    })()
  `);

  console.log("=== 页面探测结果 ===");
  console.log("模型相关按钮:", JSON.stringify(info.modelBtns, null, 2));
  console.log("添加功能相关按钮:", JSON.stringify(info.addBtns, null, 2));
  console.log("智能体 / Agent 相关元素:", JSON.stringify(info.agentLinks, null, 2));
  console.log("输入框状态:", info.inputDetails);

  process.exit(0);
}

main().catch(err => {
  console.error("探测出错:", err);
  process.exit(1);
});
