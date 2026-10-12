import type { CopilotAction, SubagentTaskSpec } from "./tool-bridge.ts";

export interface FinalAnswer {
  summary: string;
  raw: string;
}

export type ParsedTurn =
  | { type: "action"; thought: string; action: CopilotAction }
  | { type: "handoff"; thought: string; handoffDoc: string }
  | { type: "final_answer"; thought: string; answer: FinalAnswer }
  | { type: "invalid_chatter"; thought: string; warning: string };

export class ResilientParser {
  /**
   * Parse Copilot output text into a structured turn (Action | Handoff | FinalAnswer | InvalidChatter).
   * Supports standard ```action, ```handoff, ```json, generic ``` blocks, unfenced streaming text,
   * shorthand tool syntax, and various completion markers.
   */
  public static parse(text: string): ParsedTurn {
    const trimmed = (text || "").trim();

    // 0. Check for Handoff fenced block
    const handoffMatch = trimmed.match(/```handoff\s*([\s\S]*?)```/i);
    if (handoffMatch) {
      const handoffDoc = handoffMatch[1].trim();
      const thoughtMatch = trimmed.match(/(?:THOUGHT:|^)([\s\S]*?)```handoff/i);
      const thought = thoughtMatch
        ? thoughtMatch[1].replace(/^THOUGHT:\s*/i, "").trim()
        : "";
      return {
        type: "handoff",
        thought,
        handoffDoc,
      };
    }

    // 1. Check for Action blocks
    const actionBlock = this.extractActionBlock(trimmed);
    let actionContent: string | null = null;
    let thought = "";

    if (actionBlock) {
      actionContent = actionBlock.actionContent;
      thought = actionBlock.thought;
    } else {
      // 1b. Un-fenced action: handles streaming without backticks, e.g. "tool: read_file..."
      const unfencedMatch =
        trimmed.match(
          /(?:^|[^\w])(?:action\s*\n\s*)?(tool\s*:\s*[a-zA-Z_]+[\s\S]*?)(?:```|$|\n\n(?=[A-Z_]+:))/i
        ) ||
        trimmed.match(
          /(?:^|[^\w])(?:ACTION|tool_call>)\s*:?\s*([\s\S]*?)(?:```|$|\n\n(?=[A-Z_]+:))/i
        );

      if (unfencedMatch) {
        actionContent = unfencedMatch[1].trim();
        const beforeAction = trimmed.slice(0, unfencedMatch.index).trim();
        thought = beforeAction.replace(/^THOUGHT:\s*/i, "").trim();
      }
    }

    if (actionContent) {
      const parsedAction = this.extractActionFields(actionContent);
      if (parsedAction) {
        return {
          type: "action",
          thought,
          action: parsedAction,
        };
      }
    }

    // 2. Check for Final Answer
    // Matches:
    // - FINAL_ANSWER: or FINALANSWER: anywhere as an explicit marker
    // - ALL_TASKS_COMPLETED or 【已完成交付】 strictly as a standalone line marker
    const finalAnswerMatch =
      trimmed.match(/(?:FINAL_?ANSWER\b:?|_ANSWER\b:?)([\s\S]*)$/i) ||
      trimmed.match(/(?:^|\n)\s*(?:ALL_TASKS_COMPLETED|【已完成交付】)(?::|\s|$)([\s\S]*)$/i);

    if (finalAnswerMatch) {
      const summary = finalAnswerMatch[1].trim();
      const markerIndex = finalAnswerMatch.index ?? -1;
      const parsedThought =
        markerIndex > 0
          ? trimmed
              .slice(0, markerIndex)
              .replace(/^THOUGHT:\s*/i, "")
              .trim()
          : "";

      return {
        type: "final_answer",
        thought: parsedThought,
        answer: {
          summary: summary || trimmed,
          raw: trimmed,
        },
      };
    }

    // 3. Fallback: Invalid Chatter
    return {
      type: "invalid_chatter",
      thought: trimmed,
      warning:
        "[Harness 纠偏提示: 请按协议约定操作：若需继续执行，请在 ```action ... ``` 块中调用工具；若已完成所有工作，请直接输出 FINAL_ANSWER: 交付总结。]",
    };
  }

  /**
   * Extracts fenced action block content supporting nested code fences.
   */
  private static extractActionBlock(
    trimmed: string
  ): { actionContent: string; thought: string } | null {
    // 1. Check for 4+ backtick outer fence: ````action ... ```` or ````json ... ```` or ```` ... ````
    const multiTickMatch = trimmed.match(
      /(?:THOUGHT:|^)([\s\S]*?)(`{4,}|~{4,})(?:action|json)?\s*\n?([\s\S]*?)\n?\2/i
    );
    if (multiTickMatch) {
      const thoughtMatch = trimmed.match(/(?:THOUGHT:|^)([\s\S]*?)(`{4,}|~{4,})/i);
      const thought = thoughtMatch
        ? thoughtMatch[1].replace(/^THOUGHT:\s*/i, "").trim()
        : "";
      return { actionContent: multiTickMatch[3].trim(), thought };
    }

    // 2. Check for 3-backtick fence: ```action, ```json, or ``` containing tool/action
    const openMatch = trimmed.match(/(?:THOUGHT:|^)([\s\S]*?)```(?:action|json)?\s*\n?/i);
    if (!openMatch) {
      return null;
    }

    const thought = openMatch[1].replace(/^THOUGHT:\s*/i, "").trim();
    const startIndex = openMatch.index! + openMatch[0].length;
    const rest = trimmed.slice(startIndex);

    // Scan lines in rest to find the matching outer closing ```
    const lines = rest.split(/\r?\n/);
    let depth = 0;
    let closingLineIndex = -1;

    for (let i = 0; i < lines.length; i++) {
      const lineTrim = lines[i].trim();

      if (lineTrim.startsWith("```") || lineTrim.startsWith("~~~")) {
        const isFenceClose = /^(?:```+|~~~+)\s*$/.test(lineTrim);
        const hasLangTag = /^(?:```+|~~~+)[a-zA-Z0-9_-]+\s*$/.test(lineTrim);

        if (hasLangTag) {
          depth++;
        } else if (isFenceClose) {
          if (depth > 0) {
            depth--;
          } else {
            const remainingFences = lines
              .slice(i + 1)
              .filter((l) => /^(?:```+|~~~+)\s*$/.test(l.trim())).length;
            if (remainingFences >= 2 && remainingFences % 2 === 0) {
              depth++;
            } else {
              closingLineIndex = i;
              break;
            }
          }
        }
      }
    }

    if (closingLineIndex !== -1) {
      return {
        actionContent: lines.slice(0, closingLineIndex).join("\n").trim(),
        thought,
      };
    }

    const lastFenceIndex = rest.lastIndexOf("```");
    return {
      actionContent:
        lastFenceIndex !== -1 ? rest.slice(0, lastFenceIndex).trim() : rest.trim(),
      thought,
    };
  }

  /**
   * Extracts CopilotAction from either JSON, YAML-like key-value pairs, or shorthand syntax.
   */
  private static extractActionFields(content: string): CopilotAction | null {
    const trimmed = content.trim();

    // A. Check JSON object syntax
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      try {
        const obj = JSON.parse(trimmed);
        if (typeof obj === "object" && obj !== null) {
          const rawTool = (obj.tool || obj.action || obj.name || "").toString();
          if (rawTool) {
            const tool = this.normalizeToolName(rawTool) || rawTool;
            let subagents = obj.subagents;
            if (tool === "invoke_subagent" && Array.isArray(subagents)) {
              subagents = subagents.map((s: any) => {
                let rawRole = (s.role ? String(s.role).trim().toLowerCase() : "researcher");
                if (rawRole === "searcher") rawRole = "researcher";
                const role = (rawRole === "coder" ? "coder" : "researcher") as "researcher" | "coder";
                return {
                  ...s,
                  role,
                };
              });
            }
            return {
              ...obj,
              tool,
              ...(subagents ? { subagents } : {}),
            };
          }
        }
      } catch {
        // Fall through to YAML/regex parsing on malformed JSON
      }
    }

    // B. Check structured format: tool: <name> or action: <name> or first line is a tool name
    let tool: string | null = null;
    let contentToScan = trimmed;

    const toolMatch =
      trimmed.match(/tool\s*:\s*([a-zA-Z_]+)/i) ||
      trimmed.match(/action\s*:\s*([a-zA-Z_]+)/i);

    if (toolMatch) {
      const rawTool = toolMatch[1].toLowerCase();
      tool = this.normalizeToolName(rawTool) || rawTool;
    } else {
      // Check if first line is simply the tool name: e.g. "read_file\npath: ..."
      const firstLine = trimmed.split("\n")[0].trim();
      const directTool = this.normalizeToolName(firstLine);
      if (directTool) {
        tool = directTool;
      }
    }

    if (tool) {
      if (tool === "invoke_subagent") {
        const subagents = this.parseSubagentsBlock(contentToScan);
        return {
          tool: "invoke_subagent",
          subagents,
          raw: trimmed,
        };
      }
      const pathMatch = contentToScan.match(/(?:path|filePath|file)\s*:\s*([^\r\n]+)/i);
      const startLineMatch = contentToScan.match(
        /(?:start_line|startLine|offset)\s*:\s*(\d+)/i
      );
      const endLineMatch = contentToScan.match(/(?:end_line|endLine)\s*:\s*(\d+)/i);
      const limitMatch = contentToScan.match(/(?:limit|lines)\s*:\s*(\d+)/i);
      const cmdMatch = contentToScan.match(/(?:command|cmd)\s*:\s*([^\r\n]+)/i);
      const timeoutMatch = contentToScan.match(/timeout\s*:\s*(\d+)/i);
      const patternMatch = contentToScan.match(/pattern\s*:\s*([^\r\n]+)/i);
      const contentMatch = contentToScan.match(/content\s*:\s*([\s\S]*)$/i);
      const oldStrMatch = contentToScan.match(
        /(?:old_string|oldstring|old_text|oldText)\s*:\s*([\s\S]*?)(?=\n(?:new_string|newstring|new_text|newText)\s*:|$)/i
      );
      const newStrMatch = contentToScan.match(
        /(?:new_string|newstring|new_text|newText)\s*:\s*([\s\S]*?)(?=\n(?:old_string|oldstring|old_text|oldText)\s*:|$)/i
      );
      const questionMatch = contentToScan.match(
        /(?:question|prompt|message)\s*:\s*([^\r\n]+)/i
      );
      const optionsMatch = contentToScan.match(/options?\s*:\s*([^\r\n]+)/i);

      let question = questionMatch ? questionMatch[1].trim() : undefined;
      const options = optionsMatch ? optionsMatch[1].trim() : undefined;

      // Special fallback for ask_question if question isn't explicitly tagged
      if ((tool === "ask_question" || tool === "question") && !question) {
        const withoutTool = contentToScan
          .replace(/(?:tool|action)\s*:\s*[a-zA-Z_]+/i, "")
          .trim();
        const cleanQuestion = withoutTool
          .replace(/options?\s*:\s*[^\r\n]+/i, "")
          .trim();
        if (cleanQuestion) {
          question = cleanQuestion;
        }
      }

      // If we found any relevant fields, or this is a parameterless tool, return it
      const hasFields =
        pathMatch ||
        startLineMatch ||
        cmdMatch ||
        contentMatch ||
        oldStrMatch ||
        newStrMatch ||
        question;

      if (hasFields) {
        return {
          tool,
          path: pathMatch
            ? pathMatch[1].trim().replace(/^['"]|['"]$/g, "")
            : undefined,
          start_line: startLineMatch ? parseInt(startLineMatch[1], 10) : undefined,
          end_line: endLineMatch ? parseInt(endLineMatch[1], 10) : undefined,
          limit: limitMatch ? parseInt(limitMatch[1], 10) : undefined,
          command: cmdMatch ? cmdMatch[1].trim() : undefined,
          timeout: timeoutMatch ? parseInt(timeoutMatch[1], 10) : undefined,
          pattern: patternMatch ? patternMatch[1].trim() : undefined,
          content: contentMatch ? contentMatch[1].trim() : undefined,
          old_string: oldStrMatch ? oldStrMatch[1].trim() : undefined,
          new_string: newStrMatch ? newStrMatch[1].trim() : undefined,
          question,
          options,
          raw: trimmed,
        };
      }
    }

    // C. Check shorthand format: <tool_name> <path/args>
    const firstLine = trimmed.split("\n")[0].trim();
    const parts = firstLine.split(/\s+/);
    const candidateTool = this.normalizeToolName(parts[0].toLowerCase());
    if (candidateTool) {
      const remainder = trimmed.slice(parts[0].length).trim();
      switch (candidateTool) {
        case "read_file":
          return { tool: "read_file", path: parts[1], raw: trimmed };
        case "write_file": {
          const lines = trimmed.split("\n");
          const targetPath = lines[0].replace(/^[a-zA-Z_]+\s+/, "").trim();
          const fileContent = lines.slice(1).join("\n");
          return {
            tool: "write_file",
            path: targetPath,
            content: fileContent,
            raw: trimmed,
          };
        }
        case "run_command":
          return { tool: "run_command", command: remainder, raw: trimmed };
        case "ask_question":
          return { tool: "ask_question", question: remainder, raw: trimmed };
      }
    }

    return null;
  }

  /**
   * Parses subagents task specifications from YAML-like or JSON block content.
   */
  private static parseSubagentsBlock(content: string): SubagentTaskSpec[] {
    const normalized = content.replace(/\r\n/g, "\n");

    const jsonArrayMatch = normalized.match(/subagents\s*:\s*(\[[\s\S]*\])/i);
    if (jsonArrayMatch) {
      try {
        const arr = JSON.parse(jsonArrayMatch[1]);
        if (Array.isArray(arr)) {
          return arr.map((s: any) => {
            let rawRole = (s.role ? String(s.role).trim().toLowerCase() : "researcher");
            if (rawRole === "searcher") rawRole = "researcher";
            const role = (rawRole === "coder" ? "coder" : "researcher") as "researcher" | "coder";
            return {
              role,
              description: s.description ? String(s.description).trim() : "",
              prompt: s.prompt ? String(s.prompt).trim() : "",
              maxTurns: typeof s.maxTurns === "number" ? s.maxTurns : undefined,
            };
          });
        }
      } catch {
        // Fall back to YAML block parsing
      }
    }

    const subagents: SubagentTaskSpec[] = [];
    // 匹配 YAML 列表项格式: - role: ...
    const blocks = ("\n" + normalized).split(/\n\s*-\s+/);
    for (let i = 1; i < blocks.length; i++) {
      const block = blocks[i];
      const roleMatch = block.match(/role\s*:\s*([a-zA-Z_]+)/i);
      const descMatch = block.match(/description\s*:\s*([^\r\n]+)/i);
      const promptMatch = block.match(/prompt\s*:\s*([\s\S]*?)(?=\n\s*[a-zA-Z_]+\s*:|$)/i);
      const maxTurnsMatch = block.match(/maxTurns\s*:\s*(\d+)/i);

      if (roleMatch || promptMatch) {
        let rawRole = (roleMatch ? roleMatch[1].trim().toLowerCase() : "researcher");
        if (rawRole === "searcher") rawRole = "researcher";
        const role = (rawRole === "coder" ? "coder" : "researcher") as "researcher" | "coder";
        subagents.push({
          role,
          description: descMatch ? descMatch[1].trim() : "",
          prompt: promptMatch ? promptMatch[1].trim() : "",
          maxTurns: maxTurnsMatch ? parseInt(maxTurnsMatch[1], 10) : undefined,
        });
      }
    }
    return subagents;
  }

  /**
   * Normalizes tool aliases into canonical CopilotAction names.
   */
  private static normalizeToolName(name: string): string | null {
    switch (name.toLowerCase()) {
      case "read_file":
      case "read":
      case "cat":
        return "read_file";
      case "edit":
      case "edit_file":
      case "patch":
      case "patch_file":
        return "edit";
      case "write_file":
      case "write":
        return "write_file";
      case "run_command":
      case "bash":
      case "exec":
      case "sh":
        return "run_command";
      case "ask_question":
      case "ask_user":
      case "question":
        return "ask_question";
      case "invoke_subagent":
      case "subagent":
        return "invoke_subagent";
      default:
        return null;
    }
  }
}
