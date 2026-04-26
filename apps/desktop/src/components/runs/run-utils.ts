import type { Run } from '@/lib/run-store';

export function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

export function statusDotColor(status: Run['status']): string {
  switch (status) {
    case 'queued':
      return 'bg-ink-subtle';
    case 'running':
      return 'bg-accent-500 animate-pulse-blue';
    case 'completed':
      return 'bg-ok';
    case 'failed':
      return 'bg-err';
    case 'cancelled':
      return 'bg-stone';
  }
}

export function statusLabel(status: Run['status']): string {
  return status;
}
