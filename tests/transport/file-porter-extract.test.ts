import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import AdmZip from "adm-zip";
import {
  FilePorter,
  type FilePorterDeliveryResult,
} from "../../src/transport/file-porter.ts";
import type { DeliverableItem } from "../../src/protocol/deliverables-parser.ts";

describe("FilePorter Safe Extraction & Dual-Mode Delivery", () => {
  let tempWorkspaceRoot: string;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    tempWorkspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "cph-file-porter-extract-test-")
    );
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    try {
      fs.rmSync(tempWorkspaceRoot, { recursive: true, force: true });
    } catch {}
  });

  describe("1. extractZipSafely - Flattening & Anti-Root-Pollution", () => {
    it("should strip redundant top-level directory when matching targetDir basename", () => {
      const zip = new AdmZip();
      zip.addFile("test/report.md", Buffer.from("# Test Report Content"));
      zip.addFile(
        "test/sub/data.json",
        Buffer.from(JSON.stringify({ status: "ok" }))
      );
      const zipBuffer = zip.toBuffer();

      const landed = FilePorter.extractZipSafely(
        zipBuffer,
        "test",
        tempWorkspaceRoot
      );

      // Should land in test/report.md, NOT test/test/report.md
      expect(landed).toEqual(["test/report.md", "test/sub/data.json"]);

      const file1 = path.join(tempWorkspaceRoot, "test", "report.md");
      const file2 = path.join(tempWorkspaceRoot, "test", "sub", "data.json");
      expect(fs.existsSync(file1)).toBe(true);
      expect(fs.existsSync(file2)).toBe(true);
      expect(fs.readFileSync(file1, "utf-8")).toBe("# Test Report Content");

      // Verify no redundant nesting occurred
      const redundantDir = path.join(tempWorkspaceRoot, "test", "test");
      expect(fs.existsSync(redundantDir)).toBe(false);
    });

    it("should handle zip with trailing slash in targetDir", () => {
      const zip = new AdmZip();
      zip.addFile("test/summary.txt", Buffer.from("summary info"));
      const zipBuffer = zip.toBuffer();

      const landed = FilePorter.extractZipSafely(
        zipBuffer,
        "test/",
        tempWorkspaceRoot
      );

      expect(landed).toEqual(["test/summary.txt"]);
      expect(
        fs.existsSync(path.join(tempWorkspaceRoot, "test", "summary.txt"))
      ).toBe(true);
      expect(
        fs.existsSync(path.join(tempWorkspaceRoot, "test", "test"))
      ).toBe(false);
    });

    it("should extract normally without stripping when top-level directory does not match targetDir", () => {
      const zip = new AdmZip();
      zip.addFile("custom/spec.md", Buffer.from("spec text"));
      const zipBuffer = zip.toBuffer();

      const landed = FilePorter.extractZipSafely(
        zipBuffer,
        "test",
        tempWorkspaceRoot
      );

      expect(landed).toEqual(["test/custom/spec.md"]);
      expect(
        fs.existsSync(
          path.join(tempWorkspaceRoot, "test", "custom", "spec.md")
        )
      ).toBe(true);
    });

    it("should enforce AGENTS.md Rule 1: redirect files attempting to land directly in workspace root", () => {
      const zip = new AdmZip();
      zip.addFile("danger.sh", Buffer.from("rm -rf /"));
      zip.addFile("root_doc.md", Buffer.from("# Root Doc"));
      const zipBuffer = zip.toBuffer();

      // Attempting to extract directly to workspace root "."
      const landed = FilePorter.extractZipSafely(
        zipBuffer,
        ".",
        tempWorkspaceRoot
      );

      // Must be safely redirected to test/ secondary directory
      expect(landed).toEqual(["test/danger.sh", "test/root_doc.md"]);

      // Verify no direct root pollution
      expect(fs.existsSync(path.join(tempWorkspaceRoot, "danger.sh"))).toBe(
        false
      );
      expect(fs.existsSync(path.join(tempWorkspaceRoot, "root_doc.md"))).toBe(
        false
      );

      // Verify redirected files exist in safe directory
      expect(
        fs.existsSync(path.join(tempWorkspaceRoot, "test", "danger.sh"))
      ).toBe(true);
      expect(
        fs.existsSync(path.join(tempWorkspaceRoot, "test", "root_doc.md"))
      ).toBe(true);
    });

    it("should sanitize path traversal attempts in zip entries and protect workspace root", () => {
      const zip = new AdmZip();
      zip.addFile("../../escape.sh", Buffer.from("malicious"));
      const zipBuffer = zip.toBuffer();

      const landed = FilePorter.extractZipSafely(
        zipBuffer,
        "test",
        tempWorkspaceRoot
      );

      expect(landed).toEqual(["test/escape.sh"]);
      expect(
        fs.existsSync(path.join(tempWorkspaceRoot, "test", "escape.sh"))
      ).toBe(true);
      // Ensure nothing escaped outside workspace root
      const parentDir = path.dirname(tempWorkspaceRoot);
      expect(fs.existsSync(path.join(parentDir, "escape.sh"))).toBe(false);
    });
  });

  describe("2. fetchBlobOrBuffer - Dual-Mode Data Retrieval", () => {
    it("Modal A: should retrieve buffer via CDP evaluate bridge when cdpClient is provided", async () => {
      const expectedText = "Hello from CDP Page Bridge";
      const base64Data = Buffer.from(expectedText).toString("base64");

      const mockCdpClient = {
        evaluate: async (code: string) => {
          return { value: base64Data };
        },
      };

      const buffer = await FilePorter.fetchBlobOrBuffer("blob:http://localhost/12345", {
        cdpClient: mockCdpClient,
      });

      expect(buffer.toString("utf-8")).toBe(expectedText);
    });

    it("Modal B: should inject IC3 Bearer token and headers for asyncgw.teams.microsoft.com", async () => {
      let capturedUrl = "";
      let capturedHeaders: Record<string, string> = {};

      globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        capturedUrl = String(url);
        capturedHeaders = (init?.headers as Record<string, string>) || {};
        return new Response("ic3-payload-content", { status: 200 });
      }) as any;

      const targetUrl =
        "https://fr-prod.asyncgw.teams.microsoft.com/v1/objects/item999";
      const token = "mock-ic3-token-xyz";

      const buffer = await FilePorter.fetchBlobOrBuffer(targetUrl, {
        ic3Token: token,
      });

      expect(capturedUrl).toBe(targetUrl);
      expect(capturedHeaders["Authorization"]).toBe(`Bearer ${token}`);
      expect(capturedHeaders["MS-IC3-Product"]).toBe("Copilot");
      expect(buffer.toString("utf-8")).toBe("ic3-payload-content");
    });

    it("Fallback: should execute standard fetch for generic URLs", async () => {
      let capturedHeaders: Record<string, string> = {};

      globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        capturedHeaders = (init?.headers as Record<string, string>) || {};
        return new Response("standard-web-content", { status: 200 });
      }) as any;

      const buffer = await FilePorter.fetchBlobOrBuffer(
        "https://example.com/readme.txt"
      );

      expect(capturedHeaders["MS-IC3-Product"]).toBeUndefined();
      expect(capturedHeaders["Authorization"]).toBeUndefined();
      expect(buffer.toString("utf-8")).toBe("standard-web-content");
    });

    it("should throw informative error when HTTP response status is not 200", async () => {
      globalThis.fetch = (async () => {
        return new Response("Not Found", { status: 404, statusText: "Not Found" });
      }) as any;

      await expect(
        FilePorter.fetchBlobOrBuffer("https://example.com/not-exist.zip")
      ).rejects.toThrow("404");
    });
  });

  describe("3. fetchAndDeliver - End-to-End Delivery and Reconciliation", () => {
    it("should fetch, safely unpack, and reconcile a ZIP deliverable item", async () => {
      const zip = new AdmZip();
      zip.addFile("test/audit.md", Buffer.from("# Audit Log"));
      zip.addFile("test/assets/logo.svg", Buffer.from("<svg></svg>"));
      const zipBuffer = zip.toBuffer();

      globalThis.fetch = (async () => {
        return new Response(zipBuffer, { status: 200 });
      }) as any;

      const item: DeliverableItem = {
        name: "deliverables.zip",
        url: "https://fr-prod.asyncgw.teams.microsoft.com/v1/objects/zip1",
        destinationPath: "test/",
        isZip: true,
      };

      const result = await FilePorter.fetchAndDeliver(item, tempWorkspaceRoot, {
        ic3Token: "token123",
      });

      expect(result.status).toBe("success");
      expect(result.landedPaths.sort()).toEqual(
        ["test/audit.md", "test/assets/logo.svg"].sort()
      );
      expect(
        fs.existsSync(path.join(tempWorkspaceRoot, "test", "audit.md"))
      ).toBe(true);
      expect(
        fs.existsSync(path.join(tempWorkspaceRoot, "test", "assets", "logo.svg"))
      ).toBe(true);
      expect(
        fs.existsSync(path.join(tempWorkspaceRoot, "test", "test"))
      ).toBe(false);
    });

    it("should fetch and land a single non-zip file into specified directory", async () => {
      const content = "# Architecture Decisions";
      globalThis.fetch = (async () => {
        return new Response(content, { status: 200 });
      }) as any;

      const item: DeliverableItem = {
        name: "adr.md",
        url: "https://example.com/adr.md",
        destinationPath: "test/docs/adr-001.md",
        isZip: false,
      };

      const result = await FilePorter.fetchAndDeliver(item, tempWorkspaceRoot);

      expect(result.status).toBe("success");
      expect(result.landedPaths).toEqual(["test/docs/adr-001.md"]);
      const landedFile = path.join(tempWorkspaceRoot, "test", "docs", "adr-001.md");
      expect(fs.existsSync(landedFile)).toBe(true);
      expect(fs.readFileSync(landedFile, "utf-8")).toBe(content);
    });

    it("should prevent AGENTS.md Rule 1 root pollution when regular file destination is root", async () => {
      const content = "echo bad";
      globalThis.fetch = (async () => {
        return new Response(content, { status: 200 });
      }) as any;

      const item: DeliverableItem = {
        name: "danger.sh",
        url: "https://example.com/danger.sh",
        destinationPath: "danger.sh", // Direct root attempt
        isZip: false,
      };

      const result = await FilePorter.fetchAndDeliver(item, tempWorkspaceRoot);

      expect(result.status).toBe("success");
      expect(result.landedPaths).toEqual(["test/danger.sh"]);

      // Verify file did not land in workspace root
      expect(fs.existsSync(path.join(tempWorkspaceRoot, "danger.sh"))).toBe(false);
      // Verify file was safely redirected into test/
      expect(fs.existsSync(path.join(tempWorkspaceRoot, "test", "danger.sh"))).toBe(
        true
      );
    });

    it("should return status: 'failed' with error description on network failure", async () => {
      globalThis.fetch = (async () => {
        return new Response("Forbidden", { status: 403, statusText: "Forbidden" });
      }) as any;

      const item: DeliverableItem = {
        name: "private.docx",
        url: "https://example.com/private.docx",
        destinationPath: "test/private.docx",
        isZip: false,
      };

      const result = await FilePorter.fetchAndDeliver(item, tempWorkspaceRoot);

      expect(result.status).toBe("failed");
      expect(result.landedPaths).toEqual([]);
      expect(result.error).toContain("403");
    });
  });
});
