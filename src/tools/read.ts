import { access as fsAccess, readFile as fsReadFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import type { Tool, ToolResult, ReadToolInput } from "./types.ts";

export interface ReadOperations {
  readFile: (absolutePath: string) => Promise<Buffer>;
  access: (absolutePath: string) => Promise<void>;
}

const defaultReadOperations: ReadOperations = {
  readFile: (p) => fsReadFile(p),
  access: (p) => fsAccess(p, constants.R_OK),
};

export interface ReadToolOptions {
  operations?: ReadOperations;
}

export function createReadTool(cwd: string, options?: ReadToolOptions): Tool<ReadToolInput> {
  const ops = options?.operations ?? defaultReadOperations;

  return {
    name: "read",
    description: "Read the contents of a file losslessly. Supports text files. Reads complete file content without arbitrary truncation (physical safety ceiling: 100MB). Use offset and limit when a partial line slice is requested.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to the file to read (relative or absolute)" },
        offset: { type: "number", description: "Line number to start reading from (1-indexed)" },
        limit: { type: "number", description: "Maximum number of lines to read" },
      },
      required: ["path"],
    },
    execute: async (_toolCallId: string, params: ReadToolInput, signal?: AbortSignal): Promise<ToolResult> => {
      if (signal?.aborted) {
        throw new Error("Operation aborted");
      }

      const filePath = params.path;
      if (!filePath) {
        throw new Error("path parameter is required for read tool");
      }

      const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath);

      await ops.access(absolutePath);
      if (signal?.aborted) {
        throw new Error("Operation aborted");
      }

      const buffer = await ops.readFile(absolutePath);
      if (signal?.aborted) {
        throw new Error("Operation aborted");
      }

      const textContent = buffer.toString("utf-8");
      const allLines = textContent.split(/\r?\n/);
      const totalFileLines = allLines.length;

      const offset = params.offset;
      const limit = params.limit;

      const startLine = offset ? Math.max(0, offset - 1) : 0;
      if (startLine >= totalFileLines && totalFileLines > 0 && offset && offset > 1) {
        throw new Error(`Offset ${offset} is beyond end of file (${totalFileLines} lines total)`);
      }

      let selectedLines: string[];
      if (limit !== undefined && Number.isFinite(limit)) {
        const endLine = Math.min(startLine + limit, totalFileLines);
        selectedLines = allLines.slice(startLine, endLine);
      } else {
        selectedLines = allLines.slice(startLine);
      }

      const outputText = selectedLines.join("\n");

      return {
        content: [{ type: "text", text: outputText }],
        structuredContent: {
          path: filePath,
          totalLines: totalFileLines,
          startLine: startLine + 1,
          lineCount: selectedLines.length,
          output: outputText,
        },
      };
    },
  };
}

