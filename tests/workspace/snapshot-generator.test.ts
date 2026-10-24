import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  SnapshotGenerator,
  type SnapshotResult,
  type SliceResult,
} from "../../src/workspace/snapshot-generator.ts";

describe("SnapshotGenerator (Workspace Snapshot & Scoped Slice Engine)", () => {
  const repoRoot = path.resolve(__dirname, "../..");
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(
      os.tmpdir(),
      "cph-snapshot-test-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7)
    );
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    try {
      if (fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    } catch {
      // ignore cleanup error
    }
  });

  describe("Static Rules & Constants", () => {
    it("should define standard directory exclusion prefixes", () => {
      expect(SnapshotGenerator.EXCLUDED_DIR_PREFIXES).toContain(".docs/");
      expect(SnapshotGenerator.EXCLUDED_DIR_PREFIXES).toContain("package/");
      expect(SnapshotGenerator.EXCLUDED_DIR_PREFIXES).toContain("dist/");
      expect(SnapshotGenerator.EXCLUDED_DIR_PREFIXES).toContain(".cph/");
      expect(SnapshotGenerator.EXCLUDED_DIR_PREFIXES).toContain("node_modules/");
      expect(SnapshotGenerator.EXCLUDED_DIR_PREFIXES).toContain(".git/");
    });

    it("should accurately identify sensitive filenames without false-flagging normal code", () => {
      const sensitiveNames = [
        ".env",
        ".env.local",
        ".env.production",
        "tokens.json",
        "graph-tokens.json",
        "pnp-session.json",
        "auth-session.json",
        "private.pem",
        "server.key",
        "cert.pfx",
        "cert.pkcs12",
        "id_rsa",
      ];

      for (const name of sensitiveNames) {
        const matches = SnapshotGenerator.SENSITIVE_FILE_PATTERNS.some((re) =>
          re.test(name)
        );
        expect(matches).toBe(true);
      }

      const safeNames = [
        "session-manager.ts",
        "token-manager.ts",
        "execution-ledger.ts",
        "tokens-service.ts",
        "session-tracker.ts",
        "key-vault-client.ts",
      ];

      for (const name of safeNames) {
        const matches = SnapshotGenerator.SENSITIVE_FILE_PATTERNS.some((re) =>
          re.test(name)
        );
        expect(matches).toBe(false);
      }
    });

    it("should define sensitive content patterns for private keys and JWT tokens", () => {
      const privateKeySample = ["-----BEGIN", "RSA", "PRIVATE", "KEY-----"].join(" ") + "\ncontent\n" + ["-----END", "RSA", "PRIVATE", "KEY-----"].join(" ");
      const jwtSample = "Authorization: Bearer " + ["ey", "JhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"].join("") + "." + ["ey", "JzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ"].join("") + "." + ["SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"].join("");

      const hasKey = SnapshotGenerator.SENSITIVE_CONTENT_PATTERNS.some((re) =>
        re.test(privateKeySample)
      );
      const hasJwt = SnapshotGenerator.SENSITIVE_CONTENT_PATTERNS.some((re) =>
        re.test(jwtSample)
      );

      expect(hasKey).toBe(true);
      expect(hasJwt).toBe(true);
    });

    it("should assert all 8 critical core files exist in current repository", () => {
      expect(SnapshotGenerator.CRITICAL_CORE_FILES.length).toBe(8);
      for (const relFile of SnapshotGenerator.CRITICAL_CORE_FILES) {
        const fullPath = path.join(repoRoot, relFile);
        expect(fs.existsSync(fullPath)).toBe(true);
      }
    });
  });

  describe("Directory & Source File Filtering (Isolated Tests)", () => {
    it("should filter excluded directories, sensitive files, lock files, and non-whitelisted extensions", () => {
      // 1. Valid source files
      fs.mkdirSync(path.join(tmpDir, "src", "core"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "src", "core", "index.ts"), "export const a = 1;");
      fs.writeFileSync(path.join(tmpDir, "README.md"), "# Project");
      fs.writeFileSync(path.join(tmpDir, "config.json"), "{}");

      // 2. Excluded directories
      fs.mkdirSync(path.join(tmpDir, ".docs"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, ".docs", "plan.md"), "# Plan");
      fs.mkdirSync(path.join(tmpDir, "dist"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "dist", "bundle.js"), "var a = 1;");
      fs.mkdirSync(path.join(tmpDir, ".cph", "snapshots"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, ".cph", "snapshots", "prev.txt"), "old");
      fs.mkdirSync(path.join(tmpDir, "node_modules", "dep"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "node_modules", "dep", "index.js"), "module.exports={}");

      // 3. Excluded lock files
      fs.writeFileSync(path.join(tmpDir, "package-lock.json"), "{}");
      fs.writeFileSync(path.join(tmpDir, "bun.lock"), "");

      // 4. Sensitive files
      fs.writeFileSync(path.join(tmpDir, ".env"), "SECRET=123");
      fs.writeFileSync(path.join(tmpDir, "auth-tokens.json"), "{}");
      fs.writeFileSync(path.join(tmpDir, "server.key"), "my-key");

      // 5. Non-whitelisted binary files
      fs.writeFileSync(path.join(tmpDir, "app.exe"), "MZ BINARY");
      fs.writeFileSync(path.join(tmpDir, "lib.dll"), "PE BINARY");

      const files = SnapshotGenerator.getTrackedSourceFiles(tmpDir);

      expect(files).toContain("src/core/index.ts");
      expect(files).toContain("README.md");
      expect(files).toContain("config.json");

      expect(files).not.toContain(".docs/plan.md");
      expect(files).not.toContain("dist/bundle.js");
      expect(files).not.toContain(".cph/snapshots/prev.txt");
      expect(files).not.toContain("node_modules/dep/index.js");
      expect(files).not.toContain("package-lock.json");
      expect(files).not.toContain("bun.lock");
      expect(files).not.toContain(".env");
      expect(files).not.toContain("auth-tokens.json");
      expect(files).not.toContain("server.key");
      expect(files).not.toContain("app.exe");
      expect(files).not.toContain("lib.dll");
    });
  });

  describe("Integrity & Security Hard Gates", () => {
    it("should throw CRITICAL INTEGRITY FAULT if essential core files are missing", () => {
      // Mock workspace missing critical files
      fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "src", "dummy.ts"), "export const x = 1;");

      expect(() => {
        SnapshotGenerator.generateWorkspaceSnapshot(tmpDir, path.join(tmpDir, "out"));
      }).toThrow(/CRITICAL INTEGRITY FAULT/);
    });

    it("should throw CRITICAL SECURITY ALERT if sensitive private key is in file content", () => {
      // Create minimal valid mock structure with mock core files
      for (const coreFile of SnapshotGenerator.CRITICAL_CORE_FILES) {
        const full = path.join(tmpDir, coreFile);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, "// mock core file");
      }

      // Add a file containing private key
      const keyStr = ["-----BEGIN", "RSA", "PRIVATE", "KEY-----"].join(" ");
      fs.writeFileSync(
        path.join(tmpDir, "src", "leaked-key.ts"),
        `const key = "${keyStr}\\nMIIEowIBAAKCAQEA0...\\n";`
      );

      expect(() => {
        SnapshotGenerator.generateWorkspaceSnapshot(tmpDir, path.join(tmpDir, "out"));
      }).toThrow(/CRITICAL SECURITY ALERT/);
    });

    it("should throw CRITICAL SECURITY ALERT if sensitive JWT token is in file content", () => {
      for (const coreFile of SnapshotGenerator.CRITICAL_CORE_FILES) {
        const full = path.join(tmpDir, coreFile);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, "// mock core file");
      }

      const jwtPart1 = ["ey", "JhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"].join("");
      const jwtPart2 = ["ey", "JzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ"].join("");
      const jwtPart3 = ["SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"].join("");
      const jwtStr = `${jwtPart1}.${jwtPart2}.${jwtPart3}`;

      fs.writeFileSync(
        path.join(tmpDir, "src", "leaked-token.ts"),
        `const token = "${jwtStr}";`
      );

      expect(() => {
        SnapshotGenerator.generateWorkspaceSnapshot(tmpDir, path.join(tmpDir, "out"));
      }).toThrow(/CRITICAL SECURITY ALERT/);
    });
  });

  describe("Real Repository Snapshot Generation (CPH-PI)", () => {
    it("should generate full workspace snapshot matching dynamic range and core subset gate", () => {
      const outputDir = path.join(repoRoot, ".cph", "snapshots");
      const result: SnapshotResult = SnapshotGenerator.generateWorkspaceSnapshot(
        repoRoot,
        outputDir,
        1
      );

      // 1. Output file verification
      expect(fs.existsSync(result.snapshotPath)).toBe(true);
      expect(path.dirname(result.snapshotPath)).toBe(outputDir);
      expect(path.basename(result.snapshotPath)).toMatch(/^workspace-snapshot-[a-f0-9]+\.txt$/);
      expect(result.cloudFileName).toBe("workspace-v1.txt");

      // 2. Dynamic range assertion [151, 350] (incorporating web frontend source suite)
      expect(result.fileCount).toBeGreaterThanOrEqual(151);
      expect(result.fileCount).toBeLessThanOrEqual(350);

      // 3. Dynamic byte size assertion [1.25 MiB, 3.50 MiB]
      const minBytes = 1.25 * 1024 * 1024;
      const maxBytes = 3.50 * 1024 * 1024;
      expect(result.bytes).toBeGreaterThanOrEqual(minBytes);
      expect(result.bytes).toBeLessThanOrEqual(maxBytes);

      // 4. Critical 9 core files hard gate
      for (const coreFile of SnapshotGenerator.CRITICAL_CORE_FILES) {
        expect(result.files).toContain(coreFile);
      }

      // 5. Structure & content verification
      const content = fs.readFileSync(result.snapshotPath, "utf-8");
      expect(content).toContain("// WORKSPACE STRUCTURE & MANIFEST");
      expect(content).toContain("// SOURCE FILE CONTENTS");
      expect(content).toContain("================================================================================");
      expect(content).toContain("FILE: src/session/session-manager.ts");
      expect(content).toContain("FILE: cph-main-agent-prompt.txt");
    });

    it("should guarantee strict 100% idempotency across sequential runs (M5 anti-expansion)", () => {
      const outputDir = path.join(repoRoot, ".cph", "snapshots");

      const run1 = SnapshotGenerator.generateWorkspaceSnapshot(repoRoot, outputDir, 1);
      const run2 = SnapshotGenerator.generateWorkspaceSnapshot(repoRoot, outputDir, 1);

      expect(run2.fileCount).toBe(run1.fileCount);
      expect(run2.bytes).toBe(run1.bytes);
      expect(run2.hash).toBe(run1.hash);
      expect(run2.snapshotPath).toBe(run1.snapshotPath);

      // Next generation (Handoff) test
      const runHandoff = SnapshotGenerator.generateWorkspaceSnapshot(repoRoot, outputDir, 2);
      expect(runHandoff.cloudFileName).toBe("workspace-v2.txt");
      expect(runHandoff.hash).toBe(run1.hash);
    });

    it("should default outputDir to <workspaceRoot>/.cph/snapshots and auto-create directory", () => {
      const result = SnapshotGenerator.generateWorkspaceSnapshot(repoRoot);
      const expectedDir = path.join(repoRoot, ".cph", "snapshots");

      expect(path.dirname(result.snapshotPath)).toBe(expectedDir);
      expect(fs.existsSync(result.snapshotPath)).toBe(true);
    });
  });

  describe("Subagent Micro-Slice Generation (generateScopedSubagentSlice)", () => {
    it("should generate scoped closure slice for target files and prerequisite reports", () => {
      const targetFiles = ["src/session/session-manager.ts"];
      const prerequisiteReports = ["cph-main-agent-prompt.txt"];

      const slice: SliceResult = SnapshotGenerator.generateScopedSubagentSlice(
        repoRoot,
        targetFiles,
        prerequisiteReports
      );

      expect(fs.existsSync(slice.slicePath)).toBe(true);
      expect(path.basename(slice.slicePath)).toMatch(/^slice-[a-f0-9]+\.txt$/);
      expect(slice.files).toContain("src/session/session-manager.ts");
      expect(slice.files).toContain("cph-main-agent-prompt.txt");

      // Verify compact micro-slice size (< 100KB)
      expect(slice.bytes).toBeGreaterThan(0);
      expect(slice.bytes).toBeLessThan(100 * 1024);

      const content = fs.readFileSync(slice.slicePath, "utf-8");
      expect(content).toContain("FILE: src/session/session-manager.ts");
      expect(content).toContain("PREREQUISITE REPORT: cph-main-agent-prompt.txt");
    });
  });
});
