import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export interface PackedSnapshot {
  snapshotPath: string;
  totalFiles: number;
  totalBytes: number;
  totalLines: number;
  hash: string;
}

export function packCnnjiSnapshot(projectDir: string, outputFile: string): PackedSnapshot {
  console.log(`📦 [SnapshotPacker] 扫描源文件: ${projectDir}`);

  // List of files to include
  const relPaths = [
    "shared/modules/JsygtBatch.psm1",
    "shared/modules/JsygtClient.psm1",
    "shared/modules/JsygtCaptcha.psm1",
    "shared/tests/JsygtBatch.tests.ps1",
    "shared/tests/JsygtClient.tests.ps1",
    "shared/tests/JsygtCaptcha.tests.ps1",
    "web/server.psm1",
    "web/modules/YardApi.psm1",
    "web/modules/DevRunner.psm1",
    "web/tests/YardApi.tests.ps1",
    "web/public/yard.js",
    "web/public/app.js",
    "web/public/index.html",
    "web/tests/check-public-js.mjs",
    "tools/jsygt-ocr/OcrInfer.cs",
    "tools/jsygt-ocr/OcrEngine.cs",
    "tools/jsygt-ocr/Program.cs",
    "AGENTS.md",
  ];

  const chunks: string[] = [
    "// ======================================\n// CNNJI QUERY PROJECT SOURCE SNAPSHOT\n// ======================================\n\n"
  ];

  const manifest: string[] = ["// --- FILE MANIFEST ---"];
  let totalLines = 0;
  let fileCount = 0;

  for (const rel of relPaths) {
    const fullPath = path.join(projectDir, rel);
    if (!fs.existsSync(fullPath)) {
      console.warn(`⚠️ 文件不存在: ${rel}`);
      continue;
    }

    const content = fs.readFileSync(fullPath, "utf8");
    const lines = content.split("\n").length;
    const bytes = Buffer.byteLength(content, "utf8");
    const sha = crypto.createHash("sha256").update(content).digest("hex").slice(0, 10);

    manifest.push(`// - ${rel} (Lines: ${lines}, Bytes: ${bytes}, SHA: ${sha})`);
    totalLines += lines;
    fileCount++;

    chunks.push(`\n// ##################################################\n// FILE: ${rel} (Lines: ${lines}, SHA: ${sha})\n// ##################################################\n${content}\n`);
  }

  manifest.push(`// Total Files: ${fileCount}, Total Lines: ${totalLines}\n\n`);
  chunks.splice(1, 0, manifest.join("\n"));

  const fullText = chunks.join("");
  const totalBytes = Buffer.byteLength(fullText, "utf8");
  const fullHash = crypto.createHash("sha256").update(fullText).digest("hex").slice(0, 16);

  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, fullText, "utf8");

  console.log(`✔ [SnapshotPacker] 快照构建成功: ${outputFile}`);
  console.log(`   文件数: ${fileCount}, 代码总行数: ${totalLines}, 体积: ${(totalBytes / 1024).toFixed(1)} KB, 哈希: ${fullHash}`);

  return {
    snapshotPath: outputFile,
    totalFiles: fileCount,
    totalBytes,
    totalLines,
    hash: fullHash,
  };
}

if (import.meta.main) {
  const projectDir = "E:\\test\\Library\\CNNJI QUERY";
  const outputFile = path.resolve(__dirname, "..", ".cph", "snapshots", "cnnji-query-source-snapshot.txt");
  packCnnjiSnapshot(projectDir, outputFile);
}

