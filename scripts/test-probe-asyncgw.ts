import { TokenManager } from "../src/auth/token-manager.ts";
import path from "node:path";
import fs from "node:fs";

async function main() {
  const mgr = new TokenManager();
  console.log("Config path:", mgr.getConfigPath());
  const accounts = mgr.loadAccounts();
  console.log("Found accounts in config:", accounts.map(a => a.email));

  const url = "https://fr-prod.asyncgw.teams.microsoft.com/v1/objects/0-frc-d3-f6c040c72ebef76f6c0b32bdb0ed3354/views/original/CNNJI-QUERY-review-2026-10-25.md";
  const zipUrl = "https://fr-prod.asyncgw.teams.microsoft.com/v1/objects/0-frs-d4-f9dfdbcef4af8458fb1209e712c0d2f2/views/original/CNNJI-QUERY-review-package-2026-10-25.zip";

  for (const acc of accounts) {
    console.log(`\n================ Testing account: ${acc.email} ================`);
    let m365Token: string | null = null;
    let graphToken: string | null = null;
    try {
      m365Token = await mgr.getAccessToken(acc.email);
    } catch (e: any) {
      console.log("Failed to get m365 token:", e?.message);
    }
    try {
      graphToken = await mgr.getGraphAccessToken(acc.email);
    } catch (e: any) {
      console.log("Failed to get graph token:", e?.message);
    }

    const testTokens: { name: string; token: string }[] = [];
    if (m365Token) testTokens.push({ name: "M365 Token", token: m365Token });
    if (graphToken) testTokens.push({ name: "Graph Token", token: graphToken });

    for (const t of testTokens) {
      const headersList = [
        { Authorization: `Bearer ${t.token}` },
        { Authorization: `skypetoken ${t.token}` },
        { "x-skypetoken": t.token },
        { Authorization: `Bearer ${t.token}`, "x-ms-client-env": "prod" },
      ];

      for (const [idx, h] of headersList.entries()) {
        try {
          const res = await fetch(url, { headers: h as any });
          console.log(`[${t.name}] Header ${idx} -> Status: ${res.status} ${res.statusText}`);
          if (res.ok) {
            const body = await res.text();
            console.log(`>>> SUCCESS! Body length: ${body.length}, preview: ${body.slice(0, 100)}`);
            return;
          }
        } catch (err: any) {
          console.log(`[${t.name}] Error:`, err?.message);
        }
      }
    }

    if (acc.cookies) {
      console.log("Testing with account cookies...");
      try {
        const res = await fetch(url, { headers: { Cookie: acc.cookies } });
        console.log(`[Cookies] -> Status: ${res.status} ${res.statusText}`);
        if (res.ok) {
          const body = await res.text();
          console.log(`>>> SUCCESS WITH COOKIES! Body length: ${body.length}`);
          return;
        }
      } catch (e: any) {
        console.log("[Cookies] Error:", e?.message);
      }
    }
  }
}

main().catch(console.error);
