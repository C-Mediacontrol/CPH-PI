import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { SubstrateUploader } from "../../src/transport/substrate-uploader.ts";

describe("SubstrateUploader Pure Protocol Resumable & Hardened Simple Uploader", () => {
  const originalFetch = globalThis.fetch;
  const mockToken = "mock_graph_token";

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("1. sleepInterruptible & AbortSignal", () => {
    it("should resolve normally when not aborted", async () => {
      const start = Date.now();
      await SubstrateUploader.sleepInterruptible(20);
      expect(Date.now() - start).toBeGreaterThanOrEqual(15);
    });

    it("should reject immediately if signal is already aborted", async () => {
      const controller = new AbortController();
      controller.abort();

      let caughtErr: any = null;
      try {
        await SubstrateUploader.sleepInterruptible(1000, controller.signal);
      } catch (err: any) {
        caughtErr = err;
      }

      expect(caughtErr).toBeDefined();
      expect(caughtErr.name).toBe("AbortError");
    });

    it("should interrupt and reject when signal aborts during sleep", async () => {
      const controller = new AbortController();
      const sleepPromise = SubstrateUploader.sleepInterruptible(1000, controller.signal);

      setTimeout(() => controller.abort(), 20);

      let caughtErr: any = null;
      try {
        await sleepPromise;
      } catch (err: any) {
        caughtErr = err;
      }

      expect(caughtErr).toBeDefined();
      expect(caughtErr.name).toBe("AbortError");
    });
  });

  describe("2. uploadSimple Hardening & 4xx Fail-Fast", () => {
    it("should upload simple file successfully (200 OK)", async () => {
      let callCount = 0;
      globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        callCount++;
        const urlStr = String(input);
        if (urlStr.includes("/list?")) {
          return new Response(
            JSON.stringify({
              id: "list-1",
              parentReference: { siteId: "contoso.sharepoint.com,site-1,web-1" },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }

        expect(init?.method).toBe("PUT");
        expect(init?.headers).toMatchObject({
          Authorization: `Bearer ${mockToken}`,
          "Content-Type": "text/plain; charset=utf-8",
        });
        return new Response(
          JSON.stringify({
            id: "drive-item-simple-1",
            webUrl: "https://contoso.sharepoint.com/simple.txt",
            name: "simple.txt",
            parentReference: { driveId: "drive-1" },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      };

      const result = await SubstrateUploader.uploadSimple(
        mockToken,
        Buffer.from("Hello simple world"),
        "simple.txt"
      );

      expect(result.driveItemId).toBe("drive-item-simple-1");
      expect(result.fileName).toBe("simple.txt");
      expect(result.annotation.id).toContain("drive-item-simple-1");
      expect(result.annotation.messageAnnotationType).toBe("LocalFile");
      expect(callCount).toBeGreaterThanOrEqual(1);
    });

    it("should retry on 429 with integer Retry-After and succeed on 2nd attempt", async () => {
      let attempts = 0;
      globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        const urlStr = String(input);
        if (urlStr.includes("/list?")) {
          return new Response(JSON.stringify({ id: "list-1" }), { status: 200 });
        }

        attempts++;
        if (attempts === 1) {
          return new Response("Too Many Requests", {
            status: 429,
            headers: { "Retry-After": "1" },
          });
        }
        return new Response(
          JSON.stringify({
            id: "drive-item-429",
            webUrl: "https://contoso.sharepoint.com/429.txt",
            name: "429.txt",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      };

      const result = await SubstrateUploader.uploadSimple(
        mockToken,
        "content retry",
        "429.txt"
      );

      expect(attempts).toBe(2);
      expect(result.driveItemId).toBe("drive-item-429");
    });

    it("should retry on 429 with HTTP-Date Retry-After header", async () => {
      let attempts = 0;
      const futureDate = new Date(Date.now() + 1000).toUTCString();

      globalThis.fetch = async (input: RequestInfo | URL) => {
        const urlStr = String(input);
        if (urlStr.includes("/list?")) {
          return new Response(JSON.stringify({ id: "list-1" }), { status: 200 });
        }

        attempts++;
        if (attempts === 1) {
          return new Response("Too Many Requests", {
            status: 429,
            headers: { "Retry-After": futureDate },
          });
        }
        return new Response(
          JSON.stringify({
            id: "drive-item-date",
            webUrl: "https://contoso.sharepoint.com/date.txt",
            name: "date.txt",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      };

      const result = await SubstrateUploader.uploadSimple(
        mockToken,
        "content date retry",
        "date.txt"
      );

      expect(attempts).toBe(2);
      expect(result.driveItemId).toBe("drive-item-date");
    });

    it("should FAIL-FAST immediately on 401 Unauthorized without retrying (only 1 attempt)", async () => {
      let putCount = 0;
      globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        const urlStr = String(input);
        if (urlStr.includes("/list?")) {
          return new Response(JSON.stringify({ id: "list-1" }), { status: 200 });
        }
        putCount++;
        return new Response("Unauthorized Token Expired", { status: 401 });
      };

      let caughtErr: any = null;
      try {
        await SubstrateUploader.uploadSimple(
          mockToken,
          "secret content",
          "unauth.txt"
        );
      } catch (err: any) {
        caughtErr = err;
      }

      expect(caughtErr).toBeDefined();
      expect(caughtErr.message).toContain("401");
      expect(putCount).toBe(1); // Crucial: must NOT retry on 401
    });

    it("should FAIL-FAST immediately on 400 Bad Request or 403 Forbidden without retrying", async () => {
      let putCount = 0;
      globalThis.fetch = async (input: RequestInfo | URL) => {
        const urlStr = String(input);
        if (urlStr.includes("/list?")) {
          return new Response(JSON.stringify({ id: "list-1" }), { status: 200 });
        }
        putCount++;
        return new Response("Forbidden Access Denied", { status: 403 });
      };

      let caughtErr: any = null;
      try {
        await SubstrateUploader.uploadSimple(
          mockToken,
          "content",
          "forbidden.txt"
        );
      } catch (err: any) {
        caughtErr = err;
      }

      expect(caughtErr).toBeDefined();
      expect(caughtErr.message).toContain("403");
      expect(putCount).toBe(1); // No retry
    });

    it("should fail when exceeding MAX_SIMPLE_ATTEMPTS on persistent 503", async () => {
      let putCount = 0;
      globalThis.fetch = async (input: RequestInfo | URL) => {
        const urlStr = String(input);
        if (urlStr.includes("/list?")) {
          return new Response(JSON.stringify({ id: "list-1" }), { status: 200 });
        }
        putCount++;
        return new Response("Service Unavailable", {
          status: 503,
          headers: { "Retry-After": "0" },
        });
      };

      let caughtErr: any = null;
      try {
        await SubstrateUploader.uploadSimple(mockToken, "content", "503.txt");
      } catch (err: any) {
        caughtErr = err;
      }

      expect(caughtErr).toBeDefined();
      expect(putCount).toBe(SubstrateUploader.MAX_SIMPLE_ATTEMPTS);
    });
  });

  describe("3. uploadResumable Chunked Upload State Machine", () => {
    it("should create upload session and upload 2 chunks using nextExpectedRanges", async () => {
      const chunkSize = SubstrateUploader.CHUNK_SIZE;
      const totalBytes = chunkSize + 1024; // 2 chunks total
      const dummyBuffer = Buffer.alloc(totalBytes, 0x41); // 'A'

      let sessionCreated = false;
      const chunksReceived: Array<{ range: string; length: number }> = [];

      globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        const urlStr = String(input);
        if (urlStr.includes("/list?")) {
          return new Response(
            JSON.stringify({
              id: "list-chunk",
              parentReference: { siteId: "contoso.sharepoint.com,site-c,web-c" },
            }),
            { status: 200 }
          );
        }

        if (urlStr.includes("/createUploadSession")) {
          sessionCreated = true;
          expect(init?.method).toBe("POST");
          expect(init?.headers).toMatchObject({
            Authorization: `Bearer ${mockToken}`,
            "Content-Type": "application/json",
          });
          const body = JSON.parse(String(init?.body));
          expect(body.item.name).toBe("large-file.bin");

          return new Response(
            JSON.stringify({
              uploadUrl: "https://contoso.sharepoint.com/upload-session-endpoint",
              nextExpectedRanges: ["0-"],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }

        if (urlStr === "https://contoso.sharepoint.com/upload-session-endpoint") {
          expect(init?.method).toBe("PUT");
          const headers = init?.headers as Record<string, string>;
          const range = headers["Content-Range"] || "";
          const chunkData = init?.body as Buffer;
          chunksReceived.push({ range, length: chunkData.length });

          if (chunksReceived.length === 1) {
            // First chunk: bytes 0-(chunkSize-1)/totalBytes
            expect(range).toBe(`bytes 0-${chunkSize - 1}/${totalBytes}`);
            return new Response(
              JSON.stringify({
                nextExpectedRanges: [`${chunkSize}-`],
              }),
              { status: 202, headers: { "Content-Type": "application/json" } }
            );
          } else {
            // Second chunk: bytes chunkSize-(totalBytes-1)/totalBytes
            expect(range).toBe(`bytes ${chunkSize}-${totalBytes - 1}/${totalBytes}`);
            return new Response(
              JSON.stringify({
                id: "drive-item-resumable-done",
                webUrl: "https://contoso.sharepoint.com/large-file.bin",
                name: "large-file.bin",
                parentReference: { driveId: "drive-chunk-1" },
              }),
              { status: 201, headers: { "Content-Type": "application/json" } }
            );
          }
        }

        return new Response("Not found", { status: 404 });
      };

      const result = await SubstrateUploader.uploadResumable(
        mockToken,
        dummyBuffer,
        "large-file.bin"
      );

      expect(sessionCreated).toBe(true);
      expect(chunksReceived.length).toBe(2);
      expect(result.driveItemId).toBe("drive-item-resumable-done");
      expect(result.fileName).toBe("large-file.bin");
      expect(result.driveId).toBe("drive-chunk-1");
      expect(result.annotation.id).toContain("drive-item-resumable-done");
    });

    it("should FAIL-FAST immediately if createUploadSession returns 401/403", async () => {
      let sessionAttempts = 0;
      globalThis.fetch = async (input: RequestInfo | URL) => {
        const urlStr = String(input);
        if (urlStr.includes("/createUploadSession")) {
          sessionAttempts++;
          return new Response("Unauthorized Session", { status: 401 });
        }
        return new Response("Not found", { status: 404 });
      };

      let caughtErr: any = null;
      try {
        await SubstrateUploader.uploadResumable(
          mockToken,
          Buffer.alloc(SubstrateUploader.CHUNK_SIZE + 100),
          "session-fail.bin"
        );
      } catch (err: any) {
        caughtErr = err;
      }

      expect(caughtErr).toBeDefined();
      expect(caughtErr.message).toContain("401");
      expect(sessionAttempts).toBe(1);
    });

    it("should FAIL-FAST immediately on chunk PUT 401/403 without retrying that chunk", async () => {
      let chunkPuts = 0;
      globalThis.fetch = async (input: RequestInfo | URL) => {
        const urlStr = String(input);
        if (urlStr.includes("/createUploadSession")) {
          return new Response(
            JSON.stringify({
              uploadUrl: "https://contoso.sharepoint.com/upload-session-endpoint",
              nextExpectedRanges: ["0-"],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        if (urlStr.includes("upload-session-endpoint")) {
          chunkPuts++;
          return new Response("Access Denied on Chunk", { status: 403 });
        }
        return new Response("Not found", { status: 404 });
      };

      let caughtErr: any = null;
      try {
        await SubstrateUploader.uploadResumable(
          mockToken,
          Buffer.alloc(SubstrateUploader.CHUNK_SIZE + 100),
          "chunk-403.bin"
        );
      } catch (err: any) {
        caughtErr = err;
      }

      expect(caughtErr).toBeDefined();
      expect(caughtErr.message).toContain("403");
      expect(chunkPuts).toBe(1); // Did not retry chunk
    });

    it("should retry chunk on 429 and succeed on next attempt", async () => {
      let chunkPuts = 0;
      globalThis.fetch = async (input: RequestInfo | URL) => {
        const urlStr = String(input);
        if (urlStr.includes("/createUploadSession")) {
          return new Response(
            JSON.stringify({
              uploadUrl: "https://contoso.sharepoint.com/upload-session-endpoint",
              nextExpectedRanges: ["0-"],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        if (urlStr.includes("upload-session-endpoint")) {
          chunkPuts++;
          if (chunkPuts === 1) {
            return new Response("Too Many Requests", {
              status: 429,
              headers: { "Retry-After": "0" },
            });
          }
          return new Response(
            JSON.stringify({
              id: "item-retry-ok",
              webUrl: "https://contoso.sharepoint.com/retry-ok.bin",
              name: "retry-ok.bin",
            }),
            { status: 201, headers: { "Content-Type": "application/json" } }
          );
        }
        return new Response("{}", { status: 200 });
      };

      const result = await SubstrateUploader.uploadResumable(
        mockToken,
        Buffer.alloc(SubstrateUploader.CHUNK_SIZE + 100),
        "retry-ok.bin"
      );

      expect(chunkPuts).toBe(2);
      expect(result.driveItemId).toBe("item-retry-ok");
    });

    it("should abort uploadResumable immediately if signal is aborted", async () => {
      const controller = new AbortController();
      controller.abort();

      let caughtErr: any = null;
      try {
        await SubstrateUploader.uploadResumable(
          mockToken,
          Buffer.alloc(SubstrateUploader.CHUNK_SIZE + 100),
          "aborted.bin",
          controller.signal
        );
      } catch (err: any) {
        caughtErr = err;
      }

      expect(caughtErr).toBeDefined();
      expect(caughtErr.name).toBe("AbortError");
    });
  });

  describe("4. uploadDocumentAuto Routing", () => {
    it("should route <= 4MB buffer to uploadSimple", async () => {
      let usedSimple = false;
      let usedResumable = false;

      globalThis.fetch = async (input: RequestInfo | URL) => {
        const urlStr = String(input);
        if (urlStr.includes("/list?")) {
          return new Response(JSON.stringify({ id: "list-1" }), { status: 200 });
        }
        if (urlStr.includes(":/content")) {
          usedSimple = true;
          return new Response(
            JSON.stringify({ id: "item-simple", webUrl: "https://item-simple" }),
            { status: 200 }
          );
        }
        if (urlStr.includes("/createUploadSession")) {
          usedResumable = true;
          return new Response(
            JSON.stringify({ uploadUrl: "https://upload-url", nextExpectedRanges: ["0-"] }),
            { status: 200 }
          );
        }
        return new Response("{}", { status: 200 });
      };

      const smallBuf = Buffer.alloc(3 * 1024 * 1024); // 3MB <= 4MB
      const res = await SubstrateUploader.uploadDocumentAuto(mockToken, smallBuf, "small.txt");

      expect(usedSimple).toBe(true);
      expect(usedResumable).toBe(false);
      expect(res.driveItemId).toBe("item-simple");
    });

    it("should route > 4MB buffer to uploadResumable", async () => {
      let usedSimple = false;
      let usedResumable = false;

      globalThis.fetch = async (input: RequestInfo | URL) => {
        const urlStr = String(input);
        if (urlStr.includes("/list?")) {
          return new Response(JSON.stringify({ id: "list-1" }), { status: 200 });
        }
        if (urlStr.includes(":/content")) {
          usedSimple = true;
          return new Response(JSON.stringify({ id: "item-simple" }), { status: 200 });
        }
        if (urlStr.includes("/createUploadSession")) {
          usedResumable = true;
          return new Response(
            JSON.stringify({ uploadUrl: "https://upload-url", nextExpectedRanges: ["0-"] }),
            { status: 200 }
          );
        }
        if (urlStr === "https://upload-url") {
          return new Response(
            JSON.stringify({ id: "item-resumable", webUrl: "https://item-resumable" }),
            { status: 201 }
          );
        }
        return new Response("{}", { status: 200 });
      };

      // 4MB + 1 byte
      const largeBuf = Buffer.alloc(4 * 1024 * 1024 + 1);
      const res = await SubstrateUploader.uploadDocumentAuto(mockToken, largeBuf, "large.txt");

      expect(usedSimple).toBe(false);
      expect(usedResumable).toBe(true);
      expect(res.driveItemId).toBe("item-resumable");
    });
  });

  describe("5. uploadDocumentToOneDrive Backward Compatibility & Heuristics", () => {
    it("should handle standard 3-arg call", async () => {
      globalThis.fetch = async (input: RequestInfo | URL) => {
        const urlStr = String(input);
        if (urlStr.includes("/list?")) {
          return new Response(JSON.stringify({ id: "list-1" }), { status: 200 });
        }
        return new Response(
          JSON.stringify({ id: "item-compat-3", webUrl: "https://compat-3" }),
          { status: 200 }
        );
      };

      const res = await SubstrateUploader.uploadDocumentToOneDrive(
        mockToken,
        "content 3-arg",
        "doc.txt"
      );
      expect(res.driveItemId).toBe("item-compat-3");
    });

    it("should handle 4-arg call with AbortSignal", async () => {
      const controller = new AbortController();
      let capturedSignal: AbortSignal | undefined;

      globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        const urlStr = String(input);
        if (urlStr.includes("/list?")) {
          return new Response(JSON.stringify({ id: "list-1" }), { status: 200 });
        }
        capturedSignal = init?.signal as AbortSignal;
        return new Response(
          JSON.stringify({ id: "item-compat-signal", webUrl: "https://compat-signal" }),
          { status: 200 }
        );
      };

      const res = await SubstrateUploader.uploadDocumentToOneDrive(
        mockToken,
        "content signal",
        "signal.txt",
        controller.signal
      );
      expect(res.driveItemId).toBe("item-compat-signal");
      expect(capturedSignal).toBe(controller.signal);
    });

    it("should handle heuristic argument swap when content is filename and fileName is long body", async () => {
      let uploadedContent = "";
      let uploadedUrl = "";

      globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        const urlStr = String(input);
        if (urlStr.includes("/list?")) {
          return new Response(JSON.stringify({ id: "list-1" }), { status: 200 });
        }
        uploadedUrl = urlStr;
        uploadedContent = init?.body ? init.body.toString() : "";
        return new Response(
          JSON.stringify({ id: "item-swapped", webUrl: "https://swapped" }),
          { status: 200 }
        );
      };

      const longBody = "Line 1\nLine 2\nLine 3 of markdown handoff body";
      const filename = "handoff-session-123.md";

      // Deliberately swapped: content = filename, fileName = longBody
      const res = await SubstrateUploader.uploadDocumentToOneDrive(
        mockToken,
        filename,
        longBody
      );

      expect(res.driveItemId).toBe("item-swapped");
      expect(uploadedUrl).toContain(encodeURIComponent(filename));
      expect(uploadedContent).toBe(longBody);
    });

    it("should handle 4-arg call with customBaseUrl string", async () => {
      let targetUrl = "";
      globalThis.fetch = async (input: RequestInfo | URL) => {
        const urlStr = String(input);
        if (urlStr.includes("/list?")) {
          return new Response(JSON.stringify({ id: "list-1" }), { status: 200 });
        }
        targetUrl = urlStr;
        return new Response(
          JSON.stringify({ id: "item-custom-base", webUrl: "https://custom-base/doc.txt" }),
          { status: 200 }
        );
      };

      const res = await SubstrateUploader.uploadDocumentToOneDrive(
        mockToken,
        "content custom base",
        "doc.txt",
        "https://my-custom-graph.com/v1.0/drives/123/root"
      );
      expect(res.driveItemId).toBe("item-custom-base");
      expect(targetUrl).toBe("https://my-custom-graph.com/v1.0/drives/123/root/doc.txt:/content");
    });
  });
});
