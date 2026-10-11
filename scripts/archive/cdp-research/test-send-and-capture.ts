import { CdpClient } from "../../copilot-web proxy/src/cdp/cdp-client.ts";
import { CopilotPage } from "../../copilot-web proxy/src/cdp/copilot-page.ts";
import fs from "node:fs";
import path from "node:path";

async function main() {
  const targetResp = await fetch("http://127.0.0.1:9222/json/list");
  const targets = (await targetResp.json()) as any[];
  const pageTarget = targets.find((t) => t.type === "page" && t.url.includes("m365.cloud.microsoft"));

  const client = new CdpClient(pageTarget.webSocketDebuggerUrl);
  await client.connect();
  const page = new CopilotPage(client);
  await page.init();

  console.log("[1] 开启 CDP Network 抓包监听...");
  await client.send("Network.enable");

  const capturedFrames: any[] = [];
  let chatSentFrame: any = null;

  client.on("Network.webSocketFrameSent", (params) => {
    try {
      const raw = params.response.payloadData;
      capturedFrames.push({ dir: "sent", raw });
      const frames = raw.split("\x1e").filter(Boolean);
      for (const f of frames) {
        const parsed = JSON.parse(f);
        if (parsed.target === "chat") {
          chatSentFrame = parsed;
          console.log("\n=======================================================");
          console.log("【捕获到 Chat 发送帧 arguments[0]】:");
          console.log("tone:", parsed.arguments?.[0]?.tone);
          console.log("experienceType:", parsed.arguments?.[0]?.message?.experienceType);
          console.log("optionsSets:", parsed.arguments?.[0]?.optionsSets);
          console.log("plugins:", parsed.arguments?.[0]?.plugins);
          console.log("clientInfo:", parsed.arguments?.[0]?.clientInfo);
          console.log("=======================================================\n");
        }
      }
    } catch {}
  });

  const receivedChunks: string[] = [];
  client.on("Network.webSocketFrameReceived", (params) => {
    try {
      const raw = params.response.payloadData;
      const frames = raw.split("\x1e").filter(Boolean);
      for (const f of frames) {
        const parsed = JSON.parse(f);
        if (parsed.type === 1 && parsed.target === "chat" && parsed.arguments?.[0]?.messages?.[0]?.text) {
          receivedChunks.push(parsed.arguments[0].messages[0].text);
        }
      }
    } catch {}
  });

  console.log("[2] 点击新建聊天...");
  await client.evaluate(`
    (() => {
      const btn = Array.from(document.querySelectorAll("button, a")).find(b => 
        (b.getAttribute("aria-label") || "").includes("新建") ||
        (b.innerText || "").includes("新建聊天")
      );
      if (btn) btn.click();
    })()
  `);
  await new Promise((r) => setTimeout(r, 2000));

  console.log("[3] 确保模型为 GPT-6.1 Sol...");
  const modelStatus = await page.ensureModel("GPT-6.1 Sol");
  console.log(`[+] 当前模型状态: "${modelStatus.currentModel}"`);

  console.log("[4] 挂载'草稿页或代码' (Pages) 芯片...");
  // 展开添加菜单
  await client.evaluate(`
    (() => {
      const btn = Array.from(document.querySelectorAll("button, [role='button']")).find(b => 
        (b.getAttribute("aria-label") || "").includes("添加和管理来源")
      );
      if (btn) btn.click();
    })()
  `);
  await new Promise((r) => setTimeout(r, 600));

  // 移入添加功能
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
  await new Promise((r) => setTimeout(r, 600));

  // 点击草稿页或代码
  const clickedDraft = await client.evaluate<boolean>(`
    (() => {
      const all = Array.from(document.querySelectorAll("[role='menuitem'], .fui-MenuItem, div, button"));
      const target = all.find(el => (el.innerText || "").trim() === "草稿页或代码");
      if (target) {
        target.click();
        target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
        return true;
      }
      return false;
    })()
  `);
  console.log(`[+] 挂载'草稿页或代码'结果: ${clickedDraft}`);
  await new Promise((r) => setTimeout(r, 800));

  console.log("[5] 灌入测试提示词...");
  const testPrompt = "请测试环境探测：如果需要执行命令，请严格且仅输出如下 action 块，严禁包含多余套话：\n```action\ntool: run_command\ncommand: git status\n```";
  await page.setInputText(testPrompt);
  await new Promise((r) => setTimeout(r, 500));

  console.log("[6] 点击发送并监听响应...");
  await page.clickSend();

  console.log("[7] 等待模型响应中 (最多等待 40 秒)...");
  try {
    const finalResp = await page.waitForResponse(40000, 1000);
    console.log("\n=======================================================");
    console.log("【模型最终响应文本】:");
    console.log(finalResp);
    console.log("=======================================================\n");

    // 保存捕获结果
    const dumpPath = path.resolve("CPH-PI/.docs/notes/draft-mode-capture.json");
    fs.mkdirSync(path.dirname(dumpPath), { recursive: true });
    fs.writeFileSync(dumpPath, JSON.stringify({
      model: modelStatus.currentModel,
      clickedDraft,
      chatSentFrame,
      finalResp
    }, null, 2), "utf-8");
    console.log(`[+] 完整抓包结果已持久化保存至: ${dumpPath}`);
  } catch (e: any) {
    console.error("等待响应超时或出错:", e.message);
  }

  process.exit(0);
}

main().catch(err => {
  console.error("执行出错:", err);
  process.exit(1);
});

