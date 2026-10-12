/**
 * URL and Agent ID utility functions
 */

/**
 * Normalizes a Copilot Agent ID from either a raw string or a full Copilot Agent URL.
 * Supports /chat/agent/<agentId> URLs and raw Agent IDs.
 * Decodes URL-encoded identifiers when necessary.
 */
export function normalizeAgentId(input?: string): string | undefined {
  if (!input) return undefined;
  const trimmed = input.trim();
  if (!trimmed) return undefined;
  const match = trimmed.match(/\/chat\/agent\/([^?&#]+)/);
  if (match) {
    const decoded = decodeURIComponent(match[1]).trim();
    return decoded || undefined;
  }
  return trimmed;
}
