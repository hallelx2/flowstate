/**
 * Conductor chat thread — replaces the dumb composer's pass-through.
 *
 * Renders the chat as a vertical list of items (user message, assistant
 * text, tool calls with collapsed results, phase chips, dispatched-run
 * links, turn summaries) and surfaces inline prompt-cards above the
 * composer when the Conductor needs an approval or free-form input.
 *
 * Streaming is one-way from main: the conductor-store subscribes to
 * conductor:event on bind. Sending a turn just calls
 * `conductorStore.send(text)`.
 */

import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ChevronDown,
  ChevronRight,
  Activity,
  ArrowUpRight,
  Check,
  AlertTriangle,
  Square,
  X,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import {
  conductorStore,
  useConductor,
  type ChatItem,
  type ToastEntry,
} from '@/lib/conductor-store';
import { MarkdownView } from '@/components/prose/markdown-view';
import { Button } from '@/components/ui/button';
import { ApprovalCard, UserInputCard } from './inline-prompt-card';

export function ConductorThread() {
  const state = useConductor();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Lazy-start once the thread first mounts.
  useEffect(() => {
    if (state.status === 'idle') void conductorStore.start();
  }, [state.status]);

  // Auto-scroll to bottom on new items. Reading items.length inside the
  // effect is intentional — the React rule is "every reactive value" but
  // we only care about appended-row triggers, not item content shuffles.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.items.length]);

  return (
    <div className="relative flex h-full flex-col">
      {/* Toasts — float above the thread, never blocking input */}
      <ToastStack toasts={state.toasts} />

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-2 py-4">
        {state.items.length === 0 && (
          <div className="text-center text-sm text-ink-subtle">
            {state.status === 'starting'
              ? 'Booting Conductor…'
              : 'Send a message to get started.'}
          </div>
        )}
        <ul className="flex flex-col gap-3">
          {state.items.map((it, i) => (
            <ChatRow key={`${it.kind}-${i}-${'turnId' in it ? it.turnId : ''}`} item={it} />
          ))}
        </ul>
        {state.status === 'thinking' && !state.pendingApproval && !state.pendingUserInput && (
          <div className="mt-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-2xs text-ink-subtle">
              <Activity size={11} className="animate-pulse" /> thinking…
            </div>
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => void conductorStore.interrupt()}
            >
              <Square size={10} /> stop
            </Button>
          </div>
        )}
      </div>

      {/* Inline prompt cards stack above the composer */}
      {(state.pendingApproval || state.pendingUserInput) && (
        <div className="border-t border-stone-subtle bg-paper-sunken px-3 py-3">
          {state.pendingApproval && (
            <ApprovalCard
              toolName={state.pendingApproval.toolName}
              input={state.pendingApproval.input}
            />
          )}
          {state.pendingUserInput && (
            <UserInputCard
              question={state.pendingUserInput.question}
              placeholder={state.pendingUserInput.placeholder}
              secret={state.pendingUserInput.secret}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ─── Toast stack ──────────────────────────────────────────────────────────

function ToastStack({ toasts }: { toasts: ToastEntry[] }) {
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none absolute right-3 top-3 z-10 flex flex-col gap-2">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className={cn(
              'pointer-events-auto flex max-w-xs items-start gap-2 rounded-lg border px-3 py-2 text-xs shadow-lift',
              t.kind === 'error' && 'border-err/40 bg-err/10 text-ink',
              t.kind === 'warn' && 'border-warn/40 bg-warn/10 text-ink',
              t.kind === 'info' && 'border-stone-subtle bg-paper text-ink',
            )}
          >
            <span className="flex-1">{t.text}</span>
            <button
              type="button"
              onClick={() => conductorStore.dismissToast(t.id)}
              className="shrink-0 text-ink-subtle transition-colors hover:text-ink"
            >
              <X size={11} />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

// ─── Row renderers ────────────────────────────────────────────────────────

function ChatRow({ item }: { item: ChatItem }) {
  switch (item.kind) {
    case 'user':
      return <UserBubble text={item.text} />;
    case 'assistant-text':
      return <AssistantText text={item.text} />;
    case 'tool-call':
      return <ToolCallRow item={item} />;
    case 'phase':
      return <PhaseRow phase={item.phase} subagent={item.subagent} />;
    case 'dispatch':
      return <DispatchRow runId={item.runId} />;
    case 'turn-summary':
      return <TurnSummary tokensIn={item.tokensIn} tokensOut={item.tokensOut} costUsd={item.costUsd} />;
    case 'turn-error':
      return <TurnError error={item.error} />;
    case 'approval-feedback':
      return <ApprovalFeedbackRow toolName={item.toolName} approved={item.approved} />;
  }
}

function ApprovalFeedbackRow({
  toolName,
  approved,
}: {
  toolName: string;
  approved: boolean;
}) {
  const short = toolName.replace(/^mcp__flowstate__/, '');
  return (
    <li className="flex items-center gap-2 text-2xs">
      <span
        className={cn(
          'inline-flex items-center gap-1 font-mono uppercase tracking-code',
          approved ? 'text-ok' : 'text-err',
        )}
      >
        {approved ? <Check size={10} /> : <X size={10} />}
        {approved ? 'approved' : 'denied'}
      </span>
      <span className="font-mono text-ink-subtle">{short}</span>
    </li>
  );
}

function UserBubble({ text }: { text: string }) {
  return (
    <li className="self-end max-w-[85%]">
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl bg-ink px-4 py-2 text-sm text-paper"
      >
        {text}
      </motion.div>
    </li>
  );
}

function AssistantText({ text }: { text: string }) {
  return (
    <li>
      <motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-sm text-ink"
      >
        <MarkdownView compact>{text}</MarkdownView>
      </motion.div>
    </li>
  );
}

function ToolCallRow({
  item,
}: {
  item: Extract<ChatItem, { kind: 'tool-call' }>;
}) {
  const [open, setOpen] = useState(false);
  const shortName = item.toolName.replace(/^mcp__flowstate__/, '').replace(/^mcp__/, '');
  const status = item.result == null ? 'running' : item.isError ? 'error' : 'ok';
  return (
    <li className="rounded-md border border-stone-subtle bg-paper-sunken px-3 py-2">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 text-left"
      >
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        <span className="font-mono text-2xs text-ink">{shortName}</span>
        <span
          className={cn(
            'ml-auto inline-flex items-center gap-1 font-mono text-2xs uppercase',
            status === 'running' && 'text-ink-subtle',
            status === 'ok' && 'text-ok',
            status === 'error' && 'text-err',
          )}
        >
          {status === 'running' && <Activity size={9} className="animate-pulse" />}
          {status === 'ok' && <Check size={9} />}
          {status === 'error' && <AlertTriangle size={9} />}
          {status}
        </span>
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          <div>
            <p className="font-mono text-2xs uppercase tracking-code text-ink-subtle">
              input
            </p>
            <pre className="mt-1 max-h-40 overflow-y-auto rounded bg-paper p-2 font-mono text-2xs text-ink-muted">
              {JSON.stringify(item.input, null, 2)}
            </pre>
          </div>
          {item.result != null && (
            <div>
              <p className="font-mono text-2xs uppercase tracking-code text-ink-subtle">
                result
              </p>
              <pre className="mt-1 max-h-60 overflow-y-auto rounded bg-paper p-2 font-mono text-2xs text-ink-muted">
                {typeof item.result === 'string'
                  ? item.result
                  : JSON.stringify(item.result, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function PhaseRow({ phase, subagent }: { phase: 'start' | 'stop'; subagent?: string }) {
  if (!subagent) return null;
  return (
    <li className="flex items-center gap-2 text-2xs text-ink-subtle">
      <span
        className={cn(
          'inline-block h-1.5 w-1.5 rounded-full',
          phase === 'start' ? 'bg-cohere-purple-500 animate-pulse' : 'bg-stone',
        )}
      />
      <span className="font-mono uppercase tracking-code">
        {phase === 'start' ? `${subagent} thinking…` : `${subagent} done`}
      </span>
    </li>
  );
}

function DispatchRow({ runId }: { runId: string }) {
  return (
    <li className="flex items-center gap-2 rounded-md border border-cohere-purple-300 bg-cohere-purple-50 px-3 py-2 text-xs text-cohere-purple-700">
      <ArrowUpRight size={11} />
      <span className="font-mono">dispatched run · {runId.slice(0, 12)}</span>
      <span className="ml-auto text-2xs">live in the timeline →</span>
    </li>
  );
}

function TurnSummary({
  tokensIn,
  tokensOut,
  costUsd,
}: {
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
}) {
  return (
    <li className="flex items-center gap-3 text-2xs text-ink-subtle">
      <span className="font-mono">
        {tokensIn}↓ {tokensOut}↑
      </span>
      {costUsd > 0 && <span className="font-mono">${costUsd.toFixed(4)}</span>}
    </li>
  );
}

function TurnError({ error }: { error: string }) {
  return (
    <li className="rounded-md border border-err/40 bg-err/10 px-3 py-2 text-xs text-ink-muted">
      <span className="font-mono text-2xs uppercase tracking-code text-err">error</span>{' '}
      {error}
    </li>
  );
}
