import type { AuthStatus, ToolKind } from '@flowstate/core';

export function kindLabel(kind: ToolKind): string {
  switch (kind) {
    case 'mcp': return 'MCP';
    case 'cli': return 'CLI';
    case 'http': return 'HTTP';
    case 'composio': return 'Composio';
    case 'skill': return 'Skill';
    case 'shell': return 'Shell';
    case 'sdk': return 'SDK';
  }
}

/**
 * Cohere-style: monochrome chips with a single-letter or color signal.
 * Restraint over color-coding — kind is communicated by the label itself.
 */
export function kindAccent(kind: ToolKind): string {
  // Cohere is monochrome — every kind gets the same chrome treatment.
  // Differentiation comes from the label, not the color.
  switch (kind) {
    case 'skill':
      return 'bg-paper text-accent-600 border-accent-200';
    default:
      return 'bg-paper-sunken text-ink-muted border-stone';
  }
}

/**
 * Status pills — clean white chrome, signal lives in the dot.
 */
export function statusInfo(status: AuthStatus) {
  switch (status) {
    case 'ready':
      return {
        label: 'Authenticated',
        short: 'ready',
        dot: 'bg-ok',
        bg: 'bg-paper',
        fg: 'text-ink-muted',
        border: 'border-stone',
      };
    case 'needs_setup':
      return {
        label: 'Setup required',
        short: 'setup',
        dot: 'bg-warn',
        bg: 'bg-paper',
        fg: 'text-ink-muted',
        border: 'border-stone',
      };
    case 'expired':
      return {
        label: 'Authentication expired',
        short: 'expired',
        dot: 'bg-err',
        bg: 'bg-paper',
        fg: 'text-ink-muted',
        border: 'border-stone',
      };
    default:
      return {
        label: 'Unknown',
        short: '—',
        dot: 'bg-ink-subtle',
        bg: 'bg-paper',
        fg: 'text-ink-subtle',
        border: 'border-stone-subtle',
      };
  }
}
