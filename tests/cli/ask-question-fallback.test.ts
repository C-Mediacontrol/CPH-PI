import { describe, expect, it } from "bun:test";
import { CphPiCli } from "../../src/cli.ts";

describe("ask_question non-interactive fallback", () => {
  it("returns an honest QUESTION_UNAVAILABLE message instead of a fake confirmation", async () => {
    const cli = new CphPiCli({ workspaceRoot: process.cwd(), isInteractive: false } as any);
    const answer = await cli.handleInteractiveQuestion({
      question: "请确认是否继续",
      options: ["继续", "取消"],
    } as any);

    expect(answer).toContain("QUESTION_UNAVAILABLE");
    expect(answer).toContain("FINAL_ANSWER");
    expect(answer).not.toContain("Auto-confirmed");
  });
});
