import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Brain, Wrench, MessageSquare, Zap, CheckCircle2, AlertCircle, Pause } from 'lucide-react';
import type { StepStatus } from '@flowstate/core';
import { cn } from '@/lib/cn';
import { statusDot, statusLabel, statusRing } from './node-styles';

export type FlowNodeData = {
  kind: 'trigger' | 'thinking' | 'tool_call' | 'message' | 'done' | 'awaiting' | 'error';
  label: string;
  detail?: string;
  status: StepStatus;
  toolId?: string;
  durationMs?: number;
  tokens?: number;
};

const KIND_ICON = {
  trigger: Zap,
  thinking: Brain,
  tool_call: Wrench,
  message: MessageSquare,
  done: CheckCircle2,
  awaiting: Pause,
  error: AlertCircle,
};

const KIND_LABEL = {
  trigger: 'TRIGGER',
  thinking: 'THINKING',
  tool_call: 'TOOL',
  message: 'MESSAGE',
  done: 'DONE',
  awaiting: 'AWAITING',
  error: 'ERROR',
};

export function FlowNode({ data }: NodeProps) {
  const d = data as unknown as FlowNodeData;
  const Icon = KIND_ICON[d.kind];

  return (
    <div
      className={cn(
        // Cohere card on the canvas — 22px radius, hairline border, no shadow
        'relative w-[260px] rounded-xl border border-stone-subtle bg-paper transition-all',
        statusRing(d.status),
      )}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!h-1.5 !w-1.5 !border-paper !bg-stone-strong"
      />

      {/* Header strip — minimal, mono uppercase */}
      <div className="flex items-center gap-2 border-b border-stone-subtle px-3 py-2">
        <span
          className={cn(
            'flex h-6 w-6 items-center justify-center rounded-md border border-stone-subtle bg-paper-sunken text-ink-muted',
            d.status === 'running' && 'border-accent-300 text-accent-500',
            d.status === 'failed' && 'border-err/60 text-err',
            d.status === 'completed' && 'text-ink',
          )}
        >
          <Icon size={12} strokeWidth={1.7} />
        </span>
        <span className="font-mono text-2xs uppercase tracking-code text-ink-subtle">
          {KIND_LABEL[d.kind]}
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          <span className={cn('h-1.5 w-1.5 rounded-full', statusDot(d.status))} />
          <span className="font-mono text-2xs uppercase tracking-code text-ink-subtle">
            {statusLabel(d.status)}
          </span>
        </span>
      </div>

      {/* Body */}
      <div className="px-3 py-3">
        <p
          className="font-display text-sm leading-snug text-ink"
        >
          {d.label}
        </p>
        {d.detail && (
          <p className="mt-1 line-clamp-2 text-2xs leading-relaxed text-ink-muted">{d.detail}</p>
        )}
        {d.toolId && (
          <span className="mt-2 inline-block rounded-sm border border-stone-subtle px-1.5 py-0.5 font-mono text-2xs uppercase tracking-code text-ink-subtle">
            {d.toolId}
          </span>
        )}
      </div>

      {/* Footer — telemetry */}
      {(d.durationMs !== undefined || d.tokens !== undefined) && (
        <div className="flex items-center gap-3 border-t border-stone-subtle bg-paper-sunken px-3 py-1.5 font-mono text-2xs uppercase tracking-code text-ink-subtle">
          {d.durationMs !== undefined && <span>{formatDuration(d.durationMs)}</span>}
          {d.tokens !== undefined && <span>· {d.tokens} TOK</span>}
        </div>
      )}

      <Handle
        type="source"
        position={Position.Right}
        className="!h-1.5 !w-1.5 !border-paper !bg-stone-strong"
      />
    </div>
  );
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}MS`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}S`;
  return `${Math.floor(ms / 60_000)}M ${Math.floor((ms % 60_000) / 1000)}S`;
}
