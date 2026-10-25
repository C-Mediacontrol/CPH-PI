import { TokenManager } from "../src/auth/token-manager.ts";
import { SubstrateUploader } from "../src/transport/substrate-uploader.ts";

async function main() {
  const tokenManager = new TokenManager();
  const accounts = tokenManager.loadAccounts();
  const primaryAcc = accounts[0];
  console.log(`Getting Graph token for ${primaryAcc.email}...`);
  try {
    const graphToken = await tokenManager.getGraphAccessToken(primaryAcc.email);
    console.log("Graph token length:", graphToken.length);
    console.log("Graph token prefix:", graphToken.slice(0, 30));
  } catch (err: any) {
    console.error("Failed to get Graph token:", err.message);
  }
}

main();

