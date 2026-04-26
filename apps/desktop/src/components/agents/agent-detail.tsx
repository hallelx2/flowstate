import { useState } from 'react';
import { motion } from 'motion/react';
import { Play, FileText, Braces } from 'lucide-react';
import type { Agent } from '@flowstate/core';
import { cn } from '@/lib/cn';
import { triggerLabel, toolRefDisplay } from './agent-meta';

type Tab = 'inspector' | 'source';

interface Props {
  agent: Agent;
}

export function AgentDetail({ agent }: Props) {
  const [tab, setTab] = useState<Tab>('inspector');

  return (
    <motion.article
      key={agent.id}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="flex h-full flex-col overflow-hidden"
    >
      {/* ─── Header ─── */}
      <header className="shrink-0 border-b border-stone-subtle bg-paper px-10 pb-5 pt-9">
        <div className="flex items-center gap-2">
          <span className="block h-1.5 w-1.5 rounded-sm bg-cohere-purple-500" />
          <span className="font-mono text-2xs uppercase tracking-code-wide text-ink-subtle">
            AGENT · {agent.source.toUpperCase()} · {agent.sourcePath}
          </span>
        </div>

        <div className="mt-3 flex items-end justify-between gap-6">
          <div className="min-w-0">
            <h1 className="font-display text-4xl text-ink leading-none">{agent.name}</h1>
            {agent.description && (
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-ink-muted">
                {agent.description}
              </p>
            )}
            <p className="mt-3 font-mono text-xs text-ink-subtle">
              <span className="text-ink-muted">id</span>{' '}
              <span className="text-ink">{agent.id}</span>
              <span className="mx-2 opacity-50">·</span>
              <span className="text-ink-muted">trigger</span>{' '}
              <span className="text-ink">{triggerLabel(agent.trigger)}</span>
            </p>
          </div>

          <button className="btn-dark shrink-0">
            <Play size={11} />
            run
          </button>
        </div>

        {/* Tabs — Inspector | Source */}
        <div className="mt-6 flex items-center gap-1 border-b border-transparent">
          <TabButton active={tab === 'inspector'} onClick={() => setTab('inspector')}>
            <FileText size={11} /> Inspector
          </TabButton>
          <TabButton active={tab === 'source'} onClick={() => setTab('source')}>
            <Braces size={11} /> Source
          </TabButton>
        </div>
      </header>

      {/* ─── Body ─── */}
      <div className="flex-1 overflow-y-auto">
        {tab === 'inspector' ? <Inspector agent={agent} /> : <Source agent={agent} />}
      </div>
    </motion.article>
  );
}

function TabButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 border-b-2 px-3 pb-2 pt-1.5 text-xs font-medium transition-colors',
        active
          ? 'border-ink text-ink'
          : 'border-transparent text-ink-subtle hover:text-ink',
      )}
    >
      {children}
    </button>
  );
}

// ─── Inspector ─────────────────────────────────────────────────────────────

function Inspector({ agent }: { agent: Agent }) {
  return (
    <div className="grid grid-cols-1 gap-7 px-10 py-7 lg:grid-cols-3">
      {/* Left two-thirds: tools + capabilities + body */}
      <div className="space-y-7 lg:col-span-2">
        {agent.tools && agent.tools.length > 0 && (
          <section>
            <p className="eyebrow mb-3">tools · {agent.tools.length}</p>
            <ul className="divide-y divide-stone-subtle border-y border-stone-subtle">
              {agent.tools.map((ref) => {
                const { provider, id } = toolRefDisplay(ref);
                return (
                  <li key={ref} className="flex items-center justify-between py-2">
                    <span className="font-mono text-xs text-ink">{id}</span>
                    <span className="rounded-sm border border-stone-subtle px-1.5 py-0.5 font-mono text-2xs uppercase tracking-code text-ink-subtle">
                      {provider}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {agent.needs && agent.needs.length > 0 && (
          <section>
            <p className="eyebrow mb-3">capabilities · {agent.needs.length}</p>
            <div className="flex flex-wrap gap-1.5">
              {agent.needs.map((cap) => (
                <span
                  key={cap}
                  className="rounded-sm border border-stone-subtle bg-paper-sunken px-2 py-0.5 font-mono text-2xs text-ink-muted"
                >
                  {cap}
                </span>
              ))}
            </div>
          </section>
        )}

        {agent.body && (
          <section>
            <p className="eyebrow mb-3">body · prose</p>
            <div className="rounded-xl border border-stone-subtle bg-paper-raised p-5">
              <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-ink">
                {agent.body}
              </pre>
            </div>
          </section>
        )}
      </div>

      {/* Right one-third: budget + permissions */}
      <aside className="space-y-7">
        {agent.budget && (
          <section>
            <p className="eyebrow mb-3">budget</p>
            <dl className="space-y-1 rounded-xl border border-stone-subtle bg-paper-sunken p-4">
              {agent.budget.tokens != null && (
                <BudgetRow
                  label="tokens"
                  value={agent.budget.tokens.toLocaleString()}
                />
              )}
              {agent.budget.usd != null && (
                <BudgetRow label="usd" value={`$${agent.budget.usd.toFixed(2)}`} />
              )}
              {agent.budget.runtimeMs != null && (
                <BudgetRow
                  label="runtime"
                  value={`${(agent.budget.runtimeMs / 1000).toFixed(0)}s`}
                />
              )}
            </dl>
          </section>
        )}

        {agent.permissions && (
          <section>
            <p className="eyebrow mb-3">permissions</p>
            <div className="space-y-3 rounded-xl border border-stone-subtle bg-paper-sunken p-4 text-xs">
              {agent.permissions.network && agent.permissions.network.length > 0 && (
                <PermissionGroup label="network" items={agent.permissions.network} />
              )}
              {agent.permissions.env && agent.permissions.env.length > 0 && (
                <PermissionGroup label="env" items={agent.permissions.env} />
              )}
              {agent.permissions.fs?.read && agent.permissions.fs.read.length > 0 && (
                <PermissionGroup label="fs read" items={agent.permissions.fs.read} />
              )}
              {agent.permissions.fs?.write && agent.permissions.fs.write.length > 0 && (
                <PermissionGroup label="fs write" items={agent.permissions.fs.write} />
              )}
            </div>
          </section>
        )}
      </aside>
    </div>
  );
}

function BudgetRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="font-mono text-2xs uppercase tracking-code text-ink-subtle">{label}</dt>
      <dd className="font-mono text-xs text-ink">{value}</dd>
    </div>
  );
}

function PermissionGroup({ label, items }: { label: string; items: string[] }) {
  return (
    <div>
      <p className="mb-1 font-mono text-2xs uppercase tracking-code text-ink-subtle">{label}</p>
      <ul className="space-y-0.5">
        {items.map((it) => (
          <li key={it} className="font-mono text-xs text-ink">
            {it}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── Source ────────────────────────────────────────────────────────────────

function Source({ agent }: { agent: Agent }) {
  return (
    <div className="px-10 py-7">
      <div className="overflow-hidden rounded-xl border border-stone-subtle bg-paper-raised">
        <div className="flex items-center justify-between border-b border-stone-subtle bg-paper-sunken px-4 py-2">
          <span className="font-mono text-2xs uppercase tracking-code text-ink-subtle">
            {agent.sourcePath}
          </span>
          <span className="font-mono text-2xs uppercase tracking-code text-ink-subtle">
            {agent.raw.split('\n').length} lines
          </span>
        </div>
        <pre className="overflow-x-auto whitespace-pre p-5 font-mono text-xs leading-relaxed text-ink">
          {agent.raw}
        </pre>
      </div>
    </div>
  );
}
