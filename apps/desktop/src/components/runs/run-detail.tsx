import { useMemo } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  type Edge,
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { motion, AnimatePresence } from 'motion/react';
import { Pause, RotateCcw, X as XIcon } from 'lucide-react';
import type { Run } from '@/lib/run-store';
import { FlowNode, type FlowNodeData } from '@/components/flow/nodes';
import { formatDuration, statusDotColor, statusLabel } from './run-utils';
import { cn } from '@/lib/cn';
import { ApprovalBanner } from './approval-banner';

const nodeTypes = { flow: FlowNode };

interface Props {
  run: Run;
}

export function RunDetail({ run }: Props) {
  const { nodes, edges } = useMemo(() => buildFlow(run), [run]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Human-in-the-loop approval banner — only shown while waiting */}
      <AnimatePresence>
        {run.pendingApproval && (
          <ApprovalBanner runId={run.id} approval={run.pendingApproval} />
        )}
      </AnimatePresence>

      {/* Header */}
      <header className="shrink-0 border-b border-stone-subtle bg-paper px-10 pb-5 pt-9">
        <div className="flex items-center gap-2">
          <span className={cn('h-1.5 w-1.5 rounded-full', statusDotColor(run.status))} />
          <span className="font-mono text-2xs uppercase tracking-code-wide text-ink-subtle">
            RUN · {run.id} · {statusLabel(run.status).toUpperCase()}
          </span>
        </div>

        <div className="mt-3 flex items-end justify-between gap-6">
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-3xl text-ink leading-tight">
              {run.agentName}
              {!run.agentId && (
                <span className="ml-2 align-middle font-mono text-2xs uppercase tracking-code text-ink-subtle">
                  ad-hoc
                </span>
              )}
            </h1>
            {run.prompt && (
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-muted line-clamp-2">
                <span className="text-ink-subtle">prompt · </span>
                {run.prompt}
              </p>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <RunStat label="step" value={`${countDoneSteps(run)} / ${run.steps.length}`} />
            <RunStat label="tokens" value={formatTokens(run.totals.tokensIn + run.totals.tokensOut)} />
            <RunStat label="cost" value={`$${run.totals.costUsd.toFixed(3)}`} />
            <RunStat label="elapsed" value={formatDuration(run.totals.durationMs)} />
          </div>
        </div>

        <div className="mt-5 flex items-center gap-2">
          {run.status === 'running' && (
            <>
              <ControlButton icon={<Pause size={11} />} label="pause" />
              <ControlButton icon={<XIcon size={11} />} label="cancel" />
            </>
          )}
          {(run.status === 'completed' || run.status === 'failed') && (
            <ControlButton icon={<RotateCcw size={11} />} label="re-run" />
          )}
          <span className="ml-auto font-mono text-2xs uppercase tracking-code text-ink-subtle">
            view · spatial trace
          </span>
        </div>
      </header>

      {/* Canvas */}
      <div className="relative flex-1 bg-paper">
        {nodes.length === 0 ? (
          <EmptyCanvas status={run.status} />
        ) : (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3 }}
            className="absolute inset-0"
          >
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              fitView
              fitViewOptions={{ padding: 0.25 }}
              proOptions={{ hideAttribution: true }}
              minZoom={0.4}
              maxZoom={1.6}
              defaultEdgeOptions={{
                animated: false,
                style: { stroke: 'hsl(240 5% 80%)', strokeWidth: 1 },
              }}
            >
              <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="hsl(220 8% 84%)" />
              <Controls
                showInteractive={false}
                className="!rounded-xl !border !border-stone !bg-paper-raised"
              />
            </ReactFlow>
          </motion.div>
        )}

        {/* Live ticker for running runs */}
        {run.status === 'running' && (
          <div className="pointer-events-none absolute bottom-5 left-1/2 -translate-x-1/2">
            <div className="pointer-events-auto flex items-center gap-2.5 rounded-full border border-stone bg-paper px-4 py-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-accent-500 animate-pulse-blue" />
              <span className="font-mono text-2xs uppercase tracking-code text-ink">
                {currentLabel(run)}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyCanvas({ status }: { status: Run['status'] }) {
  return (
    <div className="flex h-full flex-col items-center justify-center text-center">
      <p className="font-display text-xl text-ink">
        {status === 'queued' ? 'Queued — waiting for runtime…' : 'No steps recorded'}
      </p>
      <p className="mt-1.5 max-w-sm text-sm text-ink-muted">
        Steps will appear here as the agent works through them.
      </p>
    </div>
  );
}

function RunStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-end rounded-md border border-stone-subtle bg-paper px-2.5 py-1">
      <span className="font-mono text-2xs uppercase tracking-code-wide text-ink-subtle">{label}</span>
      <span className="font-mono text-xs text-ink">{value}</span>
    </div>
  );
}

function ControlButton({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <button className="btn-outline px-2.5 py-1 text-xs">
      {icon}
      {label}
    </button>
  );
}

function countDoneSteps(run: Run): number {
  return run.steps.filter((s) => s.status === 'completed' || s.status === 'failed').length;
}

function currentLabel(run: Run): string {
  const running = run.steps.find((s) => s.status === 'running');
  if (running) {
    return running.toolId
      ? `CALLING ${running.toolId}`
      : running.label.toUpperCase().slice(0, 56);
  }
  return 'RUNNING';
}

function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

// ─── Build the flow graph from a Run ──────────────────────────────────────

function buildFlow(run: Run): { nodes: Node[]; edges: Edge[] } {
  if (run.steps.length === 0) return { nodes: [], edges: [] };

  // Linear layout: 320px gap horizontally
  const nodes: Node[] = run.steps.map((step, i) => {
    const data: FlowNodeData = {
      kind: step.kind === 'tool_result' ? 'tool_call' : (step.kind as FlowNodeData['kind']),
      label: step.label,
      detail: step.detail,
      status: step.status,
      toolId: step.toolId,
      durationMs:
        step.endedAt && step.startedAt
          ? new Date(step.endedAt).getTime() - new Date(step.startedAt).getTime()
          : undefined,
      tokens: step.tokens ? step.tokens.input + step.tokens.output : undefined,
    };
    return {
      id: step.id,
      type: 'flow',
      position: { x: i * 320, y: 200 },
      data: data as unknown as Record<string, unknown>,
    };
  });

  const edges: Edge[] = [];
  for (let i = 0; i < run.steps.length - 1; i++) {
    const from = run.steps[i]!;
    const to = run.steps[i + 1]!;
    const animated = from.status === 'completed' && to.status === 'running';
    edges.push({
      id: `e_${from.id}_${to.id}`,
      source: from.id,
      target: to.id,
      type: 'smoothstep',
      animated,
      style: {
        stroke: animated ? 'hsl(218 75% 47%)' : 'hsl(240 5% 80%)',
        strokeWidth: animated ? 1.4 : 1,
      },
    });
  }

  return { nodes, edges };
}
