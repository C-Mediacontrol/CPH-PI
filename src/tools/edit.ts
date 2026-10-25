import { access as fsAccess, readFile as fsReadFile, writeFile as fsWriteFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import * as Diff from "diff";
import type { Tool, ToolResult, EditToolInput, SingleEdit } from "./types.ts";

export interface EditOperations {
  readFile: (absolutePath: string) => Promise<Buffer>;
  writeFile: (absolutePath: string, content: string) => Promise<void>;
  access: (absolutePath: string) => Promise<void>;
}

const defaultEditOperations: EditOperations = {
  readFile: (p) => fsReadFile(p),
  writeFile: (p, content) => fsWriteFile(p, content, "utf-8"),
  access: (p) => fsAccess(p, constants.R_OK | constants.W_OK),
};

export interface EditToolOptions {
  operations?: EditOperations;
}

export function generateDiffString(oldContent: string, newContent: string, contextLines: number = 3): { diff: string; firstChangedLine?: number } {
  const parts = Diff.diffLines(oldContent, newContent);
  const output: string[] = [];

  const oldLines = oldContent.split(/\r?\n/);
  const newLines = newContent.split(/\r?\n/);
  const maxLineNum = Math.max(oldLines.length, newLines.length);
  const lineNumWidth = String(maxLineNum).length;

  let oldLineNum = 1;
  let newLineNum = 1;
  let lastWasChange = false;
  let firstChangedLine: number | undefined;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const raw = part.value.split(/\r?\n/);
    if (raw[raw.length - 1] === "") {
      raw.pop();
    }

    if (part.added || part.removed) {
      if (firstChangedLine === undefined && part.added) {
        firstChangedLine = newLineNum;
      }

      for (const line of raw) {
        if (part.added) {
          const num = String(newLineNum).padStart(lineNumWidth, " ");
          output.push(`+${num} ${line}`);
          newLineNum++;
        } else {
          const num = String(oldLineNum).padStart(lineNumWidth, " ");
          output.push(`-${num} ${line}`);
          oldLineNum++;
        }
      }
      lastWasChange = true;
    } else {
      const nextPartIsChange = i < parts.length - 1 && (parts[i + 1].added || parts[i + 1].removed);
      if (lastWasChange && nextPartIsChange) {
        if (raw.length <= contextLines * 2) {
          for (const line of raw) {
            const num = String(oldLineNum).padStart(lineNumWidth, " ");
            output.push(` ${num} ${line}`);
            oldLineNum++;
            newLineNum++;
          }
        } else {
          for (const line of raw.slice(0, contextLines)) {
            const num = String(oldLineNum).padStart(lineNumWidth, " ");
            output.push(` ${num} ${line}`);
            oldLineNum++;
            newLineNum++;
          }
          output.push(` ${"".padStart(lineNumWidth, " ")} ...`);
          const skipped = raw.length - contextLines * 2;
          oldLineNum += skipped;
          newLineNum += skipped;
          for (const line of raw.slice(raw.length - contextLines)) {
            const num = String(oldLineNum).padStart(lineNumWidth, " ");
            output.push(` ${num} ${line}`);
            oldLineNum++;
            newLineNum++;
          }
        }
      } else if (lastWasChange) {
        const shown = raw.slice(0, contextLines);
        for (const line of shown) {
          const num = String(oldLineNum).padStart(lineNumWidth, " ");
          output.push(` ${num} ${line}`);
          oldLineNum++;
          newLineNum++;
        }
        if (raw.length > contextLines) {
          output.push(` ${"".padStart(lineNumWidth, " ")} ...`);
          const skipped = raw.length - contextLines;
          oldLineNum += skipped;
          newLineNum += skipped;
        }
      } else if (nextPartIsChange) {
        const skipped = Math.max(0, raw.length - contextLines);
        if (skipped > 0) {
          output.push(` ${"".padStart(lineNumWidth, " ")} ...`);
          oldLineNum += skipped;
          newLineNum += skipped;
        }
        for (const line of raw.slice(skipped)) {
          const num = String(oldLineNum).padStart(lineNumWidth, " ");
          output.push(` ${num} ${line}`);
          oldLineNum++;
          newLineNum++;
        }
      } else {
        oldLineNum += raw.length;
        newLineNum += raw.length;
      }
      lastWasChange = false;
    }
  }

  return { diff: output.join("\n"), firstChangedLine };
}

export function createEditTool(cwd: string, options?: EditToolOptions): Tool<EditToolInput> {
  const ops = options?.operations ?? defaultEditOperations;

  return {
    name: "edit",
    description: "Edit a single file using exact text replacement. Every edits[].oldText must match a unique region of the original file.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to the file to edit (relative or absolute)" },
        edits: {
          type: "array",
          items: {
            type: "object",
            properties: {
              oldText: { type: "string" },
              newText: { type: "string" },
            },
            required: ["oldText", "newText"],
          },
        },
      },
      required: ["path", "edits"],
    },
    execute: async (_toolCallId: string, params: EditToolInput, signal?: AbortSignal): Promise<ToolResult> => {
      if (signal?.aborted) {
        throw new Error("Operation aborted");
      }

      const filePath = params.path;
      if (!filePath) {
        throw new Error("path parameter is required for edit tool");
      }

      const edits: SingleEdit[] = params.edits || [];
      if (!Array.isArray(edits) || edits.length === 0) {
        throw new Error("Edit tool input is invalid. edits must contain at least one replacement.");
      }

      const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath);

      try {
        await ops.access(absolutePath);
      } catch (err: any) {
        throw new Error(`Could not edit file: ${filePath}. File does not exist or is not accessible.`);
      }

      const buffer = await ops.readFile(absolutePath);
      if (signal?.aborted) {
        throw new Error("Operation aborted");
      }

      const originalRawContent = buffer.toString("utf-8");
      // Normalize line endings to LF for consistent replacement, detecting CRLF
      const isCrlf = originalRawContent.includes("\r\n");
      let currentContent = originalRawContent.replace(/\r\n/g, "\n");

      // Validate each edit's uniqueness and presence before modifying
      for (let i = 0; i < edits.length; i++) {
        const edit = edits[i];
        const oldText = (edit.oldText ?? "").replace(/\r\n/g, "\n");

        if (!oldText) {
          throw new Error(
            edits.length === 1
              ? `oldText must not be empty in ${filePath}.`
              : `edits[${i}].oldText must not be empty in ${filePath}.`
          );
        }

        const occurrences = currentContent.split(oldText).length - 1;
        if (occurrences === 0) {
          throw new Error(
            edits.length === 1
              ? `Could not find the exact text in ${filePath}. The old text must match exactly including all whitespace and newlines.`
              : `Could not find edits[${i}] in ${filePath}. The oldText must match exactly including all whitespace and newlines.`
          );
        }

        if (occurrences > 1) {
          throw new Error(
            edits.length === 1
              ? `Found ${occurrences} occurrences of the text in ${filePath}. The text must be unique. Please provide more context to make it unique.`
              : `Found ${occurrences} occurrences of edits[${i}] in ${filePath}. Each oldText must be unique. Please provide more context to make it unique.`
          );
        }

        currentContent = currentContent.replace(oldText, (edit.newText ?? "").replace(/\r\n/g, "\n"));
      }

      // Restore CRLF if file originally had CRLF
      const finalContent = isCrlf ? currentContent.replace(/\n/g, "\r\n") : currentContent;

      if (signal?.aborted) {
        throw new Error("Operation aborted");
      }

      await ops.writeFile(absolutePath, finalContent);

      const diffResult = generateDiffString(
        originalRawContent.replace(/\r\n/g, "\n"),
        currentContent
      );
      const patch = Diff.createTwoFilesPatch(
        filePath,
        filePath,
        originalRawContent.replace(/\r\n/g, "\n"),
        currentContent
      );

      return {
        content: [
          {
            type: "text",
            text: `Successfully replaced ${edits.length} block(s) in ${filePath}.`,
          },
        ],
        details: {
          diff: diffResult.diff,
          patch,
          firstChangedLine: diffResult.firstChangedLine,
        },
      };
    },
  };
}

