import { describe, it, expect } from "bun:test";
import {
  createEnvelope,
  parseEnvelope,
  type WsEnvelope,
} from "../../src/server/protocol-types.ts";
import {
  generateSecurityToken,
  verifySecurityToken,
} from "../../src/server/security-token.ts";

describe("Protocol Envelopes (protocol-types)", () => {
  it("should create envelope with default generated id and timestamp", () => {
    const envelope = createEnvelope("test:event", { foo: "bar" });
    expect(envelope.type).toBe("test:event");
    expect(envelope.payload).toEqual({ foo: "bar" });
    expect(typeof envelope.id).toBe("string");
    expect(envelope.id.length).toBeGreaterThan(0);
    expect(typeof envelope.timestamp).toBe("number");
    expect(envelope.timestamp).toBeGreaterThan(0);
  });

  it("should create envelope with custom id", () => {
    const customId = "req-custom-123";
    const envelope = createEnvelope("rpc:call", { action: "ping" }, customId);
    expect(envelope.id).toBe(customId);
    expect(envelope.type).toBe("rpc:call");
    expect(envelope.payload).toEqual({ action: "ping" });
  });

  it("should round-trip serialize and parse valid envelope", () => {
    const original = createEnvelope("msg:send", { text: "hello" }, "id-456");
    const jsonStr = JSON.stringify(original);
    const parsed = parseEnvelope(jsonStr);

    expect(parsed).not.toBeNull();
    expect(parsed?.id).toBe("id-456");
    expect(parsed?.type).toBe("msg:send");
    expect(parsed?.payload).toEqual({ text: "hello" });
    expect(parsed?.timestamp).toBe(original.timestamp);
  });

  it("should reject malformed JSON", () => {
    expect(parseEnvelope("not json")).toBeNull();
    expect(parseEnvelope("{bad:json")).toBeNull();
    expect(parseEnvelope("")).toBeNull();
  });

  it("should reject non-object JSON values", () => {
    expect(parseEnvelope("123")).toBeNull();
    expect(parseEnvelope('"a string"')).toBeNull();
    expect(parseEnvelope("null")).toBeNull();
    expect(parseEnvelope("[]")).toBeNull();
    expect(parseEnvelope("true")).toBeNull();
  });

  it("should reject envelopes missing required fields", () => {
    expect(parseEnvelope(JSON.stringify({ type: "event", payload: {} }))).toBeNull(); // missing id & timestamp
    expect(parseEnvelope(JSON.stringify({ id: "1", payload: {} }))).toBeNull(); // missing type & timestamp
    expect(parseEnvelope(JSON.stringify({ id: "1", type: "event" }))).toBeNull(); // missing payload & timestamp
    expect(parseEnvelope(JSON.stringify({ id: 123, type: "event", payload: {}, timestamp: Date.now() }))).toBeNull(); // id not string
    expect(parseEnvelope(JSON.stringify({ id: "1", type: 123, payload: {}, timestamp: Date.now() }))).toBeNull(); // type not string
    expect(parseEnvelope(JSON.stringify({ id: "1", type: "event", payload: {}, timestamp: "not-a-number" }))).toBeNull(); // timestamp not number
  });
});

describe("Security Token (security-token)", () => {
  it("should generate a 64-character hex security token (32 bytes)", () => {
    const token1 = generateSecurityToken();
    const token2 = generateSecurityToken();

    expect(typeof token1).toBe("string");
    expect(token1.length).toBe(64);
    expect(/^[0-9a-f]{64}$/.test(token1)).toBe(true);

    expect(typeof token2).toBe("string");
    expect(token2.length).toBe(64);
    expect(token1).not.toBe(token2);
  });

  it("should verify matching token successfully", () => {
    const token = generateSecurityToken();
    expect(verifySecurityToken(token, token)).toBe(true);
  });

  it("should reject mismatched token", () => {
    const token1 = generateSecurityToken();
    const token2 = generateSecurityToken();
    expect(verifySecurityToken(token1, token2)).toBe(false);
  });

  it("should safely reject different length or invalid tokens without throwing", () => {
    const token = generateSecurityToken();
    expect(verifySecurityToken(token, "short-token")).toBe(false);
    expect(verifySecurityToken(token, "")).toBe(false);
    expect(verifySecurityToken(token, token + "extra")).toBe(false);
    expect(verifySecurityToken("", "")).toBe(false);
    expect(verifySecurityToken(token, null as any)).toBe(false);
    expect(verifySecurityToken(token, undefined as any)).toBe(false);
  });
});
