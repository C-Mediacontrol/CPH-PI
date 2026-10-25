import { TokenManager } from "../src/auth/token-manager.ts";
import { ChatHubClient } from "../src/transport/chathub-client.ts";

async function main() {
  const tokenManager = new TokenManager();
  const accounts = tokenManager.loadAccounts();
  const primaryAcc = accounts[0];
  const token = await tokenManager.getAccessToken(primaryAcc.email);

  const testResearcherId = "T_c5ff29f6-7b7e-b8f0-79b3-610c449e320c.213f1c46-0df7-47d2-89e3-5efd9e698280.gpt.2ee6fcd0-43e3-4d74-821b-3da7e21c1fff";
  console.log(`Testing ChatHub connection to Test-Researcher (${testResearcherId})...`);

  const client = new ChatHubClient(token, {
    customAgentId: testResearcherId,
    modelTone: "Gpt_61_Sol_Reasoning",
    timeoutMs: 30000,
    idleTimeoutMs: 15000,
  });

  const res = await client.sendMessage({
    text: "你好，请确认你的角色定位与工作范式。",
  }, {
    onDelta: (delta) => {
      process.stdout.write(delta.content);
    }
  });

  console.log("\n\n[SUCCESS] Response text:\n", res.text);
}

main();

