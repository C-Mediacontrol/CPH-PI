import crypto from "node:crypto";

export interface WsEnvelope<T = any> {
  id: string;
  type: string;
  payload: T;
  timestamp: number;
}

export function createEnvelope<T>(
  type: string,
  payload: T,
  id?: string
): WsEnvelope<T> {
  return {
    id: id || crypto.randomUUID(),
    type,
    payload,
    timestamp: Date.now(),
  };
}

export function parseEnvelope(raw: string): WsEnvelope | null {
  if (typeof raw !== "string" || !raw.trim()) {
    return null;
  }

  try {
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return null;
    }

    if (
      typeof data.id !== "string" ||
      typeof data.type !== "string" ||
      typeof data.timestamp !== "number" ||
      Number.isNaN(data.timestamp) ||
      !("payload" in data)
    ) {
      return null;
    }

    return data as WsEnvelope;
  } catch {
    return null;
  }
}
