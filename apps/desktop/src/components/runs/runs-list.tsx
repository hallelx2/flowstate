import { useMemo } from 'react';
import type { Run } from '@/lib/run-store';
import { cn } from '@/lib/cn';
import { formatRelative, formatDuration, statusDotColor, statusLabel } from './run-utils';

interface Props {
  runs: Run[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function RunsList({ runs, selectedId, onSelect }: Props) {
  const grouped = useMemo(() => groupByAgent(runs), [runs]);

  if (runs.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 text-center">
        <p className="font-display text-base text-ink">No runs yet</p>
        <p className="mt-1 text-xs leading-relaxed text-ink-muted">
          Start one from the home composer or click <span className="font-mono text-ink">run</span>{' '}
          on any agent.
        </p>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-px overflow-y-auto p-2">
      {grouped.map((group) => (
        <li key={group.label} className="mt-3 first:mt-0">
          <p className="px-3 py-1 font-mono text-2xs uppercase tracking-code text-ink-subtle">
            {group.label} · {group.runs.length}
          </p>
          <ul>
            {group.runs.map((run) => {
              const isSelected = run.id === selectedId;
              return (
                <li key={run.id}>
                  <button
                    onClick={() => onSelect(run.id)}
                    className={cn(
                      'group flex w-full items-start gap-2.5 rounded-md border px-3 py-2 text-left transition-all',
                      isSelected
                        ? 'border-stone bg-paper'
                        : 'border-transparent hover:border-stone-subtle hover:bg-paper/60',
                    )}
                  >
                    <span className={cn('mt-1 h-1.5 w-1.5 shrink-0 rounded-full', statusDotColor(run.status))} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-mono text-2xs text-ink">{run.id}</span>
                        <span className="shrink-0 font-mono text-2xs uppercase tracking-code text-ink-subtle">
                          {statusLabel(run.status)}
                        </span>
                      </div>
                      {run.prompt && (
                        <p className="mt-0.5 line-clamp-2 text-xs leading-snug text-ink">
                          {run.prompt}
                        </p>
                      )}
                      <div className="mt-1 flex items-center gap-2 text-2xs text-ink-subtle">
                        <span>{formatRelative(run.startedAt)}</span>
                        {run.totals.durationMs > 0 && (
                          <>
                            <span className="opacity-50">·</span>
                            <span>{formatDuration(run.totals.durationMs)}</span>
                          </>
                        )}
                        {run.steps.length > 0 && (
                          <>
                            <span className="opacity-50">·</span>
                            <span>{run.steps.length} step{run.steps.length === 1 ? '' : 's'}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </li>
      ))}
    </ul>
  );
}

function groupByAgent(runs: Run[]): { label: string; runs: Run[] }[] {
  const map = new Map<string, Run[]>();
  for (const r of runs) {
    const key = r.agentName || 'ad-hoc';
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(r);
  }
  return Array.from(map.entries())
    .map(([label, rs]) => ({ label, runs: rs }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
