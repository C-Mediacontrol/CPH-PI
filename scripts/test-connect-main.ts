import { TokenManager } from "../src/auth/token-manager.ts";
import { ChatHubClient } from "../src/transport/chathub-client.ts";

async function main() {
  const tokenManager = new TokenManager();
  const accounts = tokenManager.loadAccounts();
  console.log(`Found ${accounts.length} stored accounts:`);
  for (const acc of accounts) {
    console.log(`- ${acc.email}`);
  }

  if (accounts.length === 0) {
    console.error("No accounts found!");
    return;
  }

  const primaryAcc = accounts[0];
  console.log(`Acquiring token for ${primaryAcc.email}...`);
  try {
    const token = await tokenManager.getAccessToken(primaryAcc.email);
    console.log("Token acquired:", {
      email: token.email,
      expiresAt: new Date(token.expiresAt).toISOString(),
      oid: token.oid,
      tid: token.tid,
      tokenLen: token.accessToken.length
    });

    const testMainId = "T_abffaa75-b1c7-c65d-6538-560421201682.5df4fcc1-67f9-484c-ab26-ce5558139d5f.gpt.43b6fa06-485b-435b-9e42-47d2e43b050b";
    console.log(`Testing ChatHub connection to Test-Main (${testMainId})...`);

    const client = new ChatHubClient(token, {
      customAgentId: testMainId,
      modelTone: "Gpt_61_Sol_Reasoning",
      timeoutMs: 30000,
      idleTimeoutMs: 15000,
    });

    console.log("Sending ping message...");
    const res = await client.sendMessage({
      text: "你好，请确认你的角色定位与当前可访问的技能。",
    }, {
      onDelta: (delta) => {
        process.stdout.write(delta.content);
      }
    });

    console.log("\n\n[SUCCESS] Response text:\n", res.text);
    if (res.reasoning) {
      console.log("\n[REASONING]:\n", res.reasoning);
    }
  } catch (err: any) {
    console.error("Failed:", err.message);
  }
}

main();
