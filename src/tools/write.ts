import { mkdir as fsMkdir, writeFile as fsWriteFile } from "node:fs/promises";
import path from "node:path";
import type { Tool, ToolResult, WriteToolInput } from "./types.ts";

export interface WriteOperations {
  writeFile: (absolutePath: string, content: string) => Promise<void>;
  mkdir: (dir: string) => Promise<void>;
}

const defaultWriteOperations: WriteOperations = {
  writeFile: (p, content) => fsWriteFile(p, content, "utf-8"),
  mkdir: (dir) => fsMkdir(dir, { recursive: true }).then(() => {}),
};

export interface WriteToolOptions {
  operations?: WriteOperations;
}

export function createWriteTool(cwd: string, options?: WriteToolOptions): Tool<WriteToolInput> {
  const ops = options?.operations ?? defaultWriteOperations;

  return {
    name: "write",
    description: "Write content to a file. Creates the file if it does not exist, overwrites if it does. Automatically creates parent directories.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to the file to write (relative or absolute)" },
        content: { type: "string", description: "Content to write to the file" },
      },
      required: ["path", "content"],
    },
    execute: async (_toolCallId: string, params: WriteToolInput, signal?: AbortSignal): Promise<ToolResult> => {
      if (signal?.aborted) {
        throw new Error("Operation aborted");
      }

      const filePath = params.path;
      if (!filePath) {
        throw new Error("path parameter is required for write tool");
      }

      const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath);
      const parentDir = path.dirname(absolutePath);

      await ops.mkdir(parentDir);
      if (signal?.aborted) {
        throw new Error("Operation aborted");
      }

      await ops.writeFile(absolutePath, params.content ?? "");
      if (signal?.aborted) {
        throw new Error("Operation aborted");
      }

      return {
        content: [{ type: "text", text: `Successfully wrote to ${filePath}` }],
        structuredContent: {
          path: filePath,
          bytesWritten: Buffer.byteLength(params.content ?? "", "utf-8"),
        },
      };
    },
  };
}

