import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Plus, X, ExternalLink, Settings as SettingsIcon, Play } from 'lucide-react';
import type { ToolKind, ToolManifest } from '@flowstate/core';
import { cn } from '@/lib/cn';
import { FIXTURE_TOOLS } from './fixtures';
import { ToolCard } from './tool-card';
import { ToolIcon } from './tool-icon';
import { kindLabel, statusInfo } from './tool-meta';

type Filter = 'all' | ToolKind;

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'mcp', label: 'MCP' },
  { id: 'cli', label: 'CLI' },
  { id: 'skill', label: 'Skills' },
  { id: 'http', label: 'HTTP' },
  { id: 'composio', label: 'Composio' },
  { id: 'shell', label: 'Local' },
];

export function ToolsPane() {
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<ToolManifest | null>(null);

  const filtered = useMemo(() => {
    return FIXTURE_TOOLS.filter((t) => {
      if (filter !== 'all' && t.kind !== filter) return false;
      if (query) {
        const q = query.toLowerCase();
        return (
          t.name.toLowerCase().includes(q) ||
          t.description.toLowerCase().includes(q) ||
          t.capabilities.some((c) => c.toLowerCase().includes(q)) ||
          t.tags?.some((tag) => tag.toLowerCase().includes(q))
        );
      }
      return true;
    });
  }, [filter, query]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: FIXTURE_TOOLS.length };
    for (const t of FIXTURE_TOOLS) c[t.kind] = (c[t.kind] ?? 0) + 1;
    return c;
  }, []);

  return (
    <div className="relative flex h-full bg-paper">
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* ─── Editorial header ─── */}
        <div className="relative shrink-0 border-b border-stone-subtle bg-paper px-12 pb-7 pt-12">
          {/* tiny top-left signature */}
          <div className="absolute left-12 top-7 flex items-center gap-2">
            <span className="block h-1.5 w-1.5 rounded-sm bg-cohere-purple-500" />
            <span className="font-mono text-2xs uppercase tracking-codeWide text-ink-subtle">
              TOOL DIRECTORY
            </span>
          </div>

          <div className="mt-8 flex items-end justify-between gap-8">
            <div className="max-w-2xl">
              <h1
                className="font-display text-5xl text-ink"
              >
                Everything your agents
                <br />
                can <span className="italic font-light text-ink-subtle">do</span>.
              </h1>
              <p className="mt-4 max-w-xl text-base leading-relaxed text-ink-muted">
                One directory, many sources — MCP servers, CLI tools you've already authenticated,
                skills you've written, and anything you've connected through Composio. Drop one
                into a process and it just&nbsp;works.
              </p>
            </div>

            <div className="flex shrink-0 flex-col items-end gap-3">
              <button className="btn-dark">
                <Plus size={13} />
                Add tool
              </button>
              <span className="font-mono text-2xs uppercase tracking-code text-ink-subtle">
                {FIXTURE_TOOLS.length} installed · {FIXTURE_TOOLS.filter((t) => t.authStatus === 'ready').length} ready
              </span>
            </div>
          </div>

          {/* Search + filter strip */}
          <div className="mt-9 flex items-center gap-3">
            <div className="flex w-full max-w-sm items-center gap-2 rounded-md border border-stone bg-paper-raised px-3 py-1.5 focus-within:border-cohere-purple-focus">
              <Search size={14} className="text-ink-subtle" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="search by name, capability, tag…"
                className="flex-1 bg-transparent text-sm text-ink placeholder:text-ink-subtle focus:outline-none"
              />
              {query && (
                <button onClick={() => setQuery('')} className="text-ink-subtle hover:text-ink">
                  <X size={13} />
                </button>
              )}
            </div>

            <div className="flex items-center gap-1 overflow-x-auto">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setFilter(f.id)}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                    filter === f.id
                      ? 'border-ink bg-ink text-paper'
                      : 'border-stone bg-paper text-ink-muted hover:border-ink hover:text-ink',
                  )}
                >
                  {f.label}
                  <span
                    className={cn(
                      'rounded-sm px-1 font-mono text-2xs',
                      filter === f.id ? 'bg-paper/20 text-paper' : 'bg-paper-sunken text-ink-subtle',
                    )}
                  >
                    {counts[f.id] ?? 0}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ─── Grid ─── */}
        <div className="flex-1 overflow-y-auto px-12 py-8">
          {filtered.length === 0 ? (
            <EmptyState
              query={query}
              onClear={() => {
                setQuery('');
                setFilter('all');
              }}
            />
          ) : (
            <motion.div
              layout
              className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3"
            >
              {filtered.map((tool, i) => (
                <motion.div
                  key={tool.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.35, delay: Math.min(i * 0.025, 0.25) }}
                >
                  <ToolCard tool={tool} onSelect={setSelected} selected={selected?.id === tool.id} />
                </motion.div>
              ))}
            </motion.div>
          )}
        </div>
      </div>

      {/* ─── Detail drawer ─── */}
      <AnimatePresence>
        {selected && (
          <ToolDetail key={selected.id} tool={selected} onClose={() => setSelected(null)} />
        )}
      </AnimatePresence>
    </div>
  );
}

function EmptyState({ query, onClear }: { query: string; onClear: () => void }) {
  return (
    <div className="flex h-full min-h-[40vh] flex-col items-center justify-center text-center">
      <div
        className="font-display text-3xl text-ink"
      >
        Nothing matches.
      </div>
      <p className="mt-2 max-w-sm text-sm text-ink-muted">
        {query ? (
          <>
            No tools matched <span className="font-mono text-ink">"{query}"</span>.
          </>
        ) : (
          'Try a different filter.'
        )}
      </p>
      <button onClick={onClear} className="btn-outline mt-5">
        clear
      </button>
    </div>
  );
}

function ToolDetail({ tool, onClose }: { tool: ToolManifest; onClose: () => void }) {
  const status = statusInfo(tool.authStatus ?? 'unknown');
  return (
    <motion.aside
      initial={{ x: 460, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 460, opacity: 0 }}
      transition={{ duration: 0.35, ease: [0.2, 0.8, 0.2, 1] }}
      className="relative flex w-[440px] shrink-0 flex-col overflow-hidden border-l border-stone bg-paper"
    >
      {/* Header — research-paper feel */}
      <div className="border-b border-stone-subtle px-7 py-7">
        <button
          onClick={onClose}
          className="absolute right-5 top-5 rounded-md p-1 text-ink-muted hover:bg-paper-sunken hover:text-ink"
        >
          <X size={15} />
        </button>

        <div className="flex items-center gap-2">
          {tool.brandColor && (
            <span
              className="block h-1.5 w-1.5 rounded-sm"
              style={{ backgroundColor: tool.brandColor }}
            />
          )}
          <span className="font-mono text-2xs uppercase tracking-codeWide text-ink-subtle">
            {kindLabel(tool.kind)} · {tool.publisher} · v{tool.version ?? '—'}
          </span>
        </div>

        <div className="mt-3 flex items-start gap-4">
          <span
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-stone-subtle bg-paper text-ink"
            style={tool.brandColor ? { color: tool.brandColor } : undefined}
          >
            <ToolIcon name={tool.icon} size={22} />
          </span>
          <div className="flex-1">
            <h2
              className="font-display text-3xl text-ink leading-none"
            >
              {tool.name}
            </h2>
          </div>
        </div>

        <p className="mt-4 text-sm leading-relaxed text-ink-muted">{tool.description}</p>
      </div>

      <div className="flex-1 overflow-y-auto px-7 py-6">
        {/* Auth status */}
        <div className="flex items-center justify-between rounded-xl border border-stone-subtle bg-paper-sunken px-4 py-3">
          <div className="flex items-center gap-2.5">
            <span className={cn('h-2 w-2 rounded-full', status.dot)} />
            <span className="text-xs font-medium text-ink">{status.label}</span>
          </div>
          <button className="font-mono text-2xs uppercase tracking-code text-ink-muted hover:text-accent-500">
            {tool.authStatus === 'ready' ? 'reconfigure' : 'set up →'}
          </button>
        </div>

        {/* Capabilities */}
        <section className="mt-7">
          <p className="eyebrow mb-3">capabilities</p>
          <ul className="space-y-px">
            {tool.capabilities.map((cap) => (
              <li
                key={cap}
                className="flex items-center justify-between rounded-md px-2 py-1.5 font-mono text-xs text-ink hover:bg-paper-sunken"
              >
                <span>{cap}</span>
                <ExternalLink size={11} className="text-ink-subtle" />
              </li>
            ))}
          </ul>
        </section>

        {/* Actions */}
        <section className="mt-7">
          <p className="eyebrow mb-3">actions · {tool.actions.length}</p>
          <ul className="divide-y divide-stone-subtle border-y border-stone-subtle">
            {tool.actions.map((action) => (
              <li key={action.id} className="flex items-center justify-between py-3">
                <div className="flex flex-col">
                  <span className="font-mono text-xs text-ink">{action.id}</span>
                  <span className="mt-0.5 text-2xs text-ink-muted">{action.summary}</span>
                </div>
                <button className="btn-outline px-2 py-1 text-2xs">
                  <Play size={10} />
                  test
                </button>
              </li>
            ))}
          </ul>
        </section>

        {/* Provider — code block */}
        <section className="mt-7">
          <p className="eyebrow mb-3">provider</p>
          <pre className="overflow-x-auto rounded-md border border-stone-subtle bg-paper-sunken p-3 font-mono text-2xs leading-relaxed text-ink-muted">
            {JSON.stringify(tool.provider, null, 2)}
          </pre>
        </section>
      </div>

      <div className="flex items-center justify-between border-t border-stone-subtle px-6 py-4">
        <button className="flex items-center gap-1.5 font-mono text-2xs uppercase tracking-code text-ink-muted hover:text-ink">
          <SettingsIcon size={11} />
          configure
        </button>
        <button className="btn-dark">add to agent</button>
      </div>
    </motion.aside>
  );
}
