import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  Play,
  FileText,
  Braces,
  Target,
  ListOrdered,
  ShieldAlert,
  AlertTriangle,
  FileCode,
  ChevronRight,
} from 'lucide-react';
import type {
  Agent,
  ResolvedSection,
  ResolvedRule,
  ResolvedStep,
} from '@flowstate/core';
import { cn } from '@/lib/cn';
import { MarkdownView } from '@/components/prose/markdown-view';
import { CodeView } from '@/components/prose/code-view';
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
      <Header agent={agent} tab={tab} onTabChange={setTab} />
      <div className="flex-1 overflow-hidden">
        {tab === 'inspector' ? <Inspector agent={agent} /> : <Source agent={agent} />}
      </div>
    </motion.article>
  );
}

// ─── Header ────────────────────────────────────────────────────────────────

function Header({
  agent,
  tab,
  onTabChange,
}: {
  agent: Agent;
  tab: Tab;
  onTabChange: (t: Tab) => void;
}) {
  return (
    <header className="shrink-0 border-b border-stone-subtle bg-paper px-10 pb-5 pt-9">
      <div className="flex items-center gap-2">
        <span className="block h-1.5 w-1.5 rounded-sm bg-cohere-purple-500" />
        <span className="font-mono text-2xs uppercase tracking-code-wide text-ink-subtle">
          AGENT · {agent.source.toUpperCase()} · {agent.sourcePath.replace(/^\.\//, '')}
        </span>
      </div>

      <div className="mt-3 flex items-end justify-between gap-6">
        <div className="min-w-0">
          <h1 className="font-display text-4xl text-ink leading-none">{agent.name}</h1>
          {agent.description && (
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-muted">
              {agent.description}
            </p>
          )}
          <p className="mt-3 font-mono text-xs text-ink-subtle">
            <span className="text-ink-muted">id</span>{' '}
            <span className="text-ink">{agent.id}</span>
            <span className="mx-2 opacity-50">·</span>
            <span className="text-ink-muted">trigger</span>{' '}
            <span className="text-ink">{triggerLabel(agent.trigger)}</span>
            {agent.includedFiles.length > 0 && (
              <>
                <span className="mx-2 opacity-50">·</span>
                <span className="text-ink-muted">includes</span>{' '}
                <span className="text-ink">{agent.includedFiles.length} file
                  {agent.includedFiles.length === 1 ? '' : 's'}</span>
              </>
            )}
          </p>
        </div>

        <button className="btn-dark shrink-0">
          <Play size={11} />
          run
        </button>
      </div>

      <div className="mt-6 flex items-center gap-1">
        <TabButton active={tab === 'inspector'} onClick={() => onTabChange('inspector')}>
          <FileText size={11} /> Inspector
        </TabButton>
        <TabButton active={tab === 'source'} onClick={() => onTabChange('source')}>
          <Braces size={11} /> Source
          <span className="ml-1 rounded-sm bg-paper-sunken px-1 font-mono text-2xs text-ink-subtle">
            {1 + agent.includedFiles.length}
          </span>
        </TabButton>
      </div>
    </header>
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
  const s = agent.sections;
  return (
    <div className="h-full overflow-y-auto">
      <div className="grid grid-cols-12 gap-10 px-10 py-8">
        {/* Main column · prose & sections */}
        <div className="col-span-12 space-y-7 lg:col-span-8">
          {s?.goal && <GoalCard section={s.goal} />}
          {s?.steps && s.steps.length > 0 && <StepsBlock steps={s.steps} />}
          {s?.rules && s.rules.length > 0 && <RulesBlock rules={s.rules} />}
          {s?.onFailure && <OnFailureCard section={s.onFailure} />}
          {agent.body && <OverviewCard body={agent.body} />}
          {!s && !agent.body && (
            <div className="rounded-xl border border-stone-subtle bg-paper-sunken p-8 text-center text-sm text-ink-muted">
              No sections or body. The Source tab shows the raw{' '}
              <span className="font-mono text-ink">{agent.sourcePath}</span>.
            </div>
          )}
        </div>

        {/* Sidebar · operational metadata */}
        <aside className="col-span-12 space-y-6 lg:col-span-4">
          <ToolsCard agent={agent} />
          {agent.needs && agent.needs.length > 0 && (
            <CapabilitiesCard needs={agent.needs} />
          )}
          {agent.budget && <BudgetCard budget={agent.budget} />}
          {agent.permissions && <PermissionsCard permissions={agent.permissions} />}
        </aside>
      </div>
    </div>
  );
}

// ─── Section cards ─────────────────────────────────────────────────────────

function SectionShell({
  icon,
  eyebrow,
  rightSlot,
  children,
}: {
  icon: React.ReactNode;
  eyebrow: string;
  rightSlot?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-stone-subtle bg-paper-raised">
      <div className="flex items-center justify-between border-b border-stone-subtle px-5 py-2.5">
        <div className="flex items-center gap-2 text-ink-muted">
          {icon}
          <span className="eyebrow">{eyebrow}</span>
        </div>
        {rightSlot}
      </div>
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

function IncludeBadge({ section }: { section: ResolvedSection }) {
  if (section.kind !== 'include' || !section.sourcePath) return null;
  return (
    <span className="font-mono text-2xs text-ink-subtle">
      {section.sourcePath.replace(/^\.\//, '')}
    </span>
  );
}

function GoalCard({ section }: { section: ResolvedSection }) {
  return (
    <SectionShell
      icon={<Target size={12} strokeWidth={1.7} />}
      eyebrow="goal"
      rightSlot={<IncludeBadge section={section} />}
    >
      <MarkdownView>{section.body}</MarkdownView>
    </SectionShell>
  );
}

function StepsBlock({ steps }: { steps: ResolvedStep[] }) {
  return (
    <SectionShell
      icon={<ListOrdered size={12} strokeWidth={1.7} />}
      eyebrow={`steps · ${steps.length}`}
    >
      <ol className="space-y-5">
        {steps.map((step, i) => (
          <li key={step.id ?? i} className="grid grid-cols-[28px_1fr] gap-3">
            <span className="flex h-6 w-6 items-center justify-center rounded-full border border-stone bg-paper-sunken font-mono text-2xs text-ink-muted">
              {i + 1}
            </span>
            <div className="min-w-0">
              <div className="flex items-baseline justify-between gap-3 border-b border-stone-subtle pb-1.5">
                <h3 className="font-display text-base text-ink leading-tight">{step.title}</h3>
                {step.id && (
                  <span className="font-mono text-2xs uppercase tracking-code text-ink-subtle">
                    {step.id}
                  </span>
                )}
              </div>
              {step.body.kind === 'include' && step.body.sourcePath && (
                <p className="mt-1 font-mono text-2xs text-ink-subtle">
                  {step.body.sourcePath.replace(/^\.\//, '')}
                </p>
              )}
              <div className="mt-2">
                <MarkdownView compact>{step.body.body}</MarkdownView>
              </div>
            </div>
          </li>
        ))}
      </ol>
    </SectionShell>
  );
}

function RulesBlock({ rules }: { rules: ResolvedRule[] }) {
  return (
    <SectionShell
      icon={<ShieldAlert size={12} strokeWidth={1.7} />}
      eyebrow={`rules · ${rules.length}`}
    >
      <div className="space-y-5">
        {rules.map((rule, i) => (
          <div key={i} className="border-l-2 border-cohere-purple-300 pl-4">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="font-display text-base text-ink leading-tight">{rule.title}</h3>
              {rule.body.kind === 'include' && rule.body.sourcePath && (
                <span className="font-mono text-2xs text-ink-subtle">
                  {rule.body.sourcePath.replace(/^\.\//, '')}
                </span>
              )}
            </div>
            {rule.appliesTo && rule.appliesTo.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                <span className="font-mono text-2xs uppercase tracking-code text-ink-subtle">
                  applies to
                </span>
                {rule.appliesTo.map((target) => (
                  <span
                    key={target}
                    className="rounded-sm border border-stone-subtle bg-paper-sunken px-1.5 py-0.5 font-mono text-2xs text-ink-muted"
                  >
                    {target}
                  </span>
                ))}
              </div>
            )}
            <div className="mt-2">
              <MarkdownView compact>{rule.body.body}</MarkdownView>
            </div>
          </div>
        ))}
      </div>
    </SectionShell>
  );
}

function OnFailureCard({ section }: { section: ResolvedSection }) {
  return (
    <SectionShell
      icon={<AlertTriangle size={12} strokeWidth={1.7} />}
      eyebrow="on failure"
      rightSlot={<IncludeBadge section={section} />}
    >
      <MarkdownView>{section.body}</MarkdownView>
    </SectionShell>
  );
}

function OverviewCard({ body }: { body: string }) {
  return (
    <SectionShell icon={<FileText size={12} strokeWidth={1.7} />} eyebrow="overview">
      <MarkdownView>{body}</MarkdownView>
    </SectionShell>
  );
}

// ─── Sidebar cards ─────────────────────────────────────────────────────────

function ToolsCard({ agent }: { agent: Agent }) {
  if (!agent.tools || agent.tools.length === 0) return null;
  return (
    <section>
      <p className="eyebrow mb-2">tools · {agent.tools.length}</p>
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
  );
}

function CapabilitiesCard({ needs }: { needs: string[] }) {
  return (
    <section>
      <p className="eyebrow mb-2">capabilities · {needs.length}</p>
      <div className="flex flex-wrap gap-1.5">
        {needs.map((cap) => (
          <span
            key={cap}
            className="rounded-sm border border-stone-subtle bg-paper-sunken px-2 py-0.5 font-mono text-2xs text-ink-muted"
          >
            {cap}
          </span>
        ))}
      </div>
    </section>
  );
}

function BudgetCard({ budget }: { budget: NonNullable<Agent['budget']> }) {
  return (
    <section>
      <p className="eyebrow mb-2">budget</p>
      <dl className="space-y-1 rounded-xl border border-stone-subtle bg-paper-sunken p-4">
        {budget.tokens != null && (
          <BudgetRow label="tokens" value={budget.tokens.toLocaleString()} />
        )}
        {budget.usd != null && <BudgetRow label="usd" value={`$${budget.usd.toFixed(2)}`} />}
        {budget.runtimeMs != null && (
          <BudgetRow label="runtime" value={`${(budget.runtimeMs / 1000).toFixed(0)}s`} />
        )}
      </dl>
    </section>
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

function PermissionsCard({ permissions }: { permissions: NonNullable<Agent['permissions']> }) {
  const groups: Array<{ label: string; items: string[] }> = [];
  if (permissions.network?.length) groups.push({ label: 'network', items: permissions.network });
  if (permissions.env?.length) groups.push({ label: 'env', items: permissions.env });
  if (permissions.fs?.read?.length)
    groups.push({ label: 'fs read', items: permissions.fs.read });
  if (permissions.fs?.write?.length)
    groups.push({ label: 'fs write', items: permissions.fs.write });
  if (groups.length === 0) return null;

  return (
    <section>
      <p className="eyebrow mb-2">permissions</p>
      <div className="space-y-3 rounded-xl border border-stone-subtle bg-paper-sunken p-4">
        {groups.map((g) => (
          <div key={g.label}>
            <p className="mb-1 font-mono text-2xs uppercase tracking-code text-ink-subtle">
              {g.label}
            </p>
            <ul className="space-y-0.5">
              {g.items.map((it) => (
                <li key={it} className="font-mono text-xs text-ink">
                  {it}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

// ─── Source tab ────────────────────────────────────────────────────────────

interface SourceFile {
  path: string;
  content: string;
  isMaster: boolean;
}

function Source({ agent }: { agent: Agent }) {
  const files: SourceFile[] = useMemo(
    () => [
      { path: agent.sourcePath, content: agent.raw, isMaster: true },
      ...agent.includedFiles.map((f) => ({ ...f, isMaster: false })),
    ],
    [agent],
  );

  const [selectedPath, setSelectedPath] = useState<string>(files[0]!.path);
  const selected = files.find((f) => f.path === selectedPath) ?? files[0]!;

  return (
    <div className="grid h-full grid-cols-[280px_1fr] overflow-hidden">
      <SourceTree
        files={files}
        selectedPath={selectedPath}
        onSelect={setSelectedPath}
      />
      <div className="overflow-y-auto bg-paper">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-stone-subtle bg-paper-raised px-5 py-2">
          <span className="flex items-center gap-2 font-mono text-2xs uppercase tracking-code text-ink-subtle">
            <FileCode size={11} />
            {selected.path.replace(/^\.\//, '')}
          </span>
          <span className="font-mono text-2xs uppercase tracking-code text-ink-subtle">
            {selected.content.split('\n').length} lines
            {selected.isMaster && (
              <>
                <span className="mx-2 opacity-50">·</span>master
              </>
            )}
          </span>
        </div>
        <CodeView
          code={selected.content}
          language={detectLanguage(selected.path)}
        />
      </div>
    </div>
  );
}

function detectLanguage(path: string): string {
  if (/\.ya?ml$/i.test(path)) return 'yaml';
  if (/\.markdown$|\.md$/i.test(path)) return 'markdown';
  return 'plaintext';
}

// ─── Source tree ───────────────────────────────────────────────────────────

interface TreeNode {
  name: string;
  fullPath?: string; // file leaves only
  isMaster?: boolean;
  children: TreeNode[];
}

function buildTree(files: SourceFile[]): TreeNode {
  const root: TreeNode = { name: '', children: [] };
  for (const file of files) {
    // Strip the leading "./"
    const parts = file.path.replace(/^\.\//, '').split('/');
    let node = root;
    parts.forEach((part, i) => {
      const isLast = i === parts.length - 1;
      let next = node.children.find((c) => c.name === part);
      if (!next) {
        next = { name: part, children: [] };
        node.children.push(next);
      }
      if (isLast) {
        next.fullPath = file.path;
        next.isMaster = file.isMaster;
      }
      node = next;
    });
  }
  // Sort: directories first, then files; alpha within each group
  const sortRecursive = (n: TreeNode) => {
    n.children.sort((a, b) => {
      const aIsDir = a.children.length > 0 && !a.fullPath;
      const bIsDir = b.children.length > 0 && !b.fullPath;
      if (aIsDir !== bIsDir) return aIsDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    n.children.forEach(sortRecursive);
  };
  sortRecursive(root);
  return root;
}

function SourceTree({
  files,
  selectedPath,
  onSelect,
}: {
  files: SourceFile[];
  selectedPath: string;
  onSelect: (p: string) => void;
}) {
  const tree = useMemo(() => buildTree(files), [files]);
  return (
    <aside className="flex flex-col overflow-y-auto border-r border-stone-subtle bg-paper-sunken">
      <div className="border-b border-stone-subtle px-4 py-3">
        <p className="eyebrow">file tree · {files.length}</p>
      </div>
      <ul className="flex flex-col py-2 text-sm">
        {tree.children.map((child, i) => (
          <TreeItem
            key={i}
            node={child}
            depth={0}
            selectedPath={selectedPath}
            onSelect={onSelect}
          />
        ))}
      </ul>
    </aside>
  );
}

function TreeItem({
  node,
  depth,
  selectedPath,
  onSelect,
}: {
  node: TreeNode;
  depth: number;
  selectedPath: string;
  onSelect: (p: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const isFile = !!node.fullPath;
  const isSelected = node.fullPath === selectedPath;

  if (isFile) {
    return (
      <li>
        <button
          onClick={() => onSelect(node.fullPath!)}
          style={{ paddingLeft: `${depth * 14 + 16}px` }}
          className={cn(
            'flex w-full items-center gap-2 py-1 pr-3 text-left transition-colors',
            isSelected
              ? 'bg-paper text-ink'
              : 'text-ink-muted hover:bg-paper/60 hover:text-ink',
          )}
        >
          <FileCode size={11} className="shrink-0 opacity-60" />
          <span className="truncate font-mono text-xs">{node.name}</span>
          {node.isMaster && (
            <span className="ml-auto rounded-sm border border-cohere-purple-300 bg-cohere-purple-50 px-1 py-0 font-mono text-2xs uppercase tracking-code text-cohere-purple-700">
              master
            </span>
          )}
        </button>
      </li>
    );
  }

  // Directory
  return (
    <li>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{ paddingLeft: `${depth * 14 + 16}px` }}
        className="flex w-full items-center gap-1 py-1 pr-3 text-left text-ink-subtle hover:text-ink"
      >
        <ChevronRight
          size={11}
          className={cn('shrink-0 transition-transform', open && 'rotate-90')}
        />
        <span className="truncate font-mono text-xs">{node.name}/</span>
      </button>
      {open && (
        <ul>
          {node.children.map((child, i) => (
            <TreeItem
              key={i}
              node={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
