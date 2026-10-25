#!/usr/bin/env bun
/**
 * pnp-sync-cli.ts - SharePoint Cloud Repo Sync CLI
 * Command-line tool for pre-warming, orphan pruning, and hot single-file sync.
 */
import path from "node:path";
import { PnPWorkspaceSyncEngine } from "./pnp-sync-engine.ts";

function printHelp(): void {
  console.log(`
SharePoint Cloud Repo Sync CLI (CPH-PI)
=======================================
Usage:
  bun run src/workspace/pnp-sync-cli.ts [options]

Commands & Options:
  --action, -a <name>        Action to perform: 'prewarm', 'sync-file', 'pull-file' (default: prewarm)
  --file, -f <relative_path> Target file path for 'sync-file' or 'pull-file'
  --workspace, -w <dir>      Workspace root directory (default: current working directory)
  --target-folder, -t <url>  SharePoint target folder server-relative URL
  --site-url, -s <url>       SharePoint site URL
  --hard-reset               Hard reset: delete and recreate remote target folder (Cold reset)
  --mock                     Use mock transport (offline testing)
  --help, -h                 Show this help message

Examples:
  # Prewarm and prune remote orphans
  bun run sync:prewarm

  # Hard reset target repository (Warning: triggers cold indexing lag)
  bun run sync:reset

  # Fast hot-sync a single modified file
  bun run sync:file --file src/kernel_calc.py
`);
}

function parseArgs(args: string[]): Record<string, any> {
  const parsed: Record<string, any> = {
    action: "prewarm",
    workspace: process.cwd(),
    targetFolder: PnPWorkspaceSyncEngine.DEFAULT_TARGET_FOLDER,
    siteUrl: PnPWorkspaceSyncEngine.DEFAULT_SITE_URL,
    hardReset: false,
    mock: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else if (arg === "--action" || arg === "-a") {
      parsed.action = args[++i];
    } else if (arg === "--file" || arg === "-f") {
      parsed.file = args[++i];
    } else if (arg === "--workspace" || arg === "-w") {
      parsed.workspace = path.resolve(args[++i]);
    } else if (arg === "--target-folder" || arg === "-t") {
      parsed.targetFolder = args[++i];
    } else if (arg === "--site-url" || arg === "-s") {
      parsed.siteUrl = args[++i];
    } else if (arg === "--hard-reset") {
      parsed.hardReset = true;
    } else if (arg === "--mock") {
      parsed.mock = true;
    }
  }

  return parsed;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const engine = new PnPWorkspaceSyncEngine();
  console.log(`[PnP-CLI] Initializing action: ${args.action.toUpperCase()}`);
  console.log(`[PnP-CLI] Workspace Root : ${args.workspace}`);
  console.log(`[PnP-CLI] Target Folder  : ${args.targetFolder}`);
  console.log(`[PnP-CLI] Site URL       : ${args.siteUrl}`);

  try {
    if (args.action === "prewarm") {
      console.log(`[PnP-CLI] Starting prewarm (hardReset: ${args.hardReset}, mock: ${args.mock})...`);
      const report = await engine.prewarm({
        workspaceRoot: args.workspace,
        targetFolder: args.targetFolder,
        siteUrl: args.siteUrl,
        hardReset: args.hardReset,
        mockTransport: args.mock,
      });

      console.log("\n=== PREWARM REPORT ===");
      console.log(`Total Local Files : ${report.totalLocal}`);
      console.log(`Synced (Uploaded) : ${report.syncedCount}`);
      console.log(`Skipped (Cached)  : ${report.skippedCount}`);
      console.log(`Pruned (Orphans)  : ${report.prunedCount}`);
      console.log(`Failed Errors     : ${report.failedCount}`);
      console.log(`Duration          : ${report.durationMs}ms`);
      console.log("======================\n");
    } else if (args.action === "sync-file" || args.action === "syncFile") {
      if (!args.file) {
        console.error("Error: --file <relative_path> is required for sync-file action.");
        process.exit(1);
      }
      console.log(`[PnP-CLI] Fast-path hot syncing file: ${args.file}...`);
      const res = await engine.syncFile(args.workspace, args.file, args.targetFolder, {
        siteUrl: args.siteUrl,
        mockTransport: args.mock,
      });

      console.log(`[PnP-CLI] Result: ${res.status.toUpperCase()}`);
      if (res.uniqueId) console.log(`[PnP-CLI] UniqueId: ${res.uniqueId}`);
      if (res.sha256) console.log(`[PnP-CLI] SHA256  : ${res.sha256}`);
      if (res.error) console.error(`[PnP-CLI] Error   : ${res.error}`);
    } else if (args.action === "pull-file" || args.action === "pullFile") {
      if (!args.file) {
        console.error("Error: --file <relative_path> is required for pull-file action.");
        process.exit(1);
      }
      console.log(`[PnP-CLI] Pulling file: ${args.file}...`);
      const res = await engine.pullFile(args.workspace, args.file, args.targetFolder, {
        siteUrl: args.siteUrl,
        mockTransport: args.mock,
      });
      console.log(`[PnP-CLI] Result: ${res.status.toUpperCase()}`);
      if (res.error) console.error(`[PnP-CLI] Error: ${res.error}`);
    } else {
      console.error(`Unknown action: ${args.action}`);
      printHelp();
      process.exit(1);
    }
  } catch (err: any) {
    console.error(`[PnP-CLI] FATAL: ${err.message}`);
    process.exit(1);
  }
}

if (import.meta.main) {
  main();
}

