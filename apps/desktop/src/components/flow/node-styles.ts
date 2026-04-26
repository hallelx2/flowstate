import type { StepStatus } from '@flowstate/core';

/**
 * Cohere-flavored status treatment for flow nodes.
 * Depth and emphasis come from rings + borders, not shadows.
 */

export function statusRing(status: StepStatus): string {
  switch (status) {
    case 'running':
      return 'ring-2 ring-accent-500/50 shadow-[0_0_0_6px_hsl(218_75%_47%/0.10)]';
    case 'completed':
      return 'ring-1 ring-stone';
    case 'failed':
      return 'ring-2 ring-err/60';
    case 'pending':
      return 'ring-1 ring-stone-subtle';
    case 'skipped':
      return 'ring-1 ring-stone-subtle opacity-60';
  }
}

export function statusDot(status: StepStatus): string {
  switch (status) {
    case 'running':
      return 'bg-accent-500 animate-pulseBlue';
    case 'completed':
      return 'bg-ok';
    case 'failed':
      return 'bg-err';
    case 'pending':
      return 'bg-ink-subtle';
    case 'skipped':
      return 'bg-stone';
  }
}

export function statusLabel(status: StepStatus): string {
  switch (status) {
    case 'running': return 'running';
    case 'completed': return 'done';
    case 'failed': return 'failed';
    case 'pending': return 'queued';
    case 'skipped': return 'skipped';
  }
}
