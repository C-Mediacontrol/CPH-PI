import path from "node:path";
import { SharePointSyncEngine, type SharePointSyncOptions } from "../src/workspace/sharepoint-sync.ts";

function parseArgs(): SharePointSyncOptions {
  const args = process.argv.slice(2);
  let workspaceRoot = process.cwd();
  let targetFolder = "";
  let siteUrl = SharePointSyncEngine.DEFAULT_SITE_URL;
  let mode: "standard" | "all" | "source_and_library_clean" = "standard";
  let mockTransport = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--workspaceRoot" && args[i + 1]) {
      workspaceRoot = args[++i];
    } else if (arg === "--targetFolder" && args[i + 1]) {
      targetFolder = args[++i];
    } else if (arg === "--siteUrl" && args[i + 1]) {
      siteUrl = args[++i];
    } else if (arg === "--mode" && args[i + 1]) {
      mode = args[++i] as any;
    } else if (arg === "--mock") {
      mockTransport = true;
    }
  }

  if (!targetFolder) {
    console.error("Usage: bun run scripts/sp-sync.ts --workspaceRoot <path> --targetFolder <SharePointPath> [--mode <standard|all|source_and_library_clean>] [--siteUrl <url>] [--mock]");
    process.exit(1);
  }

  return {
    workspaceRoot: path.resolve(workspaceRoot),
    targetFolder,
    siteUrl,
    mode,
    mockTransport,
  };
}

async function main() {
  const opts = parseArgs();
  console.log(`[SP-SYNC] Starting SharePoint workspace sync...`);
  console.log(`  WorkspaceRoot: ${opts.workspaceRoot}`);
  console.log(`  TargetFolder:  ${opts.targetFolder}`);
  console.log(`  Mode:          ${opts.mode}`);
  console.log(`  SiteUrl:       ${opts.siteUrl}`);

  const engine = new SharePointSyncEngine();
  const startTime = Date.now();

  try {
    const report = await engine.syncWorkspace(opts);
    const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log(`\n[SP-SYNC RESULT] Sync finished in ${elapsedSec}s:`);
    console.log(`  Total files detected: ${report.totalFound}`);
    console.log(`  Synced:  ${report.syncedCount}`);
    console.log(`  Skipped: ${report.skippedCount}`);
    console.log(`  Failed:  ${report.failedCount}`);
    console.log(`  Total bytes transferred: ${(report.totalBytes / 1024).toFixed(1)} KB`);

    for (const r of report.results) {
      if (r.status === "synced") {
        console.log(`  [SYNCED]  ${r.relativePath} (${r.size} B) -> ${r.webUrl || "OK"}`);
      } else if (r.status === "skipped") {
        console.log(`  [SKIP]    ${r.relativePath} (${r.size} B)`);
      } else if (r.status === "failed") {
        console.error(`  [FAILED]  ${r.relativePath}: ${r.error}`);
      }
    }

    if (report.failedCount > 0) {
      process.exit(2);
    }
  } catch (err: any) {
    console.error(`[SP-SYNC FATAL] ${err.message}`);
    process.exit(1);
  }
}

main();

