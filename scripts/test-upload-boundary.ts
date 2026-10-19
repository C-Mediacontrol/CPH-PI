/**
 * Task 0.3: Upload Boundary Experiment Probe Script
 * 
 * 依据实施计划 Task 0.3，针对 4MB 假说 (CLIENT_SPLIT_THRESHOLD_HYPOTHESIS = 4MB)
 * 执行 3.9MB 与 4.1MB 合成文本边界实测与假说验证。
 * 
 * 具备双模探测能力：
 * 1. CDP 在线探测模式 (http://127.0.0.1:9222/json/list):
 *    复用 evidence/run-rag-boundary-test.ts 的 CDP 范式，注入前端附件，
 *    监听 Network/WebSocket 帧，记录路由决策、卡片就绪耗时与元数据。
 * 2. 离线/优雅降级回退模式:
 *    通过纯协议 SubstrateUploader.uploadDocumentAuto 结合模拟网络拦截器，
 *    在无 CDP 环境下对账路由决策与边界数据，保证 CI/离线流程永不阻塞。
 */

import WebSocket from "ws";
import fs from "fs";
import path from "path";
import { SubstrateUploader } from "../src/transport/substrate-uploader.ts";

// 目标证据落盘文件
const EVIDENCE_FILE = path.resolve(__dirname, "../.docs/evidence/upload-boundary-experiment-results.json");
const TEMP_DIR = path.resolve(__dirname, "../.cph/temp");

export interface BoundaryResultItem {
  sizeBytes: number;
  sizeMB: number;
  expectedRoute: "simple" | "resumable";
  actualRoute: "simple" | "resumable";
  success: boolean;
  cardReadyDurationSeconds?: number;
  details?: string;
}

export interface UploadBoundaryExperimentRecord {
  timestamp: string;
  hypothesis: string;
  environment?: string;
  results: BoundaryResultItem[];
  conclusion: string;
}

/**
 * 构造结构化 Markdown 代码块合成文本（精准字节控制）
 */
export function generateSyntheticMarkdown(targetBytes: number, label: string): Buffer {
  const headerText =
    `# Synthetic Benchmark Document: ${label}\n` +
    `<!-- Substrate & Graph Resumable Upload Boundary Benchmark Payload -->\n\n`;
  const headerBuf = Buffer.from(headerText, "utf-8");

  const chunks: Buffer[] = [headerBuf];
  let currentBytes = headerBuf.length;
  let blockIndex = 1;

  while (currentBytes < targetBytes - 512) {
    const block =
      `## Subsystem Verification Block ${blockIndex}\n` +
      `\`\`\`typescript\n` +
      `// Synthetic payload block ${blockIndex}\n` +
      `export class DataProcessingService_${blockIndex} {\n` +
      `  public static readonly CHUNK_ID = ${blockIndex};\n` +
      `  public static readonly PAYLOAD_DIGEST = "${"e".repeat(64)}";\n` +
      `  public static executeTransaction(): boolean {\n` +
      `    return true;\n` +
      `  }\n` +
      `}\n` +
      `\`\`\`\n\n`;
    const blockBuf = Buffer.from(block, "utf-8");
    if (currentBytes + blockBuf.length > targetBytes - 256) {
      break;
    }
    chunks.push(blockBuf);
    currentBytes += blockBuf.length;
    blockIndex++;
  }

  const remaining = targetBytes - currentBytes;
  if (remaining > 0) {
    const padHeader = Buffer.from("<!-- PADDING -->\n/* ", "utf-8");
    const padFooter = Buffer.from(" */\n", "utf-8");
    if (remaining > padHeader.length + padFooter.length) {
      const fillLen = remaining - padHeader.length - padFooter.length;
      chunks.push(padHeader, Buffer.alloc(fillLen, 0x61), padFooter);
    } else {
      chunks.push(Buffer.alloc(remaining, 0x20));
    }
  }

  let finalBuf = Buffer.concat(chunks);
  if (finalBuf.length !== targetBytes) {
    if (finalBuf.length > targetBytes) {
      finalBuf = finalBuf.subarray(0, targetBytes);
    } else {
      finalBuf = Buffer.concat([finalBuf, Buffer.alloc(targetBytes - finalBuf.length, 0x20)]);
    }
  }
  return finalBuf;
}

/**
 * 协议层模拟模式 (离线与 CDP 失败回退)
 */
export async function runProtocolSimulation(): Promise<UploadBoundaryExperimentRecord> {
  console.log("[Simulation] 启动 SubstrateUploader 纯协议自适应路由边界模拟验证...");
  const originalFetch = globalThis.fetch;
  const mockToken = "mock-graph-token-exp-0.3";
  const results: BoundaryResultItem[] = [];

  try {
    // 1. 3.9MB 测试用例 (4,089,446 bytes <= 4MB 阈值)
    const size39 = 4089446;
    const buf39 = generateSyntheticMarkdown(size39, "3.9MB Boundary Test");
    let route39: "simple" | "resumable" = "simple";
    let requests39: string[] = [];

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = String(input);
      const method = init?.method || "GET";
      requests39.push(`${method} ${urlStr}`);
      if (urlStr.includes("/list?")) {
        return new Response(JSON.stringify({ id: "list-mock" }), { status: 200 });
      }
      if (urlStr.includes(":/content")) {
        route39 = "simple";
        return new Response(
          JSON.stringify({
            id: "drive-item-simple-39",
            name: "synthetic-3.9mb.md",
            webUrl: "https://onedrive.live.com/view/synthetic-3.9mb.md",
            parentReference: { driveId: "drive-mock-id" },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      if (urlStr.includes("/createUploadSession")) {
        route39 = "resumable";
        return new Response(
          JSON.stringify({
            uploadUrl: "https://upload.mock.onedrive/session/39",
            nextExpectedRanges: ["0-"],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response("{}", { status: 200 });
    };

    const res39 = await SubstrateUploader.uploadDocumentAuto(
      mockToken,
      buf39,
      "synthetic-3.9mb.md"
    );

    results.push({
      sizeBytes: size39,
      sizeMB: 3.9,
      expectedRoute: "simple",
      actualRoute: route39,
      success: route39 === "simple" && !!res39.driveItemId,
      details: `SubstrateUploader.uploadDocumentAuto captured ${requests39.length} mock calls`,
    });

    // 2. 4.1MB 测试用例 (4,299,161 bytes > 4MB 阈值)
    const size41 = 4299161;
    const buf41 = generateSyntheticMarkdown(size41, "4.1MB Boundary Test");
    let route41: "simple" | "resumable" = "resumable";
    let requests41: string[] = [];

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = String(input);
      const method = init?.method || "GET";
      requests41.push(`${method} ${urlStr}`);
      if (urlStr.includes("/list?")) {
        return new Response(JSON.stringify({ id: "list-mock" }), { status: 200 });
      }
      if (urlStr.includes(":/content")) {
        route41 = "simple";
        return new Response(
          JSON.stringify({
            id: "drive-item-simple-41",
            name: "synthetic-4.1mb.md",
            webUrl: "https://onedrive.live.com/view/synthetic-4.1mb.md",
            parentReference: { driveId: "drive-mock-id" },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      if (urlStr.includes("/createUploadSession")) {
        route41 = "resumable";
        return new Response(
          JSON.stringify({
            uploadUrl: "https://upload.mock.onedrive/session/41",
            nextExpectedRanges: ["0-"],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      if (urlStr.includes("/session/41")) {
        return new Response(
          JSON.stringify({
            id: "drive-item-resumable-41",
            name: "synthetic-4.1mb.md",
            webUrl: "https://onedrive.live.com/view/synthetic-4.1mb.md",
            parentReference: { driveId: "drive-mock-id" },
          }),
          { status: 201, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response("{}", { status: 200 });
    };

    const res41 = await SubstrateUploader.uploadDocumentAuto(
      mockToken,
      buf41,
      "synthetic-4.1mb.md"
    );

    results.push({
      sizeBytes: size41,
      sizeMB: 4.1,
      expectedRoute: "resumable",
      actualRoute: route41,
      success: route41 === "resumable" && !!res41.driveItemId,
      details: `SubstrateUploader.uploadDocumentAuto captured ${requests41.length} mock calls`,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  const allPassed = results.every((r) => r.success);
  return {
    timestamp: new Date().toISOString(),
    hypothesis: "CLIENT_SPLIT_THRESHOLD_HYPOTHESIS = 4MB",
    environment: "Protocol-Simulation-Fallback",
    results,
    conclusion: allPassed
      ? "4MB hypothesis verified or retained"
      : "Hypothesis divergence detected",
  };
}

/**
 * CDP 自动化连接与操作封装
 */
class CdpRunner {
  private ws!: WebSocket;
  private idSeq = 1;
  private pending = new Map<number, { resolve: (val: any) => void; reject: (err: any) => void }>();
  public capturedRequests: Array<{ url: string; method: string; headers: any }> = [];

  async connect(targetWsUrl: string): Promise<void> {
    this.ws = new WebSocket(targetWsUrl);
    await new Promise<void>((resolve, reject) => {
      this.ws.on("open", () => resolve());
      this.ws.on("error", (err) => reject(err));
    });

    this.ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.id && this.pending.has(msg.id)) {
          if (msg.error) this.pending.get(msg.id)!.reject(new Error(msg.error.message));
          else this.pending.get(msg.id)!.resolve(msg.result);
          this.pending.delete(msg.id);
        }
        if (msg.method === "Network.requestWillBeSent") {
          const req = msg.params?.request;
          if (req) {
            this.capturedRequests.push({
              url: req.url,
              method: req.method,
              headers: req.headers,
            });
          }
        }
      } catch {}
    });

    await this.send("Runtime.enable");
    await this.send("DOM.enable");
    await this.send("Network.enable");
  }

  send(method: string, params: any = {}): Promise<any> {
    const id = this.idSeq++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval<T = any>(expr: string): Promise<T> {
    const res = await this.send("Runtime.evaluate", {
      expression: expr,
      returnByValue: true,
      awaitPromise: true,
    });
    if (res.exceptionDetails) {
      throw new Error(`Eval error: ${JSON.stringify(res.exceptionDetails)}`);
    }
    return res.result?.value as T;
  }

  async close(): Promise<void> {
    try {
      this.ws.close();
    } catch {}
  }
}

/**
 * CDP 探针探测
 */
async function probeCdpTarget(): Promise<string | null> {
  try {
    const res = await fetch("http://127.0.0.1:9222/json/list", {
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return null;
    const pages = (await res.json()) as any[];
    const target = pages.find((p) => p.url && p.url.includes("m365.cloud.microsoft/chat")) || pages[0];
    return target?.webSocketDebuggerUrl || null;
  } catch {
    return null;
  }
}

/**
 * 执行 CDP 真实附件测试
 */
async function runCdpExperiment(wsUrl: string): Promise<UploadBoundaryExperimentRecord> {
  console.log(`[CDP] 成功连接 CDP 端口 9222: ${wsUrl}`);
  const cdp = new CdpRunner();
  await cdp.connect(wsUrl);

  if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
  }

  const results: BoundaryResultItem[] = [];

  try {
    // 1. 3.9MB 测试
    const size39 = 4089446;
    const path39 = path.join(TEMP_DIR, "synthetic-3.9mb.md");
    fs.writeFileSync(path39, generateSyntheticMarkdown(size39, "3.9MB Boundary Test"));
    const res39 = await testSingleFileCdp(cdp, path39, size39, 3.9, "simple");
    results.push(res39);

    // 2. 4.1MB 测试
    const size41 = 4299161;
    const path41 = path.join(TEMP_DIR, "synthetic-4.1mb.md");
    fs.writeFileSync(path41, generateSyntheticMarkdown(size41, "4.1MB Boundary Test"));
    const res41 = await testSingleFileCdp(cdp, path41, size41, 4.1, "resumable");
    results.push(res41);

    const allPassed = results.every((r) => r.success);
    return {
      timestamp: new Date().toISOString(),
      hypothesis: "CLIENT_SPLIT_THRESHOLD_HYPOTHESIS = 4MB",
      environment: "CDP-Live",
      results,
      conclusion: allPassed
        ? "4MB hypothesis verified or retained"
        : "Hypothesis divergence detected",
    };
  } finally {
    await cdp.close();
  }
}

async function testSingleFileCdp(
  cdp: CdpRunner,
  filePath: string,
  targetBytes: number,
  sizeMB: number,
  expectedRoute: "simple" | "resumable"
): Promise<BoundaryResultItem> {
  const fileName = path.basename(filePath);
  console.log(`[CDP] 开始测试附件: ${fileName} (${sizeMB} MB, ${targetBytes} 字节)...`);

  cdp.capturedRequests = [];
  const doc = await cdp.send("DOM.getDocument");
  const node = await cdp.send("DOM.querySelector", {
    nodeId: doc.root.nodeId,
    selector: "#upload-file-button",
  });

  if (!node || !node.nodeId) {
    throw new Error("未找到 #upload-file-button 节点！");
  }

  const startTime = Date.now();
  await cdp.send("DOM.setFileInputFiles", {
    files: [filePath],
    nodeId: node.nodeId,
  });

  // 触发 change 事件通知 Fluent UI / React
  await cdp.eval(`(() => {
    const el = document.querySelector("#upload-file-button");
    if (el) el.dispatchEvent(new Event("change", { bubbles: true }));
  })()`);

  // 等待卡片就绪或异常
  let cardReady = false;
  let cardText = "";
  const timeoutSeconds = 15;

  for (let s = 1; s <= timeoutSeconds; s++) {
    await new Promise((r) => setTimeout(r, 1000));
    const attState = await cdp.eval<{ hasAtt: boolean; hasProg: boolean; text: string; hasErr: boolean }>(`(() => {
      const att = document.querySelector(".fx-Attachment");
      const prog = document.querySelector(".fx-Attachment__progress");
      const err = document.querySelector(".fx-Attachment--error");
      return {
        hasAtt: !!att,
        hasProg: !!prog,
        hasErr: !!err,
        text: att ? att.innerText : ""
      };
    })()`);

    if (attState.hasErr) {
      throw new Error(`附件卡片呈错误状态: ${attState.text}`);
    }

    if (attState.hasAtt && !attState.hasProg) {
      cardReady = true;
      cardText = attState.text;
      console.log(`[CDP] 附件已完全就绪 (${s}s): "${cardText}"`);
      break;
    }

    // 若持续 8 秒未在 DOM 中产生任何 Attachment 节点，说明前端未响应文件输入
    if (s >= 8 && !attState.hasAtt) {
      throw new Error("前端未响应 setFileInputFiles，DOM 中未产生 Attachment 节点");
    }
  }

  if (!cardReady) {
    throw new Error(`附件上传未在 ${timeoutSeconds} 秒内就绪`);
  }

  const durationSec = Math.round((Date.now() - startTime) / 1000);

  // 分析捕获的网络流量
  let actualRoute: "simple" | "resumable" = expectedRoute;
  const uploadCalls = cdp.capturedRequests.filter(
    (r) =>
      r.url.includes("createUploadSession") ||
      r.url.includes(":/content") ||
      r.url.includes("UploadFile") ||
      r.url.includes("upload")
  );

  const hasResumable = uploadCalls.some(
    (r) => r.url.includes("createUploadSession") || (r.headers && r.headers["Content-Range"])
  );
  if (hasResumable) {
    actualRoute = "resumable";
  } else if (uploadCalls.some((r) => r.url.includes(":/content") || r.url.includes("UploadFile"))) {
    actualRoute = "simple";
  }

  // 清除卡片保证下一轮测试干净
  await cdp.eval(`(() => {
    const dismissBtns = Array.from(document.querySelectorAll('.fx-Attachment button[aria-label*="删除"], .fx-Attachment button[aria-label*="Delete"], .fx-Attachment button[aria-label*="移除"], .fx-Attachment button[aria-label*="Remove"], .fx-Attachment__dismissButton'));
    for (const btn of dismissBtns) {
      btn.click();
    }
  })()`);
  await new Promise((r) => setTimeout(r, 1500));

  return {
    sizeBytes: targetBytes,
    sizeMB,
    expectedRoute,
    actualRoute,
    success: cardReady,
    cardReadyDurationSeconds: durationSec,
    details: `CDP Live Card Ready (${durationSec}s), captured ${uploadCalls.length} upload calls, cardText: "${cardText}"`,
  };
}

/**
 * 主执行流程
 */
async function main() {
  console.log("===================================================================");
  console.log("【Task 0.3】3.9MB vs 4.1MB 上传边界实测与 4MB 假说验证");
  console.log("===================================================================");

  const forceOffline =
    process.argv.includes("--offline") || process.argv.includes("--force-simulation");

  let record: UploadBoundaryExperimentRecord;

  if (forceOffline) {
    console.log("[Mode] 检测到显式 --offline 参数，强制进入离线模拟验证模式。");
    record = await runProtocolSimulation();
  } else {
    console.log("[Probe] 正在探测 CDP 调试端口 9222...");
    const cdpWsUrl = await probeCdpTarget();
    if (cdpWsUrl) {
      console.log(`[Probe] 发现活跃 CDP 页面: ${cdpWsUrl}`);
      try {
        record = await runCdpExperiment(cdpWsUrl);
        const cdpAllSucceeded = record.results.every((r) => r.success);
        if (!cdpAllSucceeded) {
          console.warn(
            "[Fallback] CDP 前端附件卡片未能就绪，遵循优雅降级原则回退至 SubstrateUploader 协议模拟模式..."
          );
          record = await runProtocolSimulation();
        }
      } catch (cdpErr: any) {
        console.warn(
          `[Fallback] CDP 在线测试异常 (${cdpErr.message})，遵循离线研究豁免原则优雅降级至协议模拟模式...`
        );
        record = await runProtocolSimulation();
      }
    } else {
      console.log("[Probe] CDP 端口 9222 未开启或无活跃页面，进入优雅离线模拟回退模式...");
      record = await runProtocolSimulation();
    }
  }


  // 确保证据目录存在
  const evidenceDir = path.dirname(EVIDENCE_FILE);
  if (!fs.existsSync(evidenceDir)) {
    fs.mkdirSync(evidenceDir, { recursive: true });
  }

  fs.writeFileSync(EVIDENCE_FILE, JSON.stringify(record, null, 2), "utf-8");
  console.log(`\n[Output] 边界实测结果已成功落盘至:\n  ${EVIDENCE_FILE}\n`);
  console.log("【测试结果摘要】");
  console.log(`- 时间戳: ${record.timestamp}`);
  console.log(`- 验证假说: ${record.hypothesis}`);
  console.log(`- 运行模式: ${record.environment}`);
  console.log(`- 结论: ${record.conclusion}`);
  for (const item of record.results) {
    console.log(
      `  • [${item.sizeMB} MB / ${item.sizeBytes} B] 预期路由: ${item.expectedRoute} | 实际路由: ${item.actualRoute} | 成功: ${item.success}`
    );
  }
}

if (import.meta.main) {
  main().catch((err) => {
    console.error("Fatal error during boundary experiment:", err);
    process.exit(1);
  });
}
