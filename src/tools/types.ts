/**
 * Core Tool contracts and interfaces for CPH-PI.
 * Decoupled from external pi framework.
 */

export interface ToolResult {
  content?: Array<{ type: "text"; text: string }>;
  structuredContent?: any;
  details?: { diff?: string; [key: string]: any };
  isError?: boolean;
}

export interface Tool<TInput = any, TOutput = any> {
  name: string;
  description: string;
  parameters?: any;
  execute: (
    toolCallId: string,
    params: TInput,
    signal?: AbortSignal
  ) => Promise<ToolResult>;
}

export interface BashOperations {
  exec: (
    command: string,
    cwd: string,
    options: {
      onData: (chunk: Buffer) => void;
      signal?: AbortSignal;
      timeout?: number;
    }
  ) => Promise<{ exitCode: number }>;
}

export interface BashToolOptions {
  operations?: BashOperations;
  shellPath?: string;
}

export interface ReadToolInput {
  path: string;
  offset?: number;
  limit?: number;
}

export interface SingleEdit {
  oldText: string;
  newText: string;
}

export interface EditToolInput {
  path: string;
  edits: SingleEdit[];
}

export interface WriteToolInput {
  path: string;
  content: string;
}

export interface BashToolInput {
  command: string;
  timeout?: number;
}

