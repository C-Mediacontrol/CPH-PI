import fs from "node:fs";
import path from "node:path";
import WebSocket from "ws";

const STATE_DIR = path.resolve(__dirname, "..", ".cph", "state");
fs.mkdirSync(STATE_DIR, { recursive: true });

const JSONL_LOG = path.join(STATE_DIR, "sniffed-agent-updates.jsonl");
const MD_LOG = path.join(STATE_DIR, "sniffed-agent-updates.md");

// Clear or initialize markdown log
fs.writeFileSync(
  MD_LOG,
  `# M365 Agent 更新网络捕获日志 (CDP 9222 Sniffer)\n\n*启动时间: ${new Date().toISOString()}*\n\n---\n\n`,
  "utf8"
);

console.log("🕵️ [CDP Sniffer] 启动高灵敏度网络抓包探针...");
console.log(`📁 原始 JSONL: ${JSONL_LOG}`);
console.log(`📑 可读 Markdown: ${MD_LOG}`);

interface CapturedEntry {
  timestamp: string;
  targetId: string;
  targetTitle: string;
  targetUrl: string;
  requestId: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  postData?: string;
  responseStatus?: number;
  responseHeaders?: Record<string, string>;
  responseBody?: string;
}

const activeSockets = new Map<string, WebSocket>();
const activeRequests = new Map<string, CapturedEntry>();

function appendMdLog(entry: CapturedEntry) {
  const md = `### [${entry.timestamp}] ${entry.method} ${entry.url}
- **Target Page**: [${entry.targetTitle}](${entry.targetUrl})
- **Status**: \`${entry.responseStatus || "PENDING"}\`
- **Headers**:
\`\`\`json
${JSON.stringify(entry.headers, null, 2)}
\`\`\`
${
  entry.postData
    ? `- **Request Payload (Payload / Body)**:
\`\`\`${entry.postData.startsWith("{") ? "json" : "text"}
${entry.postData}
\`\`\`\n`
    : ""
}
${
  entry.responseBody
    ? `- **Response Body**:
\`\`\`${entry.responseBody.startsWith("{") ? "json" : "text"}
${entry.responseBody.slice(0, 5000)}${entry.responseBody.length > 5000 ? "\n... (truncated)" : ""}
\`\`\`\n`
    : ""
}
---
`;
  fs.appendFileSync(MD_LOG, md, "utf8");
}

function logEntry(entry: CapturedEntry) {
  const line = JSON.stringify(entry) + "\n";
  fs.appendFileSync(JSONL_LOG, line, "utf8");
  appendMdLog(entry);
}

async function attachToTarget(target: any) {
  if (activeSockets.has(target.id)) return;
  if (!target.webSocketDebuggerUrl) return;

  console.log(`🔌 [CDP Sniffer] 附加到页面: [${target.type}] ${target.title || "Untitled"} (${target.url})`);
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  activeSockets.set(target.id, ws);

  let msgId = 1;
  const send = (method: string, params: any = {}) => {
    try {
      ws.send(JSON.stringify({ id: msgId++, method, params }));
    } catch {}
  };

  ws.on("open", () => {
    send("Network.enable", { maxPostDataSize: 20 * 1024 * 1024 });
  });

  ws.on("message", async (data) => {
    try {
      const msg = JSON.parse(data.toString());
      const method = msg.method;
      const params = msg.params;

      if (method === "Network.requestWillBeSent") {
        const req = params.request;
        const url = req.url || "";
        const m = req.method;

        // Capture all modifying requests, or any request touching agent/bot/gpt/skill/manifest/tool
        const isModifying = m === "POST" || m === "PUT" || m === "PATCH" || m === "DELETE";
        const hasKeyword =
          url.includes("agent") ||
          url.includes("bot") ||
          url.includes("skill") ||
          url.includes("prompt") ||
          url.includes("instruction") ||
          url.includes("gpt") ||
          url.includes("manifest") ||
          url.includes("knowledge") ||
          url.includes("action") ||
          url.includes("tool") ||
          url.includes("api/v1") ||
          url.includes("sharepoint") ||
          url.includes("graph");

        // Filter out static assets or telemetry noise unless modifying
        const isNoise =
          url.includes("telemetry") ||
          url.includes("browser.pipe.aria.microsoft.com") ||
          url.includes("events.data.microsoft.com") ||
          url.includes("/collector/") ||
          url.includes(".png") ||
          url.includes(".jpg") ||
          url.includes(".woff2") ||
          url.includes(".css");

        if ((isModifying || hasKeyword) && !isNoise) {
          const entry: CapturedEntry = {
            timestamp: new Date().toISOString(),
            targetId: target.id,
            targetTitle: target.title || "Untitled",
            targetUrl: target.url || "",
            requestId: params.requestId,
            url: req.url,
            method: req.method,
            headers: req.headers,
            postData: req.postData,
          };
          activeRequests.set(params.requestId, entry);

          console.log(`\n🚨 [SNIFF REQ] [${req.method}] ${req.url}`);
          if (req.postData) {
            console.log(`   📦 Payload Snippet: ${req.postData.slice(0, 300)}...`);
          }
        }
      } else if (method === "Network.responseReceived") {
        const res = params.response;
        const saved = activeRequests.get(params.requestId);
        if (saved) {
          saved.responseStatus = res.status;
          saved.responseHeaders = res.headers;
          console.log(`   📥 [SNIFF RES] [${res.status}] for ${saved.url}`);

          // Request response body
          const curMsgId = msgId++;
          const handler = (rData: any) => {
            try {
              const rMsg = JSON.parse(rData.toString());
              if (rMsg.id === curMsgId) {
                ws.off("message", handler);
                if (rMsg.result?.body) {
                  saved.responseBody = rMsg.result.body;
                }
                logEntry(saved);
                activeRequests.delete(params.requestId);
              }
            } catch {}
          };
          ws.on("message", handler);
          ws.send(JSON.stringify({
            id: curMsgId,
            method: "Network.getResponseBody",
            params: { requestId: params.requestId }
          }));

          // Safety timeout for body fetch
          setTimeout(() => {
            if (activeRequests.has(params.requestId)) {
              logEntry(saved);
              activeRequests.delete(params.requestId);
            }
          }, 3000);
        }
      }
    } catch {}
  });

  ws.on("close", () => {
    activeSockets.delete(target.id);
  });

  ws.on("error", () => {
    activeSockets.delete(target.id);
  });
}

async function pollTargets() {
  try {
    const res = await fetch("http://127.0.0.1:9222/json/list");
    const targets = (await res.json()) as any[];
    for (const t of targets) {
      if (t.type === "page" || t.type === "iframe" || t.type === "other") {
        await attachToTarget(t);
      }
    }
  } catch (err: any) {
    // console.warn("Target poll error:", err.message);
  }
}

// Initial attach and recurring poll for new tabs
setInterval(pollTargets, 1500);
pollTargets();

console.log("\n=======================================================");
console.log("✔ [CDP Sniffer] 监听已全面开启！");
console.log("   请在浏览器中执行：");
console.log("   1. 修改并更新提示词");
console.log("   2. 上传 Skill 并点击更新");
console.log("   3. 删除 Skill 并点击更新");
console.log("=======================================================\n");
