/**
 * Audit-log redaction.
 *
 * Pure-function module — no Electron dep — so the offline smoke test can
 * verify masking against representative tool inputs.
 *
 * Two layers of defense:
 *   1. Tool-specific: `set_secret({ value })` is the canonical secret carrier;
 *      we always redact `value` for that tool.
 *   2. Universal: any field whose KEY name matches the secret-keyword regex
 *      gets masked recursively, regardless of tool. Defends against future
 *      tools that carry tokens in unexpected nested fields (e.g.
 *      install_mcp_server's `def.transport.env.STRIPE_API_KEY`).
 */

import { FLOWSTATE_TOOL_PREFIX } from './constants';

const SECRET_KEY_RE = /token|secret|password|key|authorization|cookie|credential|bearer/i;

function maskRecursive(value: unknown): unknown {
  if (value == null) return value;
  if (Array.isArray(value)) return value.map(maskRecursive);
  if (typeof value !== 'object') return value;
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string' && SECRET_KEY_RE.test(k)) {
      out[k] = '<redacted>';
    } else {
      out[k] = maskRecursive(v);
    }
  }
  return out;
}

export function maskForAudit(
  toolName: string,
  input: Record<string, unknown>,
): Record<string, unknown> {
  if (toolName === `${FLOWSTATE_TOOL_PREFIX}set_secret`) {
    const masked = { ...input };
    if (typeof masked['value'] === 'string') masked['value'] = '<redacted>';
    return masked;
  }
  return maskRecursive(input) as Record<string, unknown>;
}
