import { CdpClient } from "../../copilot-web proxy/src/cdp/cdp-client.ts";
import fs from "node:fs";
import path from "node:path";

async function main() {
  const targetResp = await fetch("http://127.0.0.1:9222/json/list");
  const targets = (await targetResp.json()) as any[];
  const page = targets.find((t) => t.type === "page" && t.url.includes("m365.cloud.microsoft"));

  const client = new CdpClient(page.webSocketDebuggerUrl);
  await client.connect();

  console.log("[1] 启动 CDP Network 监听...");
  await client.send("Network.enable");

  const capturedWsFrames: any[] = [];
  const capturedHttpReqs: any[] = [];

  client.on("Network.webSocketFrameSent", (params) => {
    capturedWsFrames.push({ type: "sent", time: new Date().toISOString(), payload: params.response.payloadData });
  });

  client.on("Network.webSocketFrameReceived", (params) => {
    capturedWsFrames.push({ type: "received", time: new Date().toISOString(), payload: params.response.payloadData });
  });

  client.on("Network.requestWillBeSent", (params) => {
    if (params.request.url.includes("copilot") || params.request.url.includes("chat") || params.request.url.includes("agent")) {
      capturedHttpReqs.push({ url: params.request.url, method: params.request.method, postData: params.request.postData });
    }
  });

  console.log("[2] 打开'添加和管理来源'菜单...");
  await client.evaluate(`
    (() => {
      const btn = Array.from(document.querySelectorAll("button, [role='button']")).find(b => 
        (b.getAttribute("aria-label") || "").includes("添加和管理来源")
      );
      if (btn) btn.click();
    })()
  `);
  await new Promise((r) => setTimeout(r, 600));

  console.log("[3] 点击或移入'添加功能'子菜单...");
  await client.evaluate(`
    (() => {
      const items = Array.from(document.querySelectorAll("[role='menuitem'], .fui-MenuItem"));
      const addFeature = items.find(it => (it.innerText || "").includes("添加功能"));
      if (addFeature) {
        addFeature.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
        addFeature.click();
      }
    })()
  `);
  await new Promise((r) => setTimeout(r, 600));

  console.log("[4] 检索子菜单项（寻找'草稿页或代码'）...");
  const subItems = await client.evaluate<any>(`
    (() => {
      const all = Array.from(document.querySelectorAll("[role='menuitem'], [role='menu'] button, [role='menu'] div, .fui-MenuItem"));
      return all.map(x => ({
        tag: x.tagName,
        text: x.innerText ? x.innerText.split("\\n")[0].trim() : "",
        aria: x.getAttribute("aria-label") || "",
        className: x.className
      })).filter(x => x.text.length > 0 && x.text.length < 50);
    })()
  `);
  console.log("当前可见菜单选项：", JSON.stringify(subItems, null, 2));

  const draftItem = subItems.find((x: any) => x.text.includes("草稿页") || x.text.includes("代码"));
  if (draftItem) {
    console.log(`[5] 找到'草稿页或代码'项！尝试点击...`);
    await client.evaluate(`
      (() => {
        const all = Array.from(document.querySelectorAll("[role='menuitem'], [role='menu'] button, [role='menu'] div, .fui-MenuItem"));
        const target = all.find(x => (x.innerText || "").includes("草稿页") || (x.innerText || "").includes("代码"));
        if (target) {
          target.click();
          target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        }
      })()
    `);
    await new Promise((r) => setTimeout(r, 1000));

    // 检查输入框区域是否有新增的芯片/徽章 (Chip / Tag)
    const editorTags = await client.evaluate<any>(`
      (() => {
        const chips = Array.from(document.querySelectorAll("[role='button'], .fui-Tag, span, div")).filter(el => {
          const t = el.innerText || "";
          return (t.includes("草稿页") || t.includes("代码") || t.includes("页面")) && el.children.length === 0;
        }).map(el => el.innerText.trim());
        return chips;
      })()
    `);
    console.log("[+] 点击'草稿页或代码'后在输入框检测到的 Tag/Chip:", editorTags);
  } else {
    console.warn("[-] 未能在展开的菜单中定位到'草稿页或代码'");
  }

  const resultData = {
    subItems,
    capturedWsFramesCount: capturedWsFrames.length,
    capturedHttpReqsCount: capturedHttpReqs.length,
    capturedWsFrames: capturedWsFrames.slice(0, 10),
    capturedHttpReqs
  };

  const outPath = path.resolve("CPH-PI/.docs/notes/probe-results.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(resultData, null, 2), "utf-8");
  console.log(`[+] 抓包探测记录已持久化保存至: ${outPath}`);

  process.exit(0);
}

main().catch(err => {
  console.error("探测出错:", err);
  process.exit(1);
});

