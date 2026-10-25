export * from "./types.ts";
export * from "./read.ts";
export * from "./write.ts";
export * from "./edit.ts";
export * from "./bash.ts";

import { createReadTool, type ReadToolOptions } from "./read.ts";
import { createWriteTool, type WriteToolOptions } from "./write.ts";
import { createEditTool, type EditToolOptions } from "./edit.ts";
import { createBashTool } from "./bash.ts";
import type { Tool, BashToolOptions } from "./types.ts";

export interface CodingToolsOptions {
  read?: ReadToolOptions;
  write?: WriteToolOptions;
  edit?: EditToolOptions;
  bash?: BashToolOptions;
}

export function createCodingTools(cwd: string, options?: CodingToolsOptions): Tool[] {
  return [
    createReadTool(cwd, options?.read),
    createBashTool(cwd, options?.bash),
    createEditTool(cwd, options?.edit),
    createWriteTool(cwd, options?.write),
  ];
}

