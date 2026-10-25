import { TokenManager } from "../src/auth/token-manager.ts";
import { SubstrateUploader } from "../src/transport/substrate-uploader.ts";

async function main() {
  const tokenManager = new TokenManager();
  const accounts = tokenManager.loadAccounts();
  const primaryAcc = accounts[0];
  const graphToken = await tokenManager.getGraphAccessToken(primaryAcc.email);

  console.log("Uploading test document to OneDrive via SubstrateUploader...");
  const res = await SubstrateUploader.uploadDocumentAuto(
    graphToken,
    "Hello from SubstrateUploader test attachment",
    "test-attachment.txt"
  );

  console.log("Upload result:", {
    driveItemId: res.driveItemId,
    webUrl: res.webUrl,
    annotationId: res.annotation.id,
    annotationText: res.annotation.text,
  });
}

main();

