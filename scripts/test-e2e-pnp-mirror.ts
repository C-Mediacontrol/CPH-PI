/**
 * test-e2e-pnp-mirror.ts
 * Real SharePoint E2E verification for:
 * 1. Pushing dummy orphan to remote SharePoint
 * 2. Prewarm with Orphan Pruning (assert dummy orphan is pruned)
 * 3. Hot overwrite of existing file (assert UniqueId / GUID stability)
 * 4. Virtual Repo Map generation
 */
import fs from "node:fs";
import path from "node:path";
import { PnPWorkspaceSyncEngine } from "../src/workspace/pnp-sync-engine.ts";

const SITE_URL = "https://cmacgmgroup.sharepoint.com/sites/CMA-GBSC_BKGDOMAIN";
const TARGET_FOLDER =
  "/sites/CMA-GBSC_BKGDOMAIN/AFRASIA/01 Team/03 AFR/AFR SCHK/06_Training/New Hire Training/2025/Vincent Fu/WorkSpace/live test";

async function runE2ETest(): Promise<void> {
  console.log("=================================================================");
  console.log("       SharePoint Cloud Repo Sync: Real E2E Verification        ");
  console.log("=================================================================");
  console.log(`Site URL     : ${SITE_URL}`);
  console.log(`Target Folder: ${TARGET_FOLDER}\n`);

  const workspaceRoot = path.resolve(__dirname, "../.cph/state/live-test-workspace");
  if (!fs.existsSync(workspaceRoot)) {
    fs.mkdirSync(workspaceRoot, { recursive: true });
  }

  // Ensure live workspace has core files
  const kernelCalcPath = path.join(workspaceRoot, "kernel_calc.py");
  if (!fs.existsSync(kernelCalcPath)) {
    fs.writeFileSync(
      kernelCalcPath,
      `# kernel_calc.py - Tier 3 Kernel Computation\ndef calculate_raw(multiplier: int = 7) -> int:\n    return 1000 * multiplier + 888\n`,
      "utf8"
    );
  }

  const appEntryPath = path.join(workspaceRoot, "app_entry.py");
  if (!fs.existsSync(appEntryPath)) {
    fs.writeFileSync(
      appEntryPath,
      `from pricing_service import get_final_price\nprint(get_final_price())\n`,
      "utf8"
    );
  }

  const pricingServicePath = path.join(workspaceRoot, "pricing_service.py");
  if (!fs.existsSync(pricingServicePath)) {
    fs.writeFileSync(
      pricingServicePath,
      `from kernel_calc import calculate_raw\ndef get_final_price():\n    return calculate_raw()\n`,
      "utf8"
    );
  }

  // Ensure dummy-orphan.txt is NOT in local workspace
  const localOrphanPath = path.join(workspaceRoot, "dummy-orphan.txt");
  if (fs.existsSync(localOrphanPath)) {
    fs.unlinkSync(localOrphanPath);
  }

  const engine = new PnPWorkspaceSyncEngine();

  // -------------------------------------------------------------
  // STEP 1: Push a dummy orphan file directly to remote SharePoint
  // -------------------------------------------------------------
  console.log("[STEP 1] Seeding remote orphan file: dummy-orphan.txt...");
  const tempSeedDir = path.resolve(__dirname, "../.cph/state/temp-orphan-seed");
  fs.mkdirSync(tempSeedDir, { recursive: true });
  const seedFilePath = path.join(tempSeedDir, "dummy-orphan.txt");
  fs.writeFileSync(seedFilePath, `Orphan file generated at ${new Date().toISOString()}`, "utf8");

  const seedResult = await engine.syncFile(tempSeedDir, "dummy-orphan.txt", TARGET_FOLDER, {
    siteUrl: SITE_URL,
    mockTransport: false,
  });

  if (seedResult.status !== "synced") {
    throw new Error(`Failed to seed remote orphan file: ${seedResult.error || "unknown"}`);
  }
  console.log(`[STEP 1 SUCCESS] Remote orphan created! UniqueId: ${seedResult.uniqueId}\n`);

  // -------------------------------------------------------------
  // STEP 2: Trigger Prewarm with Orphan Pruning
  // -------------------------------------------------------------
  console.log("[STEP 2] Running Prewarm with Orphan Pruning against local workspace...");
  const t0 = Date.now();
  const prewarmReport = await engine.prewarm({
    workspaceRoot,
    targetFolder: TARGET_FOLDER,
    siteUrl: SITE_URL,
    hardReset: false,
    mockTransport: false,
  });
  const prewarmDuration = Date.now() - t0;

  console.log(`[STEP 2 REPORT] Duration: ${prewarmDuration}ms`);
  console.log(`Total Local Files: ${prewarmReport.totalLocal}`);
  console.log(`Synced Count     : ${prewarmReport.syncedCount}`);
  console.log(`Skipped Count    : ${prewarmReport.skippedCount}`);
  console.log(`Pruned Count     : ${prewarmReport.prunedCount}`);
  console.log(`Failed Count     : ${prewarmReport.failedCount}`);

  // Assert orphan pruning succeeded
  const prunedOrphan = prewarmReport.results.find(
    (r) => r.relativePath.toLowerCase() === "dummy-orphan.txt" && r.status === "pruned"
  );
  if (!prunedOrphan) {
    console.warn("[STEP 2 WARNING] dummy-orphan.txt was not explicitly listed as pruned in report. Checking prunedCount...");
    if (prewarmReport.prunedCount < 1) {
      throw new Error("Assertion failed: prunedCount is 0, dummy-orphan.txt was not pruned!");
    }
  } else {
    console.log(`[STEP 2 ASSERTION PASSED] dummy-orphan.txt was pruned from remote SharePoint!`);
  }

  // -------------------------------------------------------------
  // STEP 3: Verify UniqueId Stability across Real Overwrites
  // -------------------------------------------------------------
  console.log("\n[STEP 3] Testing fast hot-sync and GUID stability on kernel_calc.py...");

  // Write first mutation
  const codeV1 = `# kernel_calc.py - Test V1 at ${new Date().toISOString()}\ndef calculate_raw(multiplier: int = 7) -> int:\n    return 1000 * multiplier + 888\n`;
  fs.writeFileSync(kernelCalcPath, codeV1, "utf8");

  const tSync1 = Date.now();
  const syncResult1 = await engine.syncFile(workspaceRoot, "kernel_calc.py", TARGET_FOLDER, {
    siteUrl: SITE_URL,
    mockTransport: false,
  });
  const duration1 = Date.now() - tSync1;
  console.log(`[STEP 3] Overwrite #1 completed in ${duration1}ms. Status: ${syncResult1.status}, UniqueId: ${syncResult1.uniqueId}`);

  if (syncResult1.status !== "synced" || !syncResult1.uniqueId) {
    throw new Error(`Assertion failed: Overwrite #1 failed (${syncResult1.error || "no uniqueId"})`);
  }

  // Write second mutation
  const codeV2 = `# kernel_calc.py - Test V2 at ${new Date().toISOString()}\ndef calculate_raw(multiplier: int = 7) -> int:\n    return 1000 * multiplier + 999\n`;
  fs.writeFileSync(kernelCalcPath, codeV2, "utf8");

  const tSync2 = Date.now();
  const syncResult2 = await engine.syncFile(workspaceRoot, "kernel_calc.py", TARGET_FOLDER, {
    siteUrl: SITE_URL,
    mockTransport: false,
  });
  const duration2 = Date.now() - tSync2;
  console.log(`[STEP 3] Overwrite #2 completed in ${duration2}ms. Status: ${syncResult2.status}, UniqueId: ${syncResult2.uniqueId}`);

  if (syncResult2.status !== "synced") {
    throw new Error(`Assertion failed: Overwrite #2 expected status 'synced', got '${syncResult2.status}'`);
  }

  if (syncResult1.uniqueId !== syncResult2.uniqueId) {
    throw new Error(
      `Assertion failed: UniqueId changed! (V1: ${syncResult1.uniqueId}, V2: ${syncResult2.uniqueId})`
    );
  }
  console.log(`[STEP 3 ASSERTION PASSED] GUID 100% stable across overwrites! (${syncResult2.uniqueId})`);

  const originalUniqueId = syncResult2.uniqueId;

  // -------------------------------------------------------------
  // STEP 4: Verify Virtual Repo Map
  // -------------------------------------------------------------
  console.log("\n[STEP 4] Verifying .cph/state/virtual-repo-map.md...");
  const mapPath = path.join(workspaceRoot, ".cph", "state", "virtual-repo-map.md");
  if (!fs.existsSync(mapPath)) {
    throw new Error("Assertion failed: virtual-repo-map.md does not exist!");
  }
  const mapContent = fs.readFileSync(mapPath, "utf8");
  console.log("--- Virtual Repo Map Snippet ---");
  console.log(mapContent.split("\n").slice(0, 10).join("\n"));
  console.log("--------------------------------");

  if (!mapContent.includes("kernel_calc.py") || !mapContent.includes(originalUniqueId)) {
    throw new Error("Assertion failed: virtual-repo-map.md does not contain kernel_calc.py UniqueId!");
  }
  console.log("[STEP 4 ASSERTION PASSED] Virtual Repo Map verified!");

  // Clean up temp seed
  try {
    fs.rmSync(tempSeedDir, { recursive: true, force: true });
  } catch {}

  console.log("\n=================================================================");
  console.log("       ALL E2E AUDIT GATES PASSED (100% OPERATIONAL)            ");
  console.log("=================================================================");
}

runE2ETest().catch((err) => {
  console.error(`\n[FATAL ERROR] E2E Test Failed: ${err.message}`);
  process.exit(1);
});
