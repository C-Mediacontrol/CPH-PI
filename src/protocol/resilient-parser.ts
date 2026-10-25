import type { CopilotAction, SubagentTaskSpec } from "./tool-bridge.ts";

export interface FinalAnswer {
  summary: string;
  raw: string;
}

export type ParsedTurn =
  | { type: "action"; thought: string; action: CopilotAction }
  | { type: "handoff"; thought: string; handoffDoc: string }
  | { type: "final_answer"; thought: string; answer: FinalAnswer }
  | { type: "empty_response"; thought: string }
  | { type: "invalid_chatter"; thought: string; warning: string };

export class ResilientParser {
  /**
   * Parse Copilot output text into a structured turn (Action | Handoff | FinalAnswer | InvalidChatter).
   * Supports standard ```action, ```handoff, ```json, generic ``` blocks, unfenced streaming text,
   * shorthand tool syntax, and various completion markers.
   */
  public static parse(text: string): ParsedTurn {
    const trimmed = (text || "").trim();

    if (!trimmed || trimmed.length === 0) {
      return {
        type: "empty_response",
        thought: "",
      };
    }

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

    // 1. Check for explicit action fenced blocks: ```action, ```json:action, ```yaml:action
    const explicitActionMatch = trimmed.match(
      /```(?:action|json:action|yaml:action)\s*([\s\S]*?)```/i
    );
    if (explicitActionMatch) {
      const actionContent = explicitActionMatch[1].trim();
      const thoughtMatch = trimmed.match(/(?:THOUGHT:|^)([\s\S]*?)```/i);
      const thought = thoughtMatch
        ? thoughtMatch[1].replace(/^THOUGHT:\s*/i, "").trim()
        : "";
      const parsedAction = this.extractActionFields(actionContent);
      if (parsedAction) {
        return {
          type: "action",
          thought,
          action: parsedAction,
        };
      }
    }

    // 2. Check for Final Answer (strictly matching FINAL_ANSWER variants or completion tags)
    // Checked BEFORE generic code blocks and unfenced action patterns
    const finalAnswerMatch = trimmed.match(
      /(?:^|\n)\s*(?:```(?:markdown:)?FINAL_?ANSWER\b:?|FINAL_?ANSWER\b:?|_ANSWER\b:?|ALL_TASKS_COMPLETED|【已完成交付】)([\s\S]*)$/i
    );
    if (finalAnswerMatch) {
      const rawSummary = finalAnswerMatch[1].trim();
      const isFencedFinal = finalAnswerMatch[0].trimStart().startsWith("```");
      const summary = (isFencedFinal ? rawSummary.replace(/```\s*$/, "") : rawSummary).trim();
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

    // 2b. Direct completion indicators in body
    if (
      trimmed.includes("ALL_TASKS_COMPLETED") ||
      trimmed.includes("【已完成交付】")
    ) {
      return {
        type: "final_answer",
        thought: "",
        answer: { summary: trimmed, raw: trimmed },
      };
    }

    // 3. Fallback Action blocks (generic ```json or ``` code fences, or unfenced actions)
    // 3a. Code fenced: ```json ... ``` or ``` ... ``` containing tool/action
    const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    let actionContent: string | null = null;
    let thought = "";

    if (fencedMatch) {
      actionContent = fencedMatch[1].trim();
      const thoughtMatch = trimmed.match(/(?:THOUGHT:|^)([\s\S]*?)```/i);
      thought = thoughtMatch
        ? thoughtMatch[1].replace(/^THOUGHT:\s*/i, "").trim()
        : "";
    } else {
      // 3b. Un-fenced action: handles streaming without backticks, e.g. "tool: read_file..."
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

    // 4. Check for Native File Generation / Download cards (File Porter pattern)
    // HTML anchor: <a ... href="url" download="filename" ...> or <a ... download="filename" href="url" ...>
    // or Markdown: [下载 filename](blob:url) or [filename](blob:url)
    const anchorMatch =
      trimmed.match(/<a\s+[^>]*href=["']([^"']+)["'][^>]*download=["']([^"']+)["'][^>]*>/i) ||
      trimmed.match(/<a\s+[^>]*download=["']([^"']+)["'][^>]*href=["']([^"']+)["'][^>]*>/i);

    let detectedFileName: string | null = null;
    let detectedUrl: string | null = null;

    if (anchorMatch) {
      const p1 = anchorMatch[1];
      const p2 = anchorMatch[2];
      if (p1.startsWith("blob:") || p1.startsWith("http")) {
        detectedUrl = p1;
        detectedFileName = p2;
      } else if (p2.startsWith("blob:") || p2.startsWith("http")) {
        detectedUrl = p2;
        detectedFileName = p1;
      }
    } else {
      // Check Markdown link: [下载 filename.ext](blob:url) or [filename.ext](blob:url)
      // Only match blob: links (generic https?:// links in text are ignored to avoid hijacking normal conversational links)
      const mdLinkMatch = trimmed.match(
        /\[(?:下载\s*)?([a-zA-Z0-9_\-.]+\.[a-zA-Z0-9_]+)\]\((blob:[^\)\s]+)\)/i
      );
      if (mdLinkMatch) {
        detectedFileName = mdLinkMatch[1];
        detectedUrl = mdLinkMatch[2];
      }
    }

    if (detectedFileName && detectedUrl) {
      const thought = trimmed
        .split(/<a|\[(?:下载\s*)?[a-zA-Z0-9_\-.]+\.[a-zA-Z0-9_]+\]/i)[0]
        .replace(/^THOUGHT:\s*/i, "")
        .trim();

      return {
        type: "action",
        thought,
        action: {
          tool: "file_porter",
          fileName: detectedFileName,
          downloadUrl: detectedUrl,
          autoExecute: false,
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
                  stage: Number(s.stage) || 1,
                };
              });
            }
            const fileName = obj.fileName || obj.filename || obj.file || (tool === "file_porter" ? (obj.name || obj.path) : undefined);
            const downloadUrl = obj.downloadUrl || obj.download_url || obj.url || obj.href;
            const autoExecute = Boolean(obj.autoExecute ?? obj.auto_execute ?? false);
            return {
              ...obj,
              tool,
              ...(fileName ? { fileName } : {}),
              ...(downloadUrl ? { downloadUrl } : {}),
              autoExecute,
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
      const fileNameMatch = contentToScan.match(/(?:fileName|filename|file|name)\s*:\s*([^\r\n]+)/i);
      const urlMatch = contentToScan.match(/(?:downloadUrl|download_url|url|href)\s*:\s*([^\r\n]+)/i);
      const autoExecMatch = contentToScan.match(/(?:autoExecute|auto_execute)\s*:\s*(true|false)/i);
      const startLineMatch = contentToScan.match(
        /(?:start_line|startLine|offset)\s*:\s*(\d+)/i
      );
      const endLineMatch = contentToScan.match(/(?:end_line|endLine)\s*:\s*(\d+)/i);
      const limitMatch = contentToScan.match(/(?:limit|lines)\s*:\s*(\d+)/i);
      const cmdMatch = contentToScan.match(/(?:command|cmd)\s*:\s*([^\r\n]+)/i);
      const timeoutMatch = contentToScan.match(/timeout\s*:\s*(\d+)/i);
      const patternMatch = contentToScan.match(/pattern\s*:\s*([^\r\n]+)/i);
      const contentMatch = contentToScan.match(
        /content\s*:\s*([\s\S]*?)(?=\r?\n\s*(?:path|tool|file|action)\s*:|$)/i
      );
      const oldStrMatch = contentToScan.match(
        /(?:old_string|oldstring|old_text|oldText)\s*:\s*([\s\S]*?)(?=\n(?:new_string|newstring|new_text|newText|tool|path)\s*:|$)/i
      );
      const newStrMatch = contentToScan.match(
        /(?:new_string|newstring|new_text|newText)\s*:\s*([\s\S]*?)(?=\n(?:tool|path|old_string)\s*:|$)/i
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

      const extractedFileName = fileNameMatch
        ? fileNameMatch[1].trim().replace(/^['"]|['"]$/g, "")
        : undefined;
      const extractedUrl = urlMatch
        ? urlMatch[1].trim().replace(/^['"]|['"]$/g, "")
        : undefined;
      const extractedAutoExec = autoExecMatch
        ? autoExecMatch[1].toLowerCase() === "true"
        : false;

      // If we found any relevant fields, or this is a parameterless tool, return it
      const hasFields =
        pathMatch ||
        fileNameMatch ||
        urlMatch ||
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
          fileName: extractedFileName,
          downloadUrl: extractedUrl,
          autoExecute: extractedAutoExec,
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
              stage: Number(s.stage) || 1,
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
      const stageMatch = block.match(/(?:^|\n)\s*stage\s*:\s*(\d+)/i);

      if (roleMatch || promptMatch) {
        let rawRole = (roleMatch ? roleMatch[1].trim().toLowerCase() : "researcher");
        if (rawRole === "searcher") rawRole = "researcher";
        const role = (rawRole === "coder" ? "coder" : "researcher") as "researcher" | "coder";
        subagents.push({
          role,
          description: descMatch ? descMatch[1].trim() : "",
          prompt: promptMatch ? promptMatch[1].trim() : "",
          maxTurns: maxTurnsMatch ? parseInt(maxTurnsMatch[1], 10) : undefined,
          stage: stageMatch ? parseInt(stageMatch[1], 10) : 1,
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
      case "file_porter":
      case "execute_file":
      case "porter":
        return "file_porter";
      default:
        return null;
    }
  }
}
