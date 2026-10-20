import { describe, it, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";

describe("DeepSeek-Harness Official Design System & Theme Tokens (Task 2)", () => {
  const cssPath = path.resolve(__dirname, "../../web/src/index.css");
  const tailwindPath = path.resolve(__dirname, "../../web/tailwind.config.js");

  it("should contain official DeepSeek CSS variables in web/src/index.css", () => {
    const content = fs.readFileSync(cssPath, "utf-8");

    // Official brand and static colors
    expect(content).toContain("--dsw-static-deepseek-500: rgb(65, 118, 230);");
    expect(content).toContain("--dsw-static-deepseek-400: rgb(122, 170, 255);");
    expect(content).toContain("--dsw-static-neutral-bluish-1000: rgb(15, 17, 21);");
    expect(content).toContain("--dsw-static-neutral-bluish-900: rgb(27, 27, 28);");
    expect(content).toContain("--dsw-static-neutral-bluish-850: rgb(44, 44, 46);");
    expect(content).toContain("--dsw-static-green-500: rgb(34, 197, 94);");
    expect(content).toContain("--dsw-static-red-500: rgb(239, 68, 68);");
  });

  it("should define tabular numbers font style/helper in web/src/index.css", () => {
    const content = fs.readFileSync(cssPath, "utf-8");
    expect(content).toContain("tabular-nums");
  });

  it("should define root/body dark theme defaults matching DeepSeek palette in web/src/index.css", () => {
    const content = fs.readFileSync(cssPath, "utf-8");
    // DeepSeek dark palette uses #0f1115 or rgb(15, 17, 21) as dark base
    const hasDeepSeekDarkBg = content.includes("#0f1115") || content.includes("rgb(15, 17, 21)");
    expect(hasDeepSeekDarkBg).toBe(true);
  });

  it("should define deepseek theme color extensions in web/tailwind.config.js", () => {
    const content = fs.readFileSync(tailwindPath, "utf-8");

    expect(content).toContain("deepseek");
    expect(content).toContain("400");
    expect(content).toContain("500");
    expect(content).toContain("600");
  });

  it("should define surface and border color palettes in web/tailwind.config.js", () => {
    const content = fs.readFileSync(tailwindPath, "utf-8");

    expect(content).toContain("surface");
    expect(content).toContain("#0f1115");
    expect(content).toContain("#151517");
    expect(content).toContain("#1b1b1c");
    expect(content).toContain("#232326");

    expect(content).toContain("border");
    expect(content).toContain("#2c2c2e");
    expect(content).toContain("rgba(255, 255, 255, 0.08)");
  });
});
