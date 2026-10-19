import WebSocket from "ws";
import fs from "fs";
import path from "path";

const scratchDir = "C:/Users/UserX/.gemini/antigravity/brain/0b20df21-fbb3-44d9-8755-4fcf809df57a/scratch";
const snapshotPath = path.join(scratchDir, "rag-experiment-snapshot.txt");
const resultsPath = path.join(scratchDir, "rag-boundary-experiment-results.json");

class CdpRunner {
  private ws!: WebSocket;
  private idSeq = 1;
  private pending = new Map<number, { resolve: (val: any) => void; reject: (err: any) => void }>();

  async connect() {
    const listRes = await fetch("http://127.0.0.1:9222/json/list");
    const pages = (await listRes.json()) as any[];
    const target = pages.find((p) => p.url.includes("m365.cloud.microsoft/chat")) || pages[0];
    if (!target) throw new Error("No Copilot page found on port 9222!");

    console.log(`Connecting to: ${target.title} (${target.url})`);
    this.ws = new WebSocket(target.webSocketDebuggerUrl);

    await new Promise<void>((resolve, reject) => {
      this.ws.on("open", () => resolve());
      this.ws.on("error", (err) => reject(err));
    });

    this.ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.id && this.pending.has(msg.id)) {
        this.pending.get(msg.id)!.resolve(msg.result);
        this.pending.delete(msg.id);
      }
    });

    await this.send("Runtime.enable");
    await this.send("DOM.enable");
    await this.send("Page.enable");
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

  async close() {
    this.ws.close();
  }
}

async function ensureModel(cdp: CdpRunner, targetModel = "GPT-6.1 Sol") {
  console.log(`[Model] 检查当前模型选择器状态...`);
  const status = await cdp.eval<{ hasBtn: boolean; text: string; aria: string }>(`
    (() => {
      const btn = document.getElementById("gptModeSwitcher") || Array.from(document.querySelectorAll("button")).find(x => 
        (x.getAttribute("aria-label") || "").includes("模型选择器")
      );
      return {
        hasBtn: !!btn,
        text: btn ? btn.innerText.trim() : "",
        aria: btn ? btn.getAttribute("aria-label") || "" : ""
      };
    })()
  `);

  console.log(`[Model] 当前按钮显示: "${status.text}" (aria: "${status.aria}")`);
  if (status.text.includes(targetModel) || status.aria.includes(targetModel)) {
    console.log(`[Model] 当前已处于 ${targetModel}，无需切换。`);
    return;
  }

  console.log(`[Model] 切换至 ${targetModel}...`);
  // 1. Click main button
  await cdp.eval(`
    (() => {
      const btn = document.getElementById("gptModeSwitcher");
      if (btn) btn.click();
    })()
  `);
  await new Promise(r => setTimeout(r, 600));

  // 2. Click GPT menu item
  const gptBox = await cdp.eval<{ x: number; y: number } | null>(`
    (() => {
      const gpt = document.querySelector('[data-testid="gptSubMenuModelTrigger-OpenAI"]');
      if (!gpt) return null;
      const rect = gpt.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    })()
  `);

  if (gptBox) {
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: gptBox.x, y: gptBox.y });
    await new Promise(r => setTimeout(r, 200));
    await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: gptBox.x, y: gptBox.y, button: "left", clickCount: 1 });
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: gptBox.x, y: gptBox.y, button: "left", clickCount: 1 });
  }
  await new Promise(r => setTimeout(r, 600));

  // 3. Find targetModel item and click
  const targetBox = await cdp.eval<{ x: number; y: number } | null>(`
    ((target) => {
      const items = Array.from(document.querySelectorAll('[role="menuitem"], [role="menuitemradio"], .fui-MenuItem'));
      const match = items.find(it => (it.innerText || '').includes(target));
      if (!match) return null;
      const rect = match.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    })(${JSON.stringify(targetModel)})
  `);

  if (!targetBox) throw new Error(`未找到目标模型菜单项: ${targetModel}`);

  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: targetBox.x, y: targetBox.y, button: "left", clickCount: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: targetBox.x, y: targetBox.y, button: "left", clickCount: 1 });
  await new Promise(r => setTimeout(r, 1000));

  // Final check
  const finalStatus = await cdp.eval<string>(`
    (() => {
      const btn = document.getElementById("gptModeSwitcher");
      return btn ? btn.innerText.trim() : "";
    })()
  `);
  console.log(`[Model] 切换完成，当前模型: "${finalStatus}"`);
}

async function clickNewTopic(cdp: CdpRunner) {
  console.log("[Topic] 点击新建聊天...");
  await cdp.eval(`
    (() => {
      const selectors = [
        'a[aria-label="新建聊天"]',
        'button[aria-label*="新建主题"]',
        'button[aria-label*="新建聊天"]',
        'button[aria-label*="New topic"]',
        'button[aria-label*="New chat"]'
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el) {
          el.click();
          return true;
        }
      }
      return false;
    })()
  `);
  await new Promise(r => setTimeout(r, 2000));
  await ensureModel(cdp, "GPT-6.1 Sol");
}

async function uploadFile(cdp: CdpRunner, filePath: string) {
  console.log(`[Upload] 挂载附件: ${filePath} (${(fs.statSync(filePath).size / (1024 * 1024)).toFixed(2)} MB)...`);
  const doc = await cdp.send("DOM.getDocument");
  const nodeRes = await cdp.send("DOM.querySelector", {
    nodeId: doc.root.nodeId,
    selector: "#upload-file-button",
  });

  if (!nodeRes || !nodeRes.nodeId) throw new Error("未找到 #upload-file-button 节点！");

  await cdp.send("DOM.setFileInputFiles", {
    files: [filePath],
    nodeId: nodeRes.nodeId,
  });

  console.log("[Upload] 等待 OneDrive 上传及卡片就绪...");
  let uploadDone = false;
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const state = await cdp.eval<{ hasAtt: boolean; hasProg: boolean; text: string }>(`
      (() => {
        const att = document.querySelector(".fx-Attachment");
        const prog = document.querySelector(".fx-Attachment__progress");
        return {
          hasAtt: !!att,
          hasProg: !!prog,
          text: att ? att.innerText : ""
        };
      })()
    `);
    if (state.hasAtt && !state.hasProg) {
      console.log(`[Upload] 附件已完全就绪: "${state.text}" (耗时约 ${i + 1}s)`);
      uploadDone = true;
      break;
    }
  }

  if (!uploadDone) {
    throw new Error("附件上传超时未就绪！");
  }
}

async function setInputAndSend(cdp: CdpRunner, prompt: string) {
  console.log(`[Send] 注入提示词 (${prompt.length} 字符)...`);
  // Focus Lexical Editor
  await cdp.eval(`
    (() => {
      const editor = document.getElementById("m365-chat-editor-target-element");
      if (editor) {
        editor.focus();
        const sel = window.getSelection();
        if (sel) sel.selectAllChildren(editor);
      }
    })()
  `);

  await cdp.send("Input.insertText", { text: prompt });

  await cdp.eval(`
    (() => {
      const editor = document.getElementById("m365-chat-editor-target-element");
      if (editor) {
        editor.dispatchEvent(new Event("input", { bubbles: true }));
        editor.dispatchEvent(new Event("change", { bubbles: true }));
      }
    })()
  `);

  await new Promise(r => setTimeout(r, 500));

  console.log("[Send] 点击发送按钮...");
  const sent = await cdp.eval<boolean>(`
    (() => {
      const sendBtnSelectors = [
        'button[aria-label="发送"]',
        'button[aria-label*="发送"]',
        'button[aria-label*="提交"]',
        'button[aria-label*="Submit"]',
        'button[aria-label*="Send"]',
        'button[type="submit"]'
      ];
      for (const sel of sendBtnSelectors) {
        const el = document.querySelector(sel);
        if (el && !el.disabled) {
          el.click();
          return true;
        }
      }
      return false;
    })()
  `);

  if (!sent) {
    console.log("[Send] 发送按钮不可用，触发 Enter 键提交...");
    await cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", windowsVirtualKeyCode: 13, text: "\r", unmodifiedText: "\r" });
    await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", windowsVirtualKeyCode: 13, text: "\r", unmodifiedText: "\r" });
  }
}

async function waitForResponse(cdp: CdpRunner, timeoutMs = 120000): Promise<string> {
  console.log("[Wait] 等待模型响应流结束...");
  const startTime = Date.now();

  const initialSnap = await cdp.eval<{ count: number; lastText: string }>(`
    (() => {
      const full = document.body.innerText || "";
      const parts = full.split(/Copilot (?:said|说):?/i);
      const count = parts.length;
      let lastText = "";
      if (count > 1) {
        lastText = parts[count - 1].split(/You said:?/i)[0].trim();
      }
      return { count, lastText };
    })()
  `);

  let lastContent = "";
  let stableCount = 0;
  let seenNew = false;

  while (Date.now() - startTime < timeoutMs) {
    await new Promise(r => setTimeout(r, 1000));

    const status = await cdp.eval<{ isGenerating: boolean; count: number; latestText: string }>(`
      (() => {
        const stopBtn = document.querySelector('button[aria-label*="停止"], button[aria-label*="Stop"]');
        const isGenerating = !!stopBtn;

        const full = document.body.innerText || "";
        const parts = full.split(/Copilot (?:said|说):?/i);
        const count = parts.length;
        let latestText = "";
        if (count > 1) {
          latestText = parts[count - 1].split(/You said:?/i)[0].trim();
        }

        return { isGenerating, count, latestText };
      })()
    `);

    if (status.count > initialSnap.count || (status.latestText && status.latestText !== initialSnap.lastText)) {
      seenNew = true;
    }

    if (seenNew && status.latestText) {
      if (status.latestText === lastContent) {
        stableCount++;
      } else {
        stableCount = 0;
        lastContent = status.latestText;
        process.stdout.write(`.`);
      }

      if (!status.isGenerating && stableCount >= 3 && lastContent.length > 0) {
        console.log(`\n[Wait] 响应接收完成 (总耗时: ${((Date.now() - startTime) / 1000).toFixed(1)}s)`);
        return lastContent;
      }
    }
  }

  if (lastContent.length > 0) return lastContent;
  throw new Error(`等待模型响应超时 (${timeoutMs}ms)`);
}

async function main() {
  const cdp = new CdpRunner();
  await cdp.connect();

  const results: any = {
    testTime: new Date().toISOString(),
    snapshotSize: fs.statSync(snapshotPath).size,
    model: "GPT-6.1 Sol",
    phases: []
  };

  try {
    // 1. Reset topic
    await clickNewTopic(cdp);

    // 2. Upload snapshot
    await uploadFile(cdp, snapshotPath);

    // 3. Phase 1: Multi-Hop Cross-File Semantic Reasoning (Zero Keyword Leak)
    console.log("\n=======================================================");
    console.log("【实验阶段 1】多跳跨文件隐式因果推演压力测试 (Zero Keyword Leak)");
    console.log("=======================================================");
    const promptPhase1 = `在上传的代码快照中，请分析如下业务调用场景：
业务代码调用 PaymentGatewayService 的 settleInvoice 方法，并将 orgTier 参数传入 "ENTERPRISE_CUSTOM_TIER_99"。
请追踪从该方法开始的代码下游完整执行链路，明确回答：该调用在底层最终会抛出什么具体的异常类名以及完整的异常代码字符串？
请给出完整的推演调用链路和代码依据。`;

    await setInputAndSend(cdp, promptPhase1);
    const respPhase1 = await waitForResponse(cdp, 120000);

    const hitPhase1Needle = respPhase1.includes("CRITICAL_FAULT_ZERO_TRUST_QUORUM_LOST_0x992B");
    const hitPhase1Hop2 = respPhase1.includes("DispatcherRegistry") || respPhase1.includes("forwardTransaction");
    const hitPhase1Hop3 = respPhase1.includes("KernelSecurityGuard") || respPhase1.includes("SecurityPolicyViolationException");

    results.phases.push({
      phase: 1,
      name: "Multi-Hop Cross-File Semantic Reasoning",
      prompt: promptPhase1,
      response: respPhase1,
      analysis: {
        hitTerminalNeedle: hitPhase1Needle,
        hitHop2Dispatcher: hitPhase1Hop2,
        hitHop3SecurityGuard: hitPhase1Hop3,
      }
    });

    console.log("\n[阶段 1 响应内容]:\n" + respPhase1);
    console.log("\n[阶段 1 关键指标对账]:");
    console.log(`- 是否召回 Hop 2 (DispatcherRegistry): ${hitPhase1Hop2}`);
    console.log(`- 是否召回 Hop 3 (KernelSecurityGuard): ${hitPhase1Hop3}`);
    console.log(`- 是否推演出终态金针异常 (CRITICAL_FAULT_ZERO_TRUST_QUORUM_LOST_0x992B): ${hitPhase1Needle}`);

    // 4. Phase 2: Direct Lexical Baseline (Single Hop, Explicit Keyword)
    console.log("\n=======================================================");
    console.log("【实验阶段 2】单跳显式关键词基准召回测试 (Direct Lexical Baseline)");
    console.log("=======================================================");
    const promptPhase2 = `请直接检索附件中 KernelSecurityGuard.enforceComplianceProfile 在遇到 "POL_ALPHA_772" 时，具体抛出的异常类名和异常代码字符串是什么？请直接给出。`;

    await setInputAndSend(cdp, promptPhase2);
    const respPhase2 = await waitForResponse(cdp, 90000);

    const hitPhase2Needle = respPhase2.includes("CRITICAL_FAULT_ZERO_TRUST_QUORUM_LOST_0x992B");

    results.phases.push({
      phase: 2,
      name: "Direct Lexical Baseline",
      prompt: promptPhase2,
      response: respPhase2,
      analysis: {
        hitTerminalNeedle: hitPhase2Needle,
      }
    });

    console.log("\n[阶段 2 响应内容]:\n" + respPhase2);
    console.log("\n[阶段 2 关键指标对账]:");
    console.log(`- 是否成功精准召回金针异常: ${hitPhase2Needle}`);

    fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2), "utf8");
    console.log(`\n全部实验结果已写入: ${resultsPath}`);

  } finally {
    await cdp.close();
  }
}

main().catch(err => {
  console.error("Experiment failed with error:", err);
  process.exit(1);
});
