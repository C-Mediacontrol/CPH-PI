import { CdpClient } from "../../copilot-web proxy/src/cdp/cdp-client.ts";

async function main() {
  console.log("🔍 [Probe] Reading blob contents via CDP...");
  const target = await CdpClient.findTarget(9222);
  const client = new CdpClient(target.webSocketDebuggerUrl!);
  await client.connect();

  const result = await client.evaluate(`
    (async () => {
      const links = Array.from(document.querySelectorAll('a[download]')).map(a => ({
        filename: a.getAttribute('download'),
        text: a.innerText.trim(),
        href: a.href
      }));

      const files = [];
      for (const link of links) {
        try {
          const res = await fetch(link.href);
          const content = await res.text();
          files.push({
            filename: link.filename,
            href: link.href,
            contentLength: content.length,
            preview: content.slice(0, 300)
          });
        } catch (err) {
          files.push({
            filename: link.filename,
            href: link.href,
            error: String(err)
          });
        }
      }
      return files;
    })()
  `);

  console.log("📦 [Probe] Blob Files Extracted:\n", JSON.stringify(result, null, 2));
  client.close();
}

main().catch(err => {
  console.error("❌ [Probe] Error:", err);
  process.exit(1);
});

