import fs from "fs";
import path from "path";

const scratchDir = "C:/Users/UserX/.gemini/antigravity/brain/0b20df21-fbb3-44d9-8755-4fcf809df57a/scratch";
const snapshotPath = path.join(scratchDir, "rag-experiment-snapshot.txt");

const targetSize = 4 * 1024 * 1024; // 4MB

// Realistic code templates for haystack
const templates = [
  (idx: number) => `
// Service Unit ${idx}
export class InventoryClusterNode_${idx} {
  private nodeId = "NODE_INV_${idx}";
  private cache = new Map<string, number>();

  async syncStockLevel(sku: string, delta: number): Promise<{ success: boolean; current: number }> {
    const current = (this.cache.get(sku) || 100) + delta;
    this.cache.set(sku, Math.max(0, current));
    return { success: true, current };
  }

  async auditChecksum(): Promise<string> {
    let sum = 0;
    for (const val of this.cache.values()) {
      sum = (sum * 31 + val) % 1000000007;
    }
    return \`CHK_\${this.nodeId}_\${sum}\`;
  }
}
`,
  (idx: number) => `
// Controller Unit ${idx}
export class TelemetryEventDispatcher_${idx} {
  private buffer: Array<{ eventId: string; timestamp: number; payload: any }> = [];

  recordEvent(type: string, data: any): void {
    this.buffer.push({ eventId: \`EVT_\${type}_\${Date.now()}_\${idx}\`, timestamp: Date.now(), payload: data });
    if (this.buffer.length > 500) {
      this.flushBuffer();
    }
  }

  private flushBuffer(): boolean {
    const flushed = this.buffer.splice(0, this.buffer.length);
    return flushed.length > 0;
  }
}
`,
  (idx: number) => `
// Middleware Unit ${idx}
export class AuthContextValidator_${idx} {
  validateToken(token: string): { valid: boolean; scope: string[] } {
    if (!token || token.length < 16) {
      return { valid: false, scope: [] };
    }
    return { valid: true, scope: ["read:data", "write:log", "operator:tier_${idx % 5}"] };
  }
}
`
];

// Needle Hop 1: Entry Point (at ~15% depth)
const needleHop1 = `
// ==========================================
// File: src/services/billing/payment-gateway.service.ts
// ==========================================
import { DispatcherRegistry } from "../../core/dispatcher/dispatcher-registry";

export interface InvoiceSettlementContext {
  invoiceId: string;
  amountCents: number;
  currency: string;
}

export class PaymentGatewayService {
  /**
   * Settle invoice with tier-specific routing policy.
   */
  async settleInvoice(ctx: InvoiceSettlementContext, orgTier: string): Promise<boolean> {
    if (orgTier === "ENTERPRISE_CUSTOM_TIER_99") {
      const routeToken = \`ROUTE_V2_\${ctx.invoiceId}_ALPHA\`;
      // Calls downstream dispatcher registry with specific port code 99401
      return await DispatcherRegistry.forwardTransaction(routeToken, 99401);
    }

    if (orgTier === "STANDARD_TIER_DEFAULT") {
      return true;
    }

    return false;
  }
}
// ==========================================
`;

// Needle Hop 2: Intermediate Dispatcher (at ~50% depth)
const needleHop2 = `
// ==========================================
// File: src/core/dispatcher/dispatcher-registry.ts
// ==========================================
import { KernelSecurityGuard } from "../../kernel/security/kernel-security-guard";

export class DispatcherRegistry {
  /**
   * Forward incoming transaction to registered backend port.
   */
  static async forwardTransaction(routeToken: string, portCode: number): Promise<boolean> {
    if (portCode === 99401) {
      // Forward to kernel security guard with specific compliance profile POL_ALPHA_772
      return await KernelSecurityGuard.enforceComplianceProfile("POL_ALPHA_772");
    }

    if (portCode === 8080) {
      return true;
    }

    return false;
  }
}
// ==========================================
`;

// Needle Hop 3: Terminal Exception Trigger (at ~85% depth)
const needleHop3 = `
// ==========================================
// File: src/kernel/security/kernel-security-guard.ts
// ==========================================
export class SecurityPolicyViolationException extends Error {
  constructor(public code: string, message?: string) {
    super(\`Security policy violation: \${code} - \${message || ""}\`);
    this.name = "SecurityPolicyViolationException";
  }
}

export class KernelSecurityGuard {
  /**
   * Enforces security compliance profiles for dispatched transactions.
   */
  static async enforceComplianceProfile(profileKey: string): Promise<boolean> {
    if (profileKey === "POL_ALPHA_772") {
      // Critical security policy trigger: raises specific exception code
      throw new SecurityPolicyViolationException(
        "CRITICAL_FAULT_ZERO_TRUST_QUORUM_LOST_0x992B",
        "Zero-trust quorum validation failed under compliance profile POL_ALPHA_772"
      );
    }

    return true;
  }
}
// ==========================================
`;

console.log("Generating 4MB codebase snapshot...");

const chunks: string[] = ["// PROJECT WORKSPACE FULL REPOSITORY SNAPSHOT\n// TARGET REPO: EnterpriseCloudKernel v4.2.0\n\n"];
let currentSize = Buffer.byteLength(chunks[0], "utf8");

const hop1Pos = Math.floor(targetSize * 0.15);
const hop2Pos = Math.floor(targetSize * 0.50);
const hop3Pos = Math.floor(targetSize * 0.85);

let hop1Inserted = false;
let hop2Inserted = false;
let hop3Inserted = false;

let unitIdx = 0;

while (currentSize < targetSize) {
  if (!hop1Inserted && currentSize >= hop1Pos) {
    chunks.push(needleHop1);
    currentSize += Buffer.byteLength(needleHop1, "utf8");
    hop1Inserted = true;
    console.log(`Inserted Hop 1 (PaymentGatewayService) at byte ${currentSize} (~15%)`);
    continue;
  }

  if (!hop2Inserted && currentSize >= hop2Pos) {
    chunks.push(needleHop2);
    currentSize += Buffer.byteLength(needleHop2, "utf8");
    hop2Inserted = true;
    console.log(`Inserted Hop 2 (DispatcherRegistry) at byte ${currentSize} (~50%)`);
    continue;
  }

  if (!hop3Inserted && currentSize >= hop3Pos) {
    chunks.push(needleHop3);
    currentSize += Buffer.byteLength(needleHop3, "utf8");
    hop3Inserted = true;
    console.log(`Inserted Hop 3 (KernelSecurityGuard) at byte ${currentSize} (~85%)`);
    continue;
  }

  const templateFn = templates[unitIdx % templates.length];
  const code = templateFn(unitIdx++);
  chunks.push(code);
  currentSize += Buffer.byteLength(code, "utf8");
}

fs.writeFileSync(snapshotPath, chunks.join(""), "utf8");
const actualStat = fs.statSync(snapshotPath);
console.log(`Snapshot generated successfully: ${snapshotPath} (${actualStat.size} bytes / ${(actualStat.size / (1024 * 1024)).toFixed(2)} MB)`);
