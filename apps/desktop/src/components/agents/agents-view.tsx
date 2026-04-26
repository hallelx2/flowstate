import { useMemo, useState } from 'react';
import { Search, Plus, X } from 'lucide-react';
import { AGENTS } from '@/agents';
import { AgentList } from './agent-list';
import { AgentDetail } from './agent-detail';

interface AgentsViewProps {
  onRunStarted?: () => void;
}

export function AgentsView({ onRunStarted }: AgentsViewProps = {}) {
  const [selectedId, setSelectedId] = useState<string | null>(AGENTS[0]?.id ?? null);
  const [query, setQuery] = useState('');

  const visible = useMemo(() => {
    if (!query) return AGENTS;
    const q = query.toLowerCase();
    return AGENTS.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        a.id.includes(q) ||
        a.description?.toLowerCase().includes(q) ||
        a.tools?.some((t) => t.toLowerCase().includes(q)) ||
        a.needs?.some((n) => n.toLowerCase().includes(q)),
    );
  }, [query]);

  const selected = AGENTS.find((a) => a.id === selectedId) ?? null;

  return (
    <div className="flex h-full bg-paper">
      {/* ─── Left rail · agent list ─── */}
      <aside className="flex w-[320px] shrink-0 flex-col border-r border-stone-subtle bg-paper-sunken">
        <div className="shrink-0 border-b border-stone-subtle px-4 pb-3 pt-5">
          <div className="flex items-center justify-between">
            <span className="font-mono text-2xs uppercase tracking-code-wide text-ink-subtle">
              AGENTS · {AGENTS.length}
            </span>
            <button
              className="rounded-md p-1 text-ink-subtle hover:bg-paper hover:text-ink"
              title="New agent"
            >
              <Plus size={13} />
            </button>
          </div>
          <h2 className="mt-2 font-display text-xl text-ink">Your workspace</h2>

          <div className="mt-3 flex items-center gap-2 rounded-md border border-stone bg-paper px-2.5 py-1 focus-within:border-cohere-purple-focus">
            <Search size={12} className="text-ink-subtle" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="search"
              className="flex-1 bg-transparent text-xs text-ink placeholder:text-ink-subtle focus:outline-none"
            />
            {query && (
              <button onClick={() => setQuery('')} className="text-ink-subtle hover:text-ink">
                <X size={11} />
              </button>
            )}
          </div>
        </div>

        <AgentList agents={visible} selectedId={selectedId} onSelect={setSelectedId} />
      </aside>

      {/* ─── Right pane · detail ─── */}
      <main className="flex-1 overflow-hidden">
        {selected ? (
          <AgentDetail agent={selected} onRunStarted={onRunStarted} />
        ) : (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <h2 className="font-display text-2xl text-ink">No agent selected</h2>
            <p className="mt-2 max-w-sm text-sm text-ink-muted">
              Pick an agent from the list, or create a new one.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
