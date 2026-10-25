import WebSocket from "ws";
import fs from "node:fs";
import path from "node:path";

async function screenshot() {
  const ws = new WebSocket("ws://127.0.0.1:9222/devtools/page/55B32AD7AC038CF9B5DDDC5B228EE25E");
  ws.on("open", () => {
    ws.send(JSON.stringify({
      id: 1,
      method: "Page.captureScreenshot",
      params: { format: "png" }
    }));
  });
  ws.on("message", (d) => {
    const res = JSON.parse(d.toString());
    if (res.result?.data) {
      const buf = Buffer.from(res.result.data, "base64");
      const outPath = path.join(__dirname, "login-screen.png");
      fs.writeFileSync(outPath, buf);
      console.log("Screenshot saved to:", outPath);
    }
    ws.close();
    process.exit(0);
  });
}

screenshot();

