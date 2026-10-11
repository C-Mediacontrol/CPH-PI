import crypto from "crypto";

const DEFAULT_PEPPER = "m365-copilot2api-fallback-pepper-v1-TODO-DPAPI-keyring";
const PEPPER_KEY = Buffer.from("m365-copilot2api-pepper-v1");
export const ENC_PREFIX = "enc:v1:";

/**
 * Derive 32-byte AES-256 key from master pepper
 */
export function deriveMasterKey(customMaster?: string): Buffer {
  const rawMaster = customMaster || process.env.M365_MASTER_KEY || DEFAULT_PEPPER;
  return crypto.createHmac("sha256", PEPPER_KEY).update(rawMaster).digest();
}

/**
 * Check if a string is encrypted with enc:v1: prefix
 */
export function isEncryptedToken(token?: string): boolean {
  return typeof token === "string" && token.startsWith(ENC_PREFIX);
}

/**
 * Encrypt plain refresh token into enc:v1:<base64> using AES-256-GCM
 */
export function encryptToken(plain: string, customMaster?: string): string {
  if (!plain) return "";
  if (plain.startsWith(ENC_PREFIX)) return plain;
  const key = deriveMasterKey(customMaster);

  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, nonce);

  const ciphertext = Buffer.concat([cipher.update(Buffer.from(plain, "utf8")), cipher.final()]);
  const tag = cipher.getAuthTag();

  // layout: nonce (12) + ciphertext + tag (16)
  const combined = Buffer.concat([nonce, ciphertext, tag]);
  return ENC_PREFIX + combined.toString("base64");
}

/**
 * Decrypt enc:v1:<base64> refresh token string
 */
export function decryptToken(enc: string, customMaster?: string): string {
  if (!enc || !enc.startsWith(ENC_PREFIX)) return enc;
  const rawBase64 = enc.slice(ENC_PREFIX.length);
  const key = deriveMasterKey(customMaster);

  const buf = Buffer.from(rawBase64, "base64");
  if (buf.length < 28) {
    // 12 nonce + 16 tag minimum
    throw new Error("Ciphertext too short for AES-GCM");
  }

  const nonce = buf.subarray(0, 12);
  const tag = buf.subarray(buf.length - 16);
  const ciphertext = buf.subarray(12, buf.length - 16);

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

/**
 * DPAPI / AES helper wrapper for local credential protection
 */
export function protectSecret(secret: string, customMaster?: string): string {
  return encryptToken(secret, customMaster);
}

export function unprotectSecret(ciphertext: string, customMaster?: string): string {
  return decryptToken(ciphertext, customMaster);
}

