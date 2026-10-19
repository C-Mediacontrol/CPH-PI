import type { AttachmentAnnotation } from "./types.ts";

export interface UploadOptions {
  fileName: string;
  mimeType?: string;
  conversationId: string;
  uploadUrl?: string;
}

export interface UploadDocumentResult {
  driveItemId: string;
  webUrl: string;
  driveId?: string;
  fileName: string;
  annotation: AttachmentAnnotation;
}

export class SubstrateUploader {
  public static DEFAULT_UPLOAD_URL = "https://substrate.office.com/m365Copilot/UploadFile";
  public static DEFAULT_GRAPH_URL = "https://graph.microsoft.com/v1.0/me/drive/special/copilotuploads";

  public static CLIENT_SPLIT_THRESHOLD_HYPOTHESIS = 4 * 1024 * 1024; // 4MB 经验假说区间 (待边界实验验证)
  public static CHUNK_SIZE = 8192000; // 8,000 KB (严格 320 KiB 整数倍)
  public static MAX_CHUNK_ATTEMPTS = 5; // 单分块最大尝试次数
  public static MAX_SIMPLE_ATTEMPTS = 5; // 简易上传最大尝试次数

  private static spoBase64Cache = new Map<string, string>();

  /**
   * 可中断退避等待辅助函数：监听 signal abort 事件并立即中止清理定时器
   */
  public static sleepInterruptible(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        const err = new Error("Operation aborted");
        err.name = "AbortError";
        return reject(err);
      }
      let timer: any = null;
      const onAbort = () => {
        if (timer) clearTimeout(timer);
        if (signal) signal.removeEventListener("abort", onAbort);
        const err = new Error("Operation aborted");
        err.name = "AbortError";
        reject(err);
      };
      if (signal) {
        signal.addEventListener("abort", onAbort);
      }
      timer = setTimeout(() => {
        if (signal) signal.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
    });
  }

  /**
   * Resolve SPO base64 metadata (siteId,webId,listId) for LocalFile annotation
   */
  public static async resolveSpoBase64(
    graphAccessToken: string,
    customBaseUrl?: string
  ): Promise<string> {
    if (this.spoBase64Cache.has(graphAccessToken)) {
      return this.spoBase64Cache.get(graphAccessToken)!;
    }

    try {
      const listUrl = customBaseUrl
        ? `${customBaseUrl}/list?$select=id,name,parentReference`
        : "https://graph.microsoft.com/v1.0/me/drive/list?$select=id,name,parentReference";
      const res = await fetch(listUrl, {
        headers: { Authorization: `Bearer ${graphAccessToken}` },
        signal: AbortSignal.timeout(2000),
      });
      if (res.ok) {
        const listData = (await res.json()) as any;
        const listId = listData.id;
        const siteRef = listData.parentReference?.siteId || "";
        const parts = siteRef.split(",");
        const siteId = parts[1];
        const webId = parts[2];
        if (siteId && webId && listId) {
          const encoded = Buffer.from(`${siteId},${webId},${listId}`).toString("base64");
          this.spoBase64Cache.set(graphAccessToken, encoded);
          return encoded;
        }
      }
    } catch {
      // Graceful fallback if list query fails
    }
    return "";
  }

  /**
   * Upload an image or visual context directly to Office Substrate
   */
  public static async uploadImage(
    accessToken: string,
    imageBytes: Buffer,
    options: UploadOptions
  ): Promise<AttachmentAnnotation> {
    const mime = options.mimeType || "image/png";
    const dataUrl = `data:${mime};base64,${imageBytes.toString("base64")}`;

    const form = new URLSearchParams();
    form.set("scenario", "UploadImage");
    form.set("conversationId", options.conversationId);
    form.set("FileBase64", dataUrl);
    form.append("optionsSets", "cwcgptvsan");
    form.append("optionsSets", "flux_v3_gptv_enable_upload_multi_image_in_turn_wo_ch");

    const uploadUrl = options.uploadUrl || this.DEFAULT_UPLOAD_URL;

    const res = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        "X-Variants": "feature.EnableClientFileURLSupportForOfficeWebPaidCopilot",
        "X-Scenario": "OfficeWebIncludedCopilot",
        Origin: "https://m365.cloud.microsoft",
        Referer: "https://m365.cloud.microsoft/",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      },
      body: form.toString(),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Substrate upload failed (${res.status}): ${err.slice(0, 200)}`);
    }

    const data = (await res.json()) as {
      docId: string;
      fileName?: string;
      fileType?: string;
      result?: { value: string };
    };

    if (!data.docId || data.result?.value !== "Success") {
      throw new Error(`Substrate upload failed: docId missing or status not Success`);
    }

    return {
      id: data.docId,
      messageAnnotationMetadata: {
        "@type": "File",
        annotationType: "File",
        fileType: (data.fileType || "png").replace(/^\./, ""),
        fileName: data.fileName || options.fileName,
      },
      messageAnnotationType: "ImageFile",
    };
  }

  /**
   * 从 DriveItem 响应及 SPO Base64 组装 AttachmentAnnotation 与 UploadDocumentResult
   */
  private static async assembleUploadResult(
    graphAccessToken: string,
    data: any,
    fileName: string,
    customBaseUrl?: string
  ): Promise<UploadDocumentResult> {
    const finalName = data.name || fileName;
    const driveId = data.parentReference?.driveId || "";
    const ext = finalName.split(".").pop() || "txt";

    const spoBase64 = await this.resolveSpoBase64(graphAccessToken, customBaseUrl);
    const annotationId = spoBase64 ? `SPO_${spoBase64}_${data.id}` : data.id;

    const annotation: AttachmentAnnotation = {
      id: annotationId,
      text: finalName,
      url: data.webUrl,
      messageAnnotationType: "LocalFile",
      messageAnnotationMetadata: {
        "@type": "File",
        annotationType: "File",
        fileName: finalName,
        webUrl: data.webUrl,
        driveId,
        fileType: ext,
      },
    };

    return {
      driveItemId: data.id,
      webUrl: data.webUrl,
      driveId,
      fileName: finalName,
      annotation,
    };
  }

  /**
   * 简易 PUT :/content 直传 (适用于 ≤ 4MB)
   * 支持指数退避重试循环、429/503 Retry-After 解析与 4xx 立即熔断
   */
  public static async uploadSimple(
    graphAccessToken: string,
    content: Buffer | string,
    fileName: string,
    signal?: AbortSignal,
    customBaseUrl?: string
  ): Promise<UploadDocumentResult> {
    const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf-8");
    const encodedName = encodeURIComponent(fileName);
    const rootUrl =
      customBaseUrl && customBaseUrl.startsWith("http")
        ? customBaseUrl
        : this.DEFAULT_GRAPH_URL;
    const url =
      customBaseUrl && customBaseUrl.startsWith("http")
        ? `${customBaseUrl}/${encodedName}:/content`
        : `${rootUrl}:/${encodedName}:/content`;

    let attempts = 0;
    while (true) {
      if (signal?.aborted) {
        const err = new Error("Upload aborted by caller");
        err.name = "AbortError";
        throw err;
      }
      attempts++;

      let res: Response;
      try {
        res = await fetch(url, {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${graphAccessToken}`,
            "Content-Type": "text/plain; charset=utf-8",
            Prefer: "ExtractTextOnCommit, pacToken=N",
            SdkVersion: "graph-js/3.0.7 (featureUsage=7)",
          },
          body: buffer,
          signal,
        });
      } catch (err: any) {
        if (signal?.aborted || err.name === "AbortError") throw err;
        if (attempts >= this.MAX_SIMPLE_ATTEMPTS) throw err;
        await this.sleepInterruptible(attempts * 2000, signal);
        continue;
      }

      // 处理 429 限流与 503 暂时不可用：解析 Retry-After 标头
      if (res.status === 429 || res.status === 503) {
        if (attempts >= this.MAX_SIMPLE_ATTEMPTS) {
          throw new Error(
            `Simple upload hit rate limit / service unavailable and exceeded max retry limit (${this.MAX_SIMPLE_ATTEMPTS})`
          );
        }
        let retrySec = 5;
        const headerVal = res.headers.get("Retry-After");
        if (headerVal) {
          const parsedInt = parseInt(headerVal, 10);
          if (!isNaN(parsedInt)) {
            retrySec = Math.max(parsedInt, 0);
          } else {
            const parsedDate = Date.parse(headerVal);
            if (!isNaN(parsedDate)) {
              retrySec = Math.max(Math.ceil((parsedDate - Date.now()) / 1000), 0);
            }
          }
        }
        await this.sleepInterruptible(Math.min(retrySec, 60) * 1000, signal);
        continue;
      }

      // 4xx 立即熔断机制（I16/P2）：遇到 400, 401, 403 等不可恢复客户端或鉴权错误时，绝对不重试，立即上抛异常
      if (res.status >= 400 && res.status < 500) {
        const errText = await res.text().catch(() => "");
        throw new Error(`Graph simple upload failed (${res.status}): ${errText.slice(0, 200)}`);
      }

      // 5xx 服务端错误：退避重试
      if (res.status >= 500) {
        if (attempts >= this.MAX_SIMPLE_ATTEMPTS) {
          const errText = await res.text().catch(() => "");
          throw new Error(`Graph simple upload failed (${res.status}): ${errText.slice(0, 200)}`);
        }
        await this.sleepInterruptible(attempts * 2000, signal);
        continue;
      }

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(`Graph simple upload failed (${res.status}): ${errText.slice(0, 200)}`);
      }

      const data = (await res.json()) as any;
      return await this.assembleUploadResult(graphAccessToken, data, fileName, customBaseUrl);
    }
  }

  /**
   * 工业级断点续传状态机 (> 4MB)
   * 采用 createUploadSession + 8,000 KB (320 KiB 整数倍) 分块流转，具备 4xx 快速失败与可中断退避
   */
  public static async uploadResumable(
    graphAccessToken: string,
    buffer: Buffer,
    fileName: string,
    signal?: AbortSignal,
    customBaseUrl?: string
  ): Promise<UploadDocumentResult> {
    const totalBytes = buffer.length;
    const encodedName = encodeURIComponent(fileName);
    const rootUrl =
      customBaseUrl && customBaseUrl.startsWith("http")
        ? customBaseUrl
        : this.DEFAULT_GRAPH_URL;

    // 步骤 1: 创建 UploadSession (获取预授权 uploadUrl)
    const sessionUrl =
      customBaseUrl && customBaseUrl.startsWith("http")
        ? `${customBaseUrl}/${encodedName}:/createUploadSession`
        : `${rootUrl}:/${encodedName}:/createUploadSession`;

    let sessionRes: Response;
    try {
      sessionRes = await fetch(sessionUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${graphAccessToken}`,
          "Content-Type": "application/json",
          Prefer: "ExtractTextOnCommit, pacToken=N",
        },
        body: JSON.stringify({
          item: {
            "@microsoft.graph.conflictBehavior": "replace",
            name: fileName,
          },
        }),
        signal,
      });
    } catch (err: any) {
      if (signal?.aborted || err.name === "AbortError") throw err;
      throw err;
    }

    if (!sessionRes.ok) {
      const errText = await sessionRes.text().catch(() => "");
      throw new Error(`Create upload session failed (${sessionRes.status}): ${errText.slice(0, 200)}`);
    }

    const sessionData = (await sessionRes.json()) as any;
    const uploadUrl = sessionData.uploadUrl;
    if (!uploadUrl) {
      throw new Error("Create upload session succeeded but no uploadUrl returned");
    }

    let nextRanges: string[] = sessionData.nextExpectedRanges || ["0-"];
    let driveItemData: any = null;

    // 步骤 2: 由服务端 nextExpectedRanges 驱动分块循环
    while (nextRanges.length > 0 && !driveItemData) {
      if (signal?.aborted) {
        const err = new Error("Upload aborted by caller");
        err.name = "AbortError";
        throw err;
      }

      const match = nextRanges[0].match(/^(\d+)-/);
      if (!match) {
        throw new Error(`Invalid nextExpectedRanges format: ${JSON.stringify(nextRanges)}`);
      }
      const offset = parseInt(match[1], 10);
      if (offset >= totalBytes) break;

      const end = Math.min(offset + this.CHUNK_SIZE, totalBytes);
      const chunk = buffer.subarray(offset, end);

      let attempts = 0;
      let chunkSuccess = false;

      while (!chunkSuccess) {
        if (signal?.aborted) {
          const err = new Error("Upload aborted by caller");
          err.name = "AbortError";
          throw err;
        }
        attempts++;
        if (attempts > this.MAX_CHUNK_ATTEMPTS) {
          throw new Error(`Chunk PUT at offset ${offset} exceeded max retry limit (${this.MAX_CHUNK_ATTEMPTS})`);
        }

        let putRes: Response;
        try {
          putRes = await fetch(uploadUrl, {
            method: "PUT",
            headers: {
              "Content-Range": `bytes ${offset}-${end - 1}/${totalBytes}`,
              "Content-Length": String(chunk.length),
              Prefer: "ExtractTextOnCommit",
              SdkVersion: "graph-js/3.0.7 (featureUsage=7)",
            },
            body: chunk,
            signal,
          });
        } catch (err: any) {
          if (signal?.aborted || err.name === "AbortError") throw err;
          if (attempts >= this.MAX_CHUNK_ATTEMPTS) throw err;
          await this.sleepInterruptible(attempts * 2000, signal);
          continue;
        }

        // 处理 429 限流与 503 暂时不可用
        if (putRes.status === 429 || putRes.status === 503) {
          let retrySec = 5;
          const headerVal = putRes.headers.get("Retry-After");
          if (headerVal) {
            const parsedInt = parseInt(headerVal, 10);
            if (!isNaN(parsedInt)) {
              retrySec = Math.max(parsedInt, 0);
            } else {
              const parsedDate = Date.parse(headerVal);
              if (!isNaN(parsedDate)) {
                retrySec = Math.max(Math.ceil((parsedDate - Date.now()) / 1000), 0);
              }
            }
          }
          await this.sleepInterruptible(Math.min(retrySec, 60) * 1000, signal);
          continue;
        }

        // 4xx 立即熔断：400, 401, 403 等不可恢复客户端错误绝不重试
        if (putRes.status >= 400 && putRes.status < 500) {
          const errText = await putRes.text().catch(() => "");
          throw new Error(`Chunk PUT failed with client error (${putRes.status}): ${errText.slice(0, 200)}`);
        }

        // 5xx 服务端错误：退避重试
        if (putRes.status >= 500) {
          if (attempts >= this.MAX_CHUNK_ATTEMPTS) {
            const errText = await putRes.text().catch(() => "");
            throw new Error(`Chunk PUT failed (${putRes.status}): ${errText.slice(0, 200)}`);
          }
          await this.sleepInterruptible(attempts * 2000, signal);
          continue;
        }

        // 步骤 3: 状态流转
        if (putRes.status === 202) {
          const resJson = (await putRes.json()) as any;
          nextRanges = resJson.nextExpectedRanges || [`${end}-`];
          chunkSuccess = true;
        } else if (putRes.status === 201 || putRes.status === 200) {
          driveItemData = (await putRes.json()) as any;
          nextRanges = [];
          chunkSuccess = true;
        } else {
          const errText = await putRes.text().catch(() => "");
          throw new Error(`Chunk PUT failed (${putRes.status}): ${errText.slice(0, 200)}`);
        }
      }
    }

    if (!driveItemData || !driveItemData.id) {
      throw new Error("Resumable upload completed without DriveItem metadata returned.");
    }

    return await this.assembleUploadResult(graphAccessToken, driveItemData, fileName, customBaseUrl);
  }

  /**
   * 纯协议自适应上传：自动根据体积策略路由至简易直传或断点分块
   */
  public static async uploadDocumentAuto(
    graphAccessToken: string,
    content: Buffer | string,
    fileName: string,
    signal?: AbortSignal,
    customBaseUrl?: string
  ): Promise<UploadDocumentResult> {
    const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf-8");
    if (buffer.byteLength <= this.CLIENT_SPLIT_THRESHOLD_HYPOTHESIS) {
      return await this.uploadSimple(graphAccessToken, buffer, fileName, signal, customBaseUrl);
    }
    return await this.uploadResumable(graphAccessToken, buffer, fileName, signal, customBaseUrl);
  }

  /**
   * 向后兼容调用点别名 (无缝适配存量 3 参 / 4 参调用及模型参数错序容错)
   */
  public static async uploadDocumentToOneDrive(
    graphAccessToken: string,
    content: string | Buffer,
    fileName: string,
    customBaseUrlOrSignal?: string | AbortSignal
  ): Promise<UploadDocumentResult> {
    let actualContent = content;
    let actualFileName = fileName;
    // 保留历史启发式容错：当模型将长正文填入 fileName 时自动互换
    if (
      typeof content === "string" &&
      (content.endsWith(".md") || content.endsWith(".txt") || content.startsWith("handoff-")) &&
      !content.includes("\n") &&
      (fileName.includes("\n") || fileName.length > 255)
    ) {
      actualContent = fileName;
      actualFileName = content;
    }

    const signal = customBaseUrlOrSignal instanceof AbortSignal ? customBaseUrlOrSignal : undefined;
    const customBaseUrl = typeof customBaseUrlOrSignal === "string" ? customBaseUrlOrSignal : undefined;

    return await this.uploadDocumentAuto(
      graphAccessToken,
      actualContent,
      actualFileName,
      signal,
      customBaseUrl
    );
  }
}
