import { useEffect, useState } from 'react';
import { History } from 'lucide-react';
import { useRuns } from '@/lib/run-store';
import { RunsList } from './runs-list';
import { RunDetail } from './run-detail';

export function RunsView() {
  const runs = useRuns();
  const [selectedId, setSelectedId] = useState<string | null>(runs[0]?.id ?? null);

  // Auto-select the most recent run when a new one starts (and nothing is selected)
  useEffect(() => {
    if (!selectedId && runs.length > 0) {
      setSelectedId(runs[0]!.id);
    }
  }, [runs, selectedId]);

  // If selected run was removed, fall back to the first
  useEffect(() => {
    if (selectedId && !runs.find((r) => r.id === selectedId)) {
      setSelectedId(runs[0]?.id ?? null);
    }
  }, [runs, selectedId]);

  const selected = runs.find((r) => r.id === selectedId) ?? null;

  return (
    <div className="flex h-full bg-paper">
      {/* Left rail · run list */}
      <aside className="flex w-[340px] shrink-0 flex-col border-r border-stone-subtle bg-paper-sunken">
        <div className="shrink-0 border-b border-stone-subtle px-4 pb-3 pt-5">
          <p className="font-mono text-2xs uppercase tracking-code-wide text-ink-subtle">
            RUN HISTORY · {runs.length}
          </p>
          <h2 className="mt-2 font-display text-xl text-ink">Recent activity</h2>
        </div>
        <RunsList runs={runs} selectedId={selectedId} onSelect={setSelectedId} />
      </aside>

      {/* Right pane · selected run */}
      <main className="flex-1 overflow-hidden">
        {selected ? (
          <RunDetail run={selected} />
        ) : (
          <EmptyMain />
        )}
      </main>
    </div>
  );
}

function EmptyMain() {
  return (
    <div className="flex h-full flex-col items-center justify-center px-8 text-center">
      <div className="rounded-2xl border border-stone-subtle bg-paper-sunken p-5">
        <History size={26} strokeWidth={1.4} className="text-ink-subtle" />
      </div>
      <h2 className="mt-5 font-display text-2xl text-ink">No runs yet</h2>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-ink-muted">
        Describe something on the <span className="text-ink">Home</span> composer and hit
        start, or open the <span className="text-ink">Agents</span> tab and run any saved
        agent. Every run lands here, replayable and scrubable.
      </p>
    </div>
  );
}
