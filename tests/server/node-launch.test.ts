import { describe, it, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import path from "node:path";

describe("Node.js Native Runtime Launcher Test", () => {
  const cliPath = path.resolve(__dirname, "../../src/cli.ts");
  const projectRoot = path.resolve(__dirname, "../..");

  it("should successfully launch CLI via Node.js with tsx --help", () => {
    const result = spawnSync("node", ["--import", "tsx", cliPath, "--help"], {
      cwd: projectRoot,
      encoding: "utf-8",
      env: { ...process.env },
    });

    expect(result.status).toBe(0);
    const stdout = (result.stdout || "").toLowerCase();
    expect(stdout).toContain("cph-pi");
    expect(stdout).toContain("web");
  });

  it("should successfully launch CLI via Node.js with tsx --version", () => {
    const result = spawnSync("node", ["--import", "tsx", cliPath, "--version"], {
      cwd: projectRoot,
      encoding: "utf-8",
      env: { ...process.env },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("CPH-PI");
  });
});
