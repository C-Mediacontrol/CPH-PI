import { describe, it, expect, beforeEach, afterEach, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import AdmZip from "adm-zip";
import { FilePorter } from "../../src/transport/file-porter.ts";

describe("FilePorter Unit Tests", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cph-file-porter-test-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it("should detect runtimes correctly based on file extensions", () => {
    const porter = new FilePorter({ cwd: tempDir });

    expect(porter.detectRuntime("test.py")).toBe("python");
    expect(porter.detectRuntime("test.js")).toBe("node");
    expect(porter.detectRuntime("test.ts")).toBe("bun");
    expect(porter.detectRuntime("test.ps1")).toBe("powershell");
    expect(porter.detectRuntime("test.sh")).toBe("bash");
    expect(porter.detectRuntime("test.md")).toBeUndefined();
    expect(porter.detectRuntime("test.json")).toBeUndefined();
  });

  it("should resolve scratch destination within .cph/scratch", () => {
    const porter = new FilePorter({ cwd: tempDir });
    const dest = porter.resolveDestination("test_script.py");

    expect(dest).toBe(path.join(tempDir, ".cph", "scratch", "test_script.py"));
    expect(fs.existsSync(path.dirname(dest))).toBe(true);
  });

  it("should save content directly and execute python script if python is available", async () => {
    const porter = new FilePorter({ cwd: tempDir });
    const scriptContent = `
print("Hello from File Porter!")
`;
    const result = await porter.saveAndExecute({
      fileName: "hello.py",
      content: scriptContent,
      autoExecute: true,
    });

    expect(result.downloaded).toBe(true);
    expect(fs.existsSync(result.filePath)).toBe(true);
    expect(result.executed).toBe(true);
    expect(result.stdout).toContain("Hello from File Porter!");
    expect(result.formattedOutput).toContain("【TOOL_RESULT: file_porter (hello.py) - SUCCESS】");
  });

  it("should default autoExecute to false even for scripts when omitted", async () => {
    const porter = new FilePorter({ cwd: tempDir });
    const scriptContent = `print("should not execute")`;
    const result = await porter.saveAndExecute({
      fileName: "script.py",
      content: scriptContent,
    });

    expect(result.downloaded).toBe(true);
    expect(result.executed).toBe(false);
    expect(fs.readFileSync(result.filePath, "utf-8")).toBe(scriptContent);
    expect(result.formattedOutput).toContain("【TOOL_RESULT: file_porter (script.py) - SUCCESS】");
  });

  it("should save non-executable file without executing", async () => {
    const porter = new FilePorter({ cwd: tempDir });
    const docContent = `# Architecture Spec\nSome details...`;

    const result = await porter.saveAndExecute({
      fileName: "spec.md",
      content: docContent,
      autoExecute: false,
    });

    expect(result.downloaded).toBe(true);
    expect(result.executed).toBe(false);
    expect(fs.readFileSync(result.filePath, "utf-8")).toBe(docContent);
    expect(result.formattedOutput).toContain("【TOOL_RESULT: file_porter (spec.md) - SUCCESS】");
  });

  it("should capture execution errors without throwing unhandled exceptions", async () => {
    const porter = new FilePorter({ cwd: tempDir });
    const badScript = `raise ValueError("Intentional script failure")`;

    const result = await porter.saveAndExecute({
      fileName: "fail.py",
      content: badScript,
      autoExecute: true,
    });

    expect(result.downloaded).toBe(true);
    expect(result.executed).toBe(true);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("ValueError: Intentional script failure");
    expect(result.formattedOutput).toContain("【TOOL_RESULT: file_porter (fail.py) - FAILED】");
  });
});

describe("FilePorter asyncgw normalization, SSRF guard, and zip semantics", () => {
  test("normalizeAsyncGwUrl extracts filename, preserves query params, and strips trailing filename after /views/original", () => {
    const raw =
      "https://fr-prod.asyncgw.teams.microsoft.com/v1/objects/0-frc-d3-f6c040c7/views/original/CNNJI-QUERY-review-2026-10-25.md?version=1";
    const norm = FilePorter.normalizeAsyncGwUrl(raw);
    expect(norm.fileNameFromUrl).toBe("CNNJI-QUERY-review-2026-10-25.md");
    expect(norm.fetchUrl).toBe(
      "https://fr-prod.asyncgw.teams.microsoft.com/v1/objects/0-frc-d3-f6c040c7/views/original?version=1"
    );
  });

  test("rejects disallowed hosts (SSRF guard)", () => {
    expect(() =>
      FilePorter.assertAllowedDownloadUrl("http://169.254.169.254/latest/meta-data")
    ).toThrow(/Disallowed download host/i);
    expect(() =>
      FilePorter.assertAllowedDownloadUrl(
        "https://fr-prod.asyncgw.teams.microsoft.com/v1/objects/123/views/original"
      )
    ).not.toThrow();
  });

  test("downloads with IC3 token and saves .zip as-is when destinationPath ends with .zip, or extracts with prefix dedup when destinationPath is a directory", async () => {
    const tmpWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "cph-porter-ws-"));

    // Build an in-memory zip with top-level folder `test/`
    const zip = new AdmZip();
    zip.addFile("test/report.md", Buffer.from("# Review Report\n", "utf8"));
    zip.addFile("test/sub/detail.txt", Buffer.from("detail content", "utf8"));
    const zipBuffer = zip.toBuffer();

    const authHeadersSeen: string[] = [];
    const urlsSeen: string[] = [];

    const mockFetch = (async (input: string | URL | Request, init?: RequestInit) => {
      urlsSeen.push(String(input));
      const headers = (init?.headers || {}) as Record<string, string>;
      authHeadersSeen.push(headers["Authorization"] || "");
      return new Response(zipBuffer, { status: 200 });
    }) as typeof fetch;

    const porter = new FilePorter({
      cwd: tmpWorkspace,
      ic3TokenProvider: async () => "ic3_secret_token",
      fetchFn: mockFetch,
    });

    // Case A: destinationPath ends with .zip -> save .zip file as-is
    const resZipFile = await porter.deliverToWorkspace({
      downloadUrl:
        "https://fr-prod.asyncgw.teams.microsoft.com/v1/objects/0-frs-d4-111/views/original/pkg.zip",
      destinationPath: "test/my-archive.zip",
    });

    expect(urlsSeen[0]).toBe(
      "https://fr-prod.asyncgw.teams.microsoft.com/v1/objects/0-frs-d4-111/views/original"
    );
    expect(authHeadersSeen[0]).toBe("Bearer ic3_secret_token");
    expect(resZipFile.extractedFromZip).toBe(false);
    expect(resZipFile.landedFiles).toEqual(["test/my-archive.zip"]);
    expect(fs.existsSync(path.join(tmpWorkspace, "test/my-archive.zip"))).toBe(true);

    // Case B: destinationPath is directory "test/" -> extract and deduplicate leading "test/"
    const resExtract = await porter.deliverToWorkspace({
      downloadUrl:
        "https://fr-prod.asyncgw.teams.microsoft.com/v1/objects/0-frs-d4-111/views/original/pkg.zip",
      destinationPath: "test/",
    });

    expect(resExtract.extractedFromZip).toBe(true);
    expect(resExtract.landedFiles.sort()).toEqual(["test/report.md", "test/sub/detail.txt"]);
    expect(
      fs.readFileSync(path.join(tmpWorkspace, "test/report.md"), "utf8")
    ).toBe("# Review Report\n");
    // Ensure no double test/test/report.md
    expect(fs.existsSync(path.join(tmpWorkspace, "test/test/report.md"))).toBe(false);

    fs.rmSync(tmpWorkspace, { recursive: true, force: true });
  });

  test("retries once with Graph token when asyncgw returns 401 or 403", async () => {
    const tmpWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "cph-porter-retry-"));
    const calls: { url: string; auth: string }[] = [];

    const mockFetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const headers = (init?.headers || {}) as Record<string, string>;
      const auth = headers["Authorization"] || "";
      calls.push({ url: String(input), auth });
      if (calls.length === 1) {
        return new Response("Unauthorized", { status: 401 });
      }
      return new Response("hello content", { status: 200 });
    }) as typeof fetch;

    const porter = new FilePorter({
      cwd: tmpWorkspace,
      ic3TokenProvider: async () => "expired_ic3_token",
      graphTokenProvider: async () => "fresh_graph_token",
      fetchFn: mockFetch,
    });

    const res = await porter.deliverToWorkspace({
      downloadUrl:
        "https://fr-prod.asyncgw.teams.microsoft.com/v1/objects/0-frs-d4-111/views/original/note.txt",
      destinationPath: "notes/note.txt",
    });

    expect(calls.length).toBe(2);
    expect(calls[0].auth).toBe("Bearer expired_ic3_token");
    expect(calls[1].auth).toBe("Bearer fresh_graph_token");
    expect(res.extractedFromZip).toBe(false);
    expect(res.landedFiles).toEqual(["notes/note.txt"]);
    expect(fs.readFileSync(path.join(tmpWorkspace, "notes/note.txt"), "utf8")).toBe("hello content");

    fs.rmSync(tmpWorkspace, { recursive: true, force: true });
  });

  test("rejects zip entries attempting Zip-Slip path traversal", async () => {
    const tmpWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "cph-porter-slip-"));
    const zip = new AdmZip();
    zip.addFile("evil.sh", Buffer.from("rm -rf /", "utf8"));
    zip.getEntries()[0].entryName = "../evil.sh";
    const zipBuffer = zip.toBuffer();

    const mockFetch = (async () => new Response(zipBuffer, { status: 200 })) as typeof fetch;

    const porter = new FilePorter({
      cwd: tmpWorkspace,
      fetchFn: mockFetch,
    });

    await expect(
      porter.deliverToWorkspace({
        downloadUrl: "https://fr-prod.asyncgw.teams.microsoft.com/v1/objects/obj-1/views/original/bundle.zip",
        destinationPath: "extracted/",
      })
    ).rejects.toThrow(/Zip-Slip/i);

    fs.rmSync(tmpWorkspace, { recursive: true, force: true });
  });

  test("rejects destinationPath that attempts to traverse outside cwd", async () => {
    const tmpWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "cph-porter-cwd-"));
    const porter = new FilePorter({
      cwd: tmpWorkspace,
      fetchFn: (async () => new Response("ok", { status: 200 })) as typeof fetch,
    });

    await expect(
      porter.deliverToWorkspace({
        downloadUrl: "https://fr-prod.asyncgw.teams.microsoft.com/v1/objects/obj-1/views/original/f.txt",
        destinationPath: "../outside.txt",
      })
    ).rejects.toThrow(/outside workspace cwd/i);

    fs.rmSync(tmpWorkspace, { recursive: true, force: true });
  });

  test("rejects zip archives with more than 200 entries", async () => {
    const tmpWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "cph-porter-entries-"));
    const zip = new AdmZip();
    for (let i = 0; i < 201; i++) {
      zip.addFile(`file_${i}.txt`, Buffer.from("data", "utf8"));
    }
    const zipBuffer = zip.toBuffer();

    const porter = new FilePorter({
      cwd: tmpWorkspace,
      fetchFn: (async () => new Response(zipBuffer, { status: 200 })) as typeof fetch,
    });

    await expect(
      porter.deliverToWorkspace({
        downloadUrl: "https://fr-prod.asyncgw.teams.microsoft.com/v1/objects/obj-1/views/original/many.zip",
        destinationPath: "extracted/",
      })
    ).rejects.toThrow(/entry count/i);

    fs.rmSync(tmpWorkspace, { recursive: true, force: true });
  });

  test("saveAndExecute fetches HTTP downloadUrl via downloadBinary with SSRF protection", async () => {
    const tmpWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "cph-porter-exec-"));

    const mockFetch = (async () => {
      return new Response("print('fetched from allowed host')", { status: 200 });
    }) as typeof fetch;

    const porter = new FilePorter({
      cwd: tmpWorkspace,
      fetchFn: mockFetch,
    });

    // SSRF disallowed host should throw
    await expect(
      porter.saveAndExecute({
        fileName: "run.py",
        downloadUrl: "http://malicious-host.com/script.py",
        autoExecute: false,
      })
    ).rejects.toThrow(/Disallowed download host/i);

    // Allowed host should succeed and save
    const res = await porter.saveAndExecute({
      fileName: "run.py",
      downloadUrl: "https://fr-prod.asyncgw.teams.microsoft.com/v1/objects/obj-1/views/original/run.py",
      autoExecute: false,
    });

    expect(res.downloaded).toBe(true);
    expect(res.executed).toBe(false);
    expect(fs.readFileSync(res.filePath, "utf-8")).toBe("print('fetched from allowed host')");

    fs.rmSync(tmpWorkspace, { recursive: true, force: true });
  });

  test("normalizeAsyncGwUrl supports exact asyncgw.teams.microsoft.com host", () => {
    const raw =
      "https://asyncgw.teams.microsoft.com/v1/objects/obj-99/views/original/test-spec.md";
    const norm = FilePorter.normalizeAsyncGwUrl(raw);
    expect(norm.fileNameFromUrl).toBe("test-spec.md");
    expect(norm.fetchUrl).toBe(
      "https://asyncgw.teams.microsoft.com/v1/objects/obj-99/views/original"
    );
  });

  test("deliverToWorkspace detects existing directory without trailing slash as isDirTarget", async () => {
    const tmpWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "cph-porter-existdir-"));
    const targetDir = path.join(tmpWorkspace, "existing_folder");
    fs.mkdirSync(targetDir, { recursive: true });

    const mockFetch = (async () => new Response("folder file content", { status: 200 })) as typeof fetch;

    const porter = new FilePorter({
      cwd: tmpWorkspace,
      fetchFn: mockFetch,
    });

    const res = await porter.deliverToWorkspace({
      downloadUrl: "https://fr-prod.asyncgw.teams.microsoft.com/v1/objects/obj-1/views/original/doc.txt",
      destinationPath: "existing_folder",
    });

    expect(res.landedFiles).toEqual(["existing_folder/doc.txt"]);
    expect(fs.readFileSync(path.join(targetDir, "doc.txt"), "utf-8")).toBe("folder file content");

    fs.rmSync(tmpWorkspace, { recursive: true, force: true });
  });

  test("deliverToWorkspace sanitizes filename to prevent traversal when landing into directory", async () => {
    const tmpWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "cph-porter-traversal-"));
    const mockFetch = (async () => new Response("safe content", { status: 200 })) as typeof fetch;

    const porter = new FilePorter({
      cwd: tmpWorkspace,
      fetchFn: mockFetch,
    });

    // fileNameFromUrl containing path traversal like ../../evil.txt
    const res = await porter.deliverToWorkspace({
      downloadUrl: "https://sharepoint.com/sites/team/..%2F..%2Fevil.txt",
      destinationPath: "target_dir/",
    });

    // Should sanitize base name to "evil.txt" and land strictly inside target_dir/
    expect(res.landedFiles).toEqual(["target_dir/evil.txt"]);
    expect(fs.existsSync(path.join(tmpWorkspace, "target_dir", "evil.txt"))).toBe(true);
    expect(fs.existsSync(path.join(tmpWorkspace, "evil.txt"))).toBe(false);

    fs.rmSync(tmpWorkspace, { recursive: true, force: true });
  });
});
