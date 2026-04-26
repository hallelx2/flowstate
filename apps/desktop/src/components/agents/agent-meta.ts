import type { Trigger } from '@flowstate/core';

/**
 * Human-friendly one-line trigger summary for list views and headers.
 */
export function triggerLabel(trigger: Trigger): string {
  switch (trigger.kind) {
    case 'manual':
      return 'manual';
    case 'webhook':
      return `webhook · ${trigger.config?.method ?? 'POST'} ${trigger.config?.path ?? ''}`.trim();
    case 'cron':
      return `cron · ${trigger.config.schedule}${
        trigger.config.timezone ? ` (${trigger.config.timezone})` : ''
      }`;
    case 'watch':
      return `watch · ${trigger.config.source}`;
    case 'event':
      return `event · ${trigger.config.name}`;
  }
}

/** Short kind label for badges. */
export function triggerKindLabel(trigger: Trigger): string {
  return trigger.kind;
}

/** Strip the `provider:` prefix from a tool ref for display. */
export function toolRefDisplay(ref: string): { provider: string; id: string } {
  const idx = ref.indexOf(':');
  if (idx < 0) return { provider: '', id: ref };
  return { provider: ref.slice(0, idx), id: ref.slice(idx + 1) };
}
