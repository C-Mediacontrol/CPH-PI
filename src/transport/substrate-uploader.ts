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
  private static spoBase64Cache = new Map<string, string>();

  /**
   * Resolve SPO base64 metadata (siteId,webId,listId) for LocalFile annotation
   */
  public static async resolveSpoBase64(graphAccessToken: string): Promise<string> {
    if (this.spoBase64Cache.has(graphAccessToken)) {
      return this.spoBase64Cache.get(graphAccessToken)!;
    }

    try {
      const res = await fetch(
        "https://graph.microsoft.com/v1.0/me/drive/list?$select=id,name,parentReference",
        {
          headers: { Authorization: `Bearer ${graphAccessToken}` },
        }
      );
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
   * Upload large tool output or repository code bundle to OneDrive for Business via Graph API
   */
  public static async uploadDocumentToOneDrive(
    graphAccessToken: string,
    content: string,
    fileName: string,
    customBaseUrl?: string
  ): Promise<UploadDocumentResult> {
    const encodedName = encodeURIComponent(fileName);
    const rootUrl = customBaseUrl || this.DEFAULT_GRAPH_URL;
    const url = customBaseUrl
      ? `${customBaseUrl}/${encodedName}:/content`
      : `${rootUrl}:/${encodedName}:/content`;

    const res = await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${graphAccessToken}`,
        "Content-Type": "text/plain; charset=utf-8",
        Prefer: "ExtractTextOnCommit, pacToken=N",
        SdkVersion: "graph-js/3.0.7 (featureUsage=7)",
      },
      body: content,
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Graph OneDrive upload failed (${res.status}): ${err.slice(0, 200)}`);
    }

    const data = (await res.json()) as {
      id: string;
      webUrl: string;
      name?: string;
      parentReference?: { driveId?: string };
    };

    const finalName = data.name || fileName;
    const driveId = data.parentReference?.driveId || "";
    const ext = finalName.split(".").pop() || "txt";

    const spoBase64 = await this.resolveSpoBase64(graphAccessToken);
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
}

