import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import { FilePorter } from "../../src/transport/file-porter.ts";

function tmpWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cph-porter-"));
}

function textResponse(text: string, status = 200): Response {
  return new Response(text, { status, headers: { "content-type": "text/plain" } });
}

describe("FilePorter.deliverToWorkspace", () => {
  test("downloads http text to declared path", async () => {
    const root = tmpWorkspace();
    const calls: string[] = [];
    const porter = new FilePorter({
      cwd: root,
      fetchFn: (async (url: string) => {
        calls.push(String(url));
        return textResponse("hello");
      }) as any,
    });

    const res = await porter.deliverToWorkspace({
      downloadUrl: "https://tenant.sharepoint.com/sites/x/drive/report.md",
      destinationPath: "test/report.md",
    });

    expect(res.landedFiles).toEqual(["test/report.md"]);
    expect(res.extractedFromZip).toBe(false);
    expect(fs.readFileSync(path.join(root, "test/report.md"), "utf-8")).toBe("hello");
    expect(calls[0]).toContain("sharepoint.com");
  });

  test("rejects non-allowlisted host", async () => {
    const root = tmpWorkspace();
    const porter = new FilePorter({ cwd: root, fetchFn: (async () => textResponse("x")) as any });
    await expect(
      porter.deliverToWorkspace({ downloadUrl: "http://127.0.0.1:8080/secret", destinationPath: "a.txt" })
    ).rejects.toThrow(/Disallowed download host/i);
  });

  test("rejects critical harness paths", async () => {
    const root = tmpWorkspace();
    const porter = new FilePorter({ cwd: root, fetchFn: (async () => textResponse("x")) as any });
    await expect(
      porter.deliverToWorkspace({
        downloadUrl: "https://tenant.sharepoint.com/sites/x/a.md",
        destinationPath: "src/protocol/prompt-builder.ts",
      })
    ).rejects.toThrow(/critical harness file/i);
  });

  test("refuses to overwrite existing file by default", async () => {
    const root = tmpWorkspace();
    fs.mkdirSync(path.join(root, "test"), { recursive: true });
    fs.writeFileSync(path.join(root, "test", "a.md"), "old");
    const porter = new FilePorter({ cwd: root, fetchFn: (async () => textResponse("new")) as any });
    await expect(
      porter.deliverToWorkspace({
        downloadUrl: "https://tenant.sharepoint.com/sites/x/a.md",
        destinationPath: "test/a.md",
      })
    ).rejects.toThrow(/Refusing to overwrite/i);
    expect(fs.readFileSync(path.join(root, "test", "a.md"), "utf-8")).toBe("old");
  });

  test("overwrites when explicitly requested", async () => {
    const root = tmpWorkspace();
    fs.mkdirSync(path.join(root, "test"), { recursive: true });
    fs.writeFileSync(path.join(root, "test", "a.md"), "old");
    const porter = new FilePorter({ cwd: root, fetchFn: (async () => textResponse("new")) as any });
    await porter.deliverToWorkspace({
      downloadUrl: "https://tenant.sharepoint.com/sites/x/a.md",
      destinationPath: "test/a.md",
      overwrite: true,
    });
    expect(fs.readFileSync(path.join(root, "test", "a.md"), "utf-8")).toBe("new");
  });

  test("extracts zip into directory target", async () => {
    const root = tmpWorkspace();
    const zip = new AdmZip();
    zip.addFile("pkg/a/b.txt", Buffer.from("ok"));
    const bytes = zip.toBuffer();
    const porter = new FilePorter({
      cwd: root,
      fetchFn: (async () =>
        new Response(bytes, { status: 200, headers: { "content-type": "application/zip" } })) as any,
    });

    const res = await porter.deliverToWorkspace({
      downloadUrl: "https://tenant.sharepoint.com/sites/x/bundle.zip",
      destinationPath: "test/",
    });

    expect(res.extractedFromZip).toBe(true);
    expect(res.landedFiles).toContain("test/pkg/a/b.txt");
    expect(fs.readFileSync(path.join(root, "test", "pkg", "a", "b.txt"), "utf-8")).toBe("ok");
  });

  test("blocks zip-slip entries", async () => {
    const root = tmpWorkspace();
    const zip = new AdmZip();
    zip.addFile("ok.txt", Buffer.from("x"));
    // Rewrite the central-directory name after creation, because adm-zip
    // normalizes traversal segments passed to addFile().
    zip.getEntries()[0].entryName = "../escape.txt";
    const bytes = zip.toBuffer();
    const porter = new FilePorter({
      cwd: root,
      fetchFn: (async () => new Response(bytes, { status: 200 })) as any,
    });
    await expect(
      porter.deliverToWorkspace({
        downloadUrl: "https://tenant.sharepoint.com/sites/x/evil.zip",
        destinationPath: "test/",
      })
    ).rejects.toThrow(/Zip-Slip|Disallowed|outside/i);
  });

  test("sends IC3 bearer token for asyncgw downloads", async () => {
    const root = tmpWorkspace();
    let authHeader = "";
    const porter = new FilePorter({
      cwd: root,
      ic3TokenProvider: async () => "ic3-token",
      fetchFn: (async (_url: string, init?: any) => {
        authHeader = init?.headers?.Authorization || "";
        return textResponse("ok");
      }) as any,
    });
    await porter.deliverToWorkspace({
      downloadUrl: "https://fr-prod.asyncgw.teams.microsoft.com/v1/objects/abc/views/original",
      destinationPath: "test/a.txt",
    });
    expect(authHeader).toBe("Bearer ic3-token");
  });

  test("lands a single text file into a directory target", async () => {
    const root = tmpWorkspace();
    const porter = new FilePorter({
      cwd: root,
      fetchFn: (async () => textResponse("single")) as any,
    });
    const res = await porter.deliverToWorkspace({
      downloadUrl: "https://tenant.sharepoint.com/sites/x/report.md",
      destinationPath: "test/",
    });
    expect(res.extractedFromZip).toBe(false);
    expect(res.landedFiles).toEqual(["test/report.md"]);
    expect(fs.readFileSync(path.join(root, "test", "report.md"), "utf-8")).toBe("single");
  });

  test("keeps explicit .zip destination as a zip file", async () => {
    const root = tmpWorkspace();
    const zip = new AdmZip();
    zip.addFile("a.txt", Buffer.from("x"));
    const bytes = zip.toBuffer();
    const porter = new FilePorter({
      cwd: root,
      fetchFn: (async () => new Response(bytes, { status: 200 })) as any,
    });
    const res = await porter.deliverToWorkspace({
      downloadUrl: "https://tenant.sharepoint.com/sites/x/p.zip",
      destinationPath: "test/p.zip",
    });
    expect(res.extractedFromZip).toBe(false);
    expect(fs.existsSync(path.join(root, "test", "p.zip"))).toBe(true);
  });

  test("keeps a zip payload as a file when the destination is not a directory", async () => {
    const root = tmpWorkspace();
    const zip = new AdmZip();
    zip.addFile("a.txt", Buffer.from("x"));
    const bytes = zip.toBuffer();
    const porter = new FilePorter({
      cwd: root,
      fetchFn: (async () => new Response(bytes, { status: 200 })) as any,
    });
    const res = await porter.deliverToWorkspace({
      downloadUrl: "https://tenant.sharepoint.com/sites/x/bundle.zip",
      destinationPath: "test/report.md",
    });
    expect(res.extractedFromZip).toBe(false);
    expect(res.landedFiles).toEqual(["test/report.md"]);
    expect(fs.statSync(path.join(root, "test", "report.md")).isFile()).toBe(true);
  });

  test("fails explicitly for asyncgw downloads without an IC3 token", async () => {
    const root = tmpWorkspace();
    const porter = new FilePorter({
      cwd: root,
      ic3TokenProvider: async () => undefined,
      fetchFn: (async () => textResponse("x")) as any,
    });
    await expect(
      porter.deliverToWorkspace({
        downloadUrl: "https://fr-prod.asyncgw.teams.microsoft.com/v1/objects/x/views/original",
        destinationPath: "test/a.txt",
      })
    ).rejects.toThrow(/IC3 token unavailable/i);
  });

  test("aborts a hanging download after the configured timeout", async () => {
    const root = tmpWorkspace();
    const porter = new FilePorter({
      cwd: root,
      timeoutMs: 80,
      fetchFn: ((_url: string, init?: any) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        })) as any,
    });
    await expect(
      porter.deliverToWorkspace({
        downloadUrl: "https://tenant.sharepoint.com/sites/x/slow.md",
        destinationPath: "test/slow.md",
      })
    ).rejects.toThrow(/Download aborted|timeout/i);
  });
});
