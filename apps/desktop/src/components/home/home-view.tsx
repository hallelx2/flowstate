import { useState } from 'react';
import { motion } from 'motion/react';
import { Sparkles, ArrowUpRight, Wrench, Workflow, Plus, Command } from 'lucide-react';
import { cn } from '@/lib/cn';
import { startSdkRun } from '@/lib/sdk-runner';

interface Props {
  onOpenTools: () => void;
  onOpenFlow: () => void;
  onRunStarted: () => void;
}

const SUGGESTED = [
  {
    id: 'inbox-triage',
    title: 'Triage my inbox',
    sub: 'Sort, label, and draft replies for unread email from this week',
    tools: ['gmail', 'notion'],
  },
  {
    id: 'release-notes',
    title: 'Draft release notes',
    sub: 'From the last 7 days of merged PRs',
    tools: ['gh', 'linear'],
  },
  {
    id: 'expense-report',
    title: 'Reconcile expenses',
    sub: 'Match the bank export to receipts in Drive',
    tools: ['drive', 'sheets'],
  },
];

export function HomeView({ onOpenTools, onOpenFlow, onRunStarted }: Props) {
  const [draft, setDraft] = useState('');
  const greeting = useGreeting();

  const handleStart = () => {
    if (!draft.trim()) return;
    startSdkRun({
      agentId: null, // ad-hoc run
      agentName: 'Ad-hoc',
      prompt: draft.trim(),
      // No system prompt — Claude reasons from the user prompt directly.
      // Tools default to the SDK built-ins (Read/Write/Edit/Bash).
    });
    setDraft('');
    onRunStarted();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handleStart();
    }
  };

  return (
    <div className="relative h-full w-full overflow-y-auto bg-paper">
      {/* Cohere-soft purple wash, subtle — only at the very top */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[180px] bg-cohere-soft" />

      <div className="relative mx-auto grid max-w-6xl grid-cols-12 gap-10 px-12 pb-24 pt-16">
        {/* ─── Left column · the working area ─── */}
        <div className="col-span-8 flex flex-col">
          {/* Greeting */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, ease: [0.2, 0.8, 0.2, 1] }}
            className="mb-12"
          >
            <p className="eyebrow mb-3">{greeting.label}</p>
            <h1
              className="font-display text-5xl text-ink"
            >
              {greeting.headline}
              <span className="ml-1 italic font-light text-ink-subtle">.</span>
            </h1>
            <p className="mt-4 max-w-xl text-base text-ink-muted">
              What should we work on together? Describe it the way you'd describe it to a&nbsp;teammate.
            </p>
          </motion.div>

          {/* The composer — Cohere card, focus turns border to Focus Purple */}
          <motion.section
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.08, ease: [0.2, 0.8, 0.2, 1] }}
            className="group relative overflow-hidden rounded-xl border border-stone bg-paper-raised transition-colors focus-within:border-cohere-purple-focus"
          >
            <div className="flex items-center gap-2 border-b border-stone-subtle px-5 py-2.5">
              <Sparkles size={13} className="text-ink-muted" strokeWidth={1.7} />
              <span className="eyebrow">composer</span>
              <span className="ml-auto flex items-center gap-1 font-mono text-2xs uppercase tracking-code text-ink-subtle">
                <Command size={10} />
                <span>↵ to start</span>
              </span>
            </div>

            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Send a thank-you note to everyone who attended yesterday's webinar — pull the list from the Eventbrite export in Drive."
              rows={5}
              className={cn(
                'w-full resize-none bg-transparent px-5 py-5 font-sans text-base leading-relaxed text-ink placeholder:text-ink-subtle',
                'focus:outline-none',
              )}
            />

            <div className="flex items-center justify-between border-t border-stone-subtle bg-paper-sunken px-3 py-2">
              <div className="flex items-center gap-1">
                <ChipButton icon={<Wrench size={11} />} label="tools" onClick={onOpenTools} />
                <ChipButton icon={<Workflow size={11} />} label="flow" onClick={onOpenFlow} />
                <ChipButton icon={<Plus size={11} />} label="attach" />
              </div>

              <button
                onClick={handleStart}
                className={cn(
                  'group/btn inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all',
                  draft.trim()
                    ? 'bg-ink text-paper hover:bg-accent-600'
                    : 'cursor-not-allowed bg-stone-subtle text-ink-subtle',
                )}
                disabled={!draft.trim()}
              >
                start
                <ArrowUpRight
                  size={13}
                  className="transition-transform group-hover/btn:-translate-y-px group-hover/btn:translate-x-px"
                />
              </button>
            </div>
          </motion.section>

          {/* Suggested — asymmetric editorial composition */}
          <motion.section
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.18 }}
            className="mt-14"
          >
            <div className="mb-5 flex items-end justify-between border-b border-stone-subtle pb-3">
              <h2
                className="font-display text-2xl text-ink"
              >
                Or pick up something familiar
              </h2>
              <span className="eyebrow">3 templates</span>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {SUGGESTED.map((s, i) => (
                <motion.button
                  key={s.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.45, delay: 0.22 + i * 0.06 }}
                  className="group flex flex-col items-start gap-2 rounded-xl border border-stone-subtle bg-paper-raised p-4 text-left transition-all hover:border-stone-strong hover:shadow-lift"
                >
                  <div className="flex w-full items-center justify-between">
                    <span
                      className="font-display text-base text-ink"
                    >
                      {s.title}
                    </span>
                    <ArrowUpRight
                      size={13}
                      className="text-ink-subtle transition-all group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-accent-500"
                    />
                  </div>
                  <p className="text-xs leading-relaxed text-ink-muted">{s.sub}</p>
                  <div className="mt-2 flex items-center gap-1.5">
                    {s.tools.map((t) => (
                      <span
                        key={t}
                        className="rounded-sm border border-stone-subtle px-1.5 py-0.5 font-mono text-2xs uppercase tracking-code text-ink-subtle"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                </motion.button>
              ))}
            </div>
          </motion.section>
        </div>

        {/* ─── Right column · sidecar ─── */}
        <aside className="col-span-4 flex flex-col gap-8 pt-[116px]">
          {/* Recent runs */}
          <motion.section
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.32 }}
          >
            <p className="eyebrow mb-3">recent runs · yesterday</p>
            <ul className="divide-y divide-stone-subtle border-y border-stone-subtle">
              {RECENT.map((r) => (
                <li key={r.id} className="flex items-center justify-between py-2.5 text-sm">
                  <span className="flex items-center gap-2.5 truncate">
                    <span
                      className={cn(
                        'h-1.5 w-1.5 shrink-0 rounded-full',
                        r.status === 'ok' ? 'bg-ok' : r.status === 'failed' ? 'bg-err' : 'bg-warn',
                      )}
                    />
                    <span className="truncate text-ink">{r.label}</span>
                  </span>
                  <span className="ml-2 shrink-0 font-mono text-2xs uppercase tracking-code text-ink-subtle">
                    {r.when}
                  </span>
                </li>
              ))}
            </ul>
          </motion.section>

          {/* Active tools — small pictogram strip */}
          <motion.section
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.42 }}
          >
            <p className="eyebrow mb-3">connected · 7 tools</p>
            <div className="flex flex-wrap gap-2">
              {['gmail', 'github', 'gcloud', 'stripe', 'notion', 'linear', 'slack'].map((t) => (
                <span
                  key={t}
                  className="rounded-sm border border-stone-subtle bg-paper px-2 py-1 font-mono text-2xs uppercase tracking-code text-ink-muted"
                >
                  {t}
                </span>
              ))}
            </div>
          </motion.section>

          {/* Tip */}
          <motion.section
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.52 }}
            className="rounded-xl border border-stone-subtle bg-paper-sunken p-4"
          >
            <p className="eyebrow mb-2">tip</p>
            <p className="text-sm leading-relaxed text-ink-muted">
              Press <kbd className="rounded border border-stone bg-paper px-1.5 py-0.5 font-mono text-2xs">⌘ K</kbd>{' '}
              to summon the composer from anywhere — even from inside another agent's run.
            </p>
          </motion.section>
        </aside>
      </div>
    </div>
  );
}

function ChipButton({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-md px-2 py-1 font-mono text-2xs uppercase tracking-code text-ink-muted transition-colors hover:bg-paper-raised hover:text-ink"
    >
      {icon}
      {label}
    </button>
  );
}

const RECENT = [
  { id: '1', label: 'Triage inbox · 14 sorted', status: 'ok' as const, when: '2:14p' },
  { id: '2', label: 'Deploy preview · staging', status: 'ok' as const, when: '11:02a' },
  { id: '3', label: 'Sync notes to Notion', status: 'failed' as const, when: '9:48a' },
];

function useGreeting() {
  const hour = new Date().getHours();
  if (hour < 5) return { label: 'late · ' + new Date().toLocaleDateString(), headline: 'Still up' };
  if (hour < 12) return { label: 'morning', headline: 'Good morning' };
  if (hour < 17) return { label: 'afternoon', headline: 'Good afternoon' };
  if (hour < 21) return { label: 'evening', headline: 'Good evening' };
  return { label: 'night', headline: 'Working late' };
}
