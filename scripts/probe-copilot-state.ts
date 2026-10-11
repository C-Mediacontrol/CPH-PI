import { CdpClient } from "../../copilot-web proxy/src/cdp/cdp-client.ts";
import { CopilotPage } from "../../copilot-web proxy/src/cdp/copilot-page.ts";

async function main() {
  console.log("🔍 [Probe] Connecting to Chrome CDP at port 9222...");
  const target = await CdpClient.findTarget(9222);
  console.log(`🎯 [Probe] Found Copilot target: "${target.title}" (${target.url})`);

  const client = new CdpClient(target.webSocketDebuggerUrl!);
  await client.connect();
  console.log("✅ [Probe] CDP WebSocket connected!");

  const page = new CopilotPage(client);
  await page.init();

  const ui = await page.inspectUI();
  console.log("📊 [Probe] UI State:", JSON.stringify(ui, null, 2));

  // Inspect existing messages and any download links / file attachments
  const pageInspection = await client.evaluate(`
    (() => {
      // 1. Find all messages or response blocks
      const messages = Array.from(document.querySelectorAll('[data-content="message-body"], .fui-ChatMessage, [role="listitem"]')).map(el => el.innerText.slice(0, 150));
      
      // 2. Find any download links or file cards
      const links = Array.from(document.querySelectorAll('a[href]')).map(a => ({
        href: a.href,
        text: a.innerText.trim(),
        download: a.getAttribute('download') || null,
        ariaLabel: a.getAttribute('aria-label') || null
      })).filter(l => l.href.includes('download') || l.href.includes('blob:') || l.href.includes('substrate') || l.href.includes('sharepoint') || l.download);

      // 3. Find any buttons related to download/export
      const buttons = Array.from(document.querySelectorAll('button')).map(b => ({
        text: b.innerText.trim(),
        ariaLabel: b.getAttribute('aria-label') || null,
        title: b.getAttribute('title') || null
      })).filter(b => (b.ariaLabel || '').includes('下载') || (b.ariaLabel || '').includes('Download') || (b.text || '').includes('下载') || (b.text || '').includes('导出'));

      return {
        messageCount: messages.length,
        recentMessages: messages.slice(-3),
        downloadLinks: links,
        downloadButtons: buttons
      };
    })()
  `);

  console.log("🔎 [Probe] Existing page details:", JSON.stringify(pageInspection, null, 2));
  client.close();
}

main().catch(err => {
  console.error("❌ [Probe] Error:", err);
  process.exit(1);
});

