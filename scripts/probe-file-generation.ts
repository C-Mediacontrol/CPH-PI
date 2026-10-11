import { CdpClient } from "../../copilot-web proxy/src/cdp/cdp-client.ts";
import { CopilotPage } from "../../copilot-web proxy/src/cdp/copilot-page.ts";

async function main() {
  console.log("🔍 [Probe] Connecting to Chrome CDP at port 9222...");
  const target = await CdpClient.findTarget(9222);
  console.log(`🎯 [Probe] Found Copilot target: "${target.title}" (${target.url})`);

  const client = new CdpClient(target.webSocketDebuggerUrl!);
  await client.connect();
  console.log("✅ [Probe] CDP connected!");

  // Listen to Network domain
  await client.send("Network.enable");
  
  const capturedDownloads: any[] = [];
  const capturedWsFrames: any[] = [];

  client.on("Network.requestWillBeSent", (params) => {
    const url = params.request?.url || "";
    if (url.includes("Download") || url.includes("substrate") || url.includes("sharepoint") || url.includes("blob:")) {
      console.log(`🌐 [Network Request] ${params.request.method} ${url.slice(0, 150)}`);
      capturedDownloads.push({ type: "request", url, headers: params.request.headers });
    }
  });

  client.on("Network.webSocketFrameReceived", (params) => {
    try {
      const payload = params.response?.payloadData || "";
      if (payload.includes("download") || payload.includes("file") || payload.includes("FileBase64") || payload.includes("docId")) {
        capturedWsFrames.push(payload.slice(0, 500));
      }
    } catch {}
  });

  const page = new CopilotPage(client);
  await page.init();

  const ui = await page.inspectUI();
  console.log("📊 [Probe] Initial UI State:", ui);

  // Send test prompt requesting multiple files with download links
  const testPrompt = "请帮我生成两个独立的代码文件：1. 名为 test_math.py 的 Python 工具库，包含加法和乘法函数；2. 名为 test_readme.md 的说明文档。请直接以文件形式生成并提供下载链接。";

  console.log(`📝 [Probe] Injecting prompt: "${testPrompt}"`);
  await page.setInputText(testPrompt);
  await new Promise(r => setTimeout(r, 1000));

  console.log("🚀 [Probe] Clicking Send button...");
  await page.clickSend();

  console.log("⏳ [Probe] Waiting for Copilot response to complete (up to 90s)...");
  const response = await page.waitForResponse(90000, 1500);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("📥 [Probe] Copilot Response Text:\n", response);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  // Inspect page for download links, cards, buttons, anchors
  const domInspection = await client.evaluate(`
    (() => {
      // 1. All links
      const allLinks = Array.from(document.querySelectorAll('a')).map(a => ({
        tag: 'a',
        text: a.innerText.trim(),
        href: a.href,
        download: a.getAttribute('download'),
        target: a.target,
        classes: a.className,
        parentTag: a.parentElement ? a.parentElement.tagName : null
      }));

      // 2. Specific file / card elements
      const cards = Array.from(document.querySelectorAll('[data-content*="card"], [class*="card"], [class*="file"], [class*="attachment"], [aria-label*="文件"], [aria-label*="下载"], [aria-label*="Download"]')).map(el => ({
        tagName: el.tagName,
        ariaLabel: el.getAttribute('aria-label'),
        innerText: el.innerText.slice(0, 200),
        className: el.className
      }));

      // 3. Buttons that might be download/export buttons
      const buttons = Array.from(document.querySelectorAll('button')).map(b => ({
        text: b.innerText.trim(),
        ariaLabel: b.getAttribute('aria-label'),
        title: b.getAttribute('title')
      })).filter(b => (b.ariaLabel || '').includes('下载') || (b.ariaLabel || '').includes('Download') || (b.text || '').includes('下载') || (b.text || '').includes('导出'));

      return {
        allLinksCount: allLinks.length,
        potentialDownloadLinks: allLinks.filter(l => l.href.includes('download') || l.href.includes('blob:') || l.href.includes('sharepoint') || l.href.includes('substrate') || l.download || (l.text || '').includes('下载') || (l.text || '').includes('.py') || (l.text || '').includes('.md')),
        fileCards: cards.slice(0, 15),
        downloadButtons: buttons
      };
    })()
  `);

  console.log("🔎 [Probe] DOM Inspection Results:\n", JSON.stringify(domInspection, null, 2));

  if (capturedDownloads.length > 0) {
    console.log("📦 [Probe] Captured Download Network Requests:\n", JSON.stringify(capturedDownloads, null, 2));
  }

  client.close();
}

main().catch(err => {
  console.error("❌ [Probe] Error:", err);
  process.exit(1);
});

