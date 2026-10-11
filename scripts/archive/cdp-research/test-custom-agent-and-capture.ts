import { CdpClient } from "../../copilot-web proxy/src/cdp/cdp-client.ts";
import { CopilotPage } from "../../copilot-web proxy/src/cdp/copilot-page.ts";
import fs from "node:fs";
import path from "node:path";

async function main() {
  const targetResp = await fetch("http://127.0.0.1:9222/json/list");
  const targets = (await targetResp.json()) as any[];
  const agentTarget = targets.find((t) => t.type === "page" && t.url.includes("chat/agent/"));

  if (!agentTarget) {
    console.error("未找到专属 Agent 页面！");
    process.exit(1);
  }

  console.log(`[+] 命中专属 Agent 页面: "${agentTarget.title}"`);
  console.log(`[+] URL: ${agentTarget.url}`);

  const client = new CdpClient(agentTarget.webSocketDebuggerUrl);
  await client.connect();
  const page = new CopilotPage(client);
  await page.init();

  console.log("[1] 开启 CDP Network 全局拦截监听...");
  await client.send("Network.enable");

  const capturedWsUrls: string[] = [];
  const capturedWsSentFrames: any[] = [];
  const capturedWsRecvFrames: any[] = [];
  const capturedHttpReqs: any[] = [];

  client.on("Network.webSocketCreated", (params) => {
    console.log(`[WS 连接创建] ${params.url}`);
    capturedWsUrls.push(params.url);
  });

  client.on("Network.webSocketFrameSent", (params) => {
    try {
      const raw = params.response.payloadData;
      capturedWsSentFrames.push({ time: new Date().toISOString(), raw });
      const frames = raw.split("\x1e").filter(Boolean);
      for (const f of frames) {
        const parsed = JSON.parse(f);
        if (parsed.target === "chat") {
          console.log("\n=======================================================");
          console.log("【捕获到专属 Agent 的 Chat 发送帧 arguments[0]】:");
          console.log(JSON.stringify(parsed.arguments?.[0], null, 2));
          console.log("=======================================================\n");
        }
      }
    } catch {}
  });

  client.on("Network.webSocketFrameReceived", (params) => {
    try {
      const raw = params.response.payloadData;
      capturedWsRecvFrames.push({ time: new Date().toISOString(), raw });
    } catch {}
  });

  client.on("Network.requestWillBeSent", (params) => {
    const u = params.request.url;
    if (u.includes("agent") || u.includes("chathub") || u.includes("conversation") || u.includes("substrate")) {
      capturedHttpReqs.push({
        url: u,
        method: params.request.method,
        headers: params.request.headers,
        postData: params.request.postData
      });
    }
  });

  console.log("[2] 探测当前专属 Agent 页面状态...");
  const agentInfo = await client.evaluate<any>(`
    (() => {
      const titleEl = document.querySelector("h1, h2, [role='heading']");
      const subHeader = document.querySelector("header, [data-testid='agent-header']");
      return {
        headerText: titleEl ? titleEl.innerText : "无独立标题",
        pageTitle: document.title,
        url: window.location.href
      };
    })()
  `);
  console.log("Agent 页面状态:", agentInfo);

  console.log("[3] 输入测试文本给专属 Agent 并发送...");
  const testInput = "你好！请按照你的系统协议，执行探测本地工作区 git 状态的操作。";
  await page.setInputText(testInput);
  await new Promise((r) => setTimeout(r, 600));

  console.log("[4] 点击发送按钮...");
  await page.clickSend();

  console.log("[5] 等待专属 Agent 响应 (最长 45s)...");
  try {
    const responseText = await page.waitForResponse(45000, 1000);
    console.log("\n=======================================================");
    console.log("【专属 Agent 真实回复】:");
    console.log(responseText);
    console.log("=======================================================\n");

    const outData = {
      agentUrl: agentTarget.url,
      agentInfo,
      capturedWsUrls,
      capturedHttpReqs: capturedHttpReqs.slice(0, 20),
      capturedWsSentCount: capturedWsSentFrames.length,
      chatSentFrames: capturedWsSentFrames.filter(x => x.raw.includes('"target":"chat"')),
      responseText
    };

    const outPath = path.resolve("CPH-PI/.docs/notes/custom-agent-traffic.json");
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(outData, null, 2), "utf-8");
    console.log(`[+] 抓包与分析数据已完整保存至: ${outPath}`);
  } catch (err: any) {
    console.error("等待响应超时或出错:", err.message);
  }

  process.exit(0);
}

main().catch(err => {
  console.error("运行出错:", err);
  process.exit(1);
});

