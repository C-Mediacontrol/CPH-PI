import { CdpClient } from "../../copilot-web proxy/src/cdp/cdp-client.ts";

async function main() {
  console.log("🔍 [Probe] Inspecting exact DOM elements and dataset of download links...");
  const target = await CdpClient.findTarget(9222);
  const client = new CdpClient(target.webSocketDebuggerUrl!);
  await client.connect();

  const details = await client.evaluate(`
    (() => {
      const links = Array.from(document.querySelectorAll('a[download]'));
      return links.map(a => {
        const parent = a.closest('[data-content], [role="listitem"], .fui-ChatMessage') || a.parentElement;
        return {
          filename: a.getAttribute('download'),
          href: a.href,
          text: a.innerText,
          classes: a.className,
          attributes: Array.from(a.attributes).map(attr => ({ name: attr.name, value: attr.value })),
          parentTag: parent ? parent.tagName : null,
          parentClasses: parent ? parent.className : null,
          parentDataContent: parent ? parent.getAttribute('data-content') : null
        };
      });
    })()
  `);

  console.log("📋 [Probe] Detailed Link Metadata:\n", JSON.stringify(details, null, 2));

  // Also check file upload attachment buttons in the input area
  const uploadArea = await client.evaluate(`
    (() => {
      const fileInputs = Array.from(document.querySelectorAll('input[type="file"]')).map(inp => ({
        id: inp.id,
        accept: inp.accept,
        multiple: inp.multiple,
        className: inp.className
      }));

      const attachBtns = Array.from(document.querySelectorAll('button[aria-label*="添加"], button[aria-label*="附件"], button[aria-label*="Attach"], button[aria-label*="上传"], button[aria-label*="Add"]')).map(b => ({
        text: b.innerText,
        ariaLabel: b.getAttribute('aria-label'),
        title: b.getAttribute('title'),
        className: b.className
      }));

      return { fileInputs, attachBtns };
    })()
  `);

  console.log("📎 [Probe] Attachment / Upload Capabilities in UI:\n", JSON.stringify(uploadArea, null, 2));

  client.close();
}

main().catch(err => {
  console.error("❌ [Probe] Error:", err);
  process.exit(1);
});

