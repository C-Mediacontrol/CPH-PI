import crypto from "node:crypto";

export function generateSecurityToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function verifySecurityToken(expected: string, provided: string): boolean {
  if (
    typeof expected !== "string" ||
    typeof provided !== "string" ||
    !expected ||
    !provided
  ) {
    return false;
  }

  const expectedBuf = Buffer.from(expected, "utf-8");
  const providedBuf = Buffer.from(provided, "utf-8");

  if (expectedBuf.length !== providedBuf.length || expectedBuf.length === 0) {
    return false;
  }

  try {
    return crypto.timingSafeEqual(expectedBuf, providedBuf);
  } catch {
    return false;
  }
}
