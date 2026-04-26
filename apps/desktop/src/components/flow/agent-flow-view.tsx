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
import { motion } from 'motion/react';
import { Play, Pause, RotateCcw } from 'lucide-react';
import { FlowNode, type FlowNodeData } from './nodes';

const nodeTypes = { flow: FlowNode };

/**
 * Spatial trace of a live agent run.
 * Cohere-style: white canvas, dotted grid, sharp hairline nodes,
 * Interaction Blue for the "running" state, almost no shadow.
 */
export function AgentFlowView() {
  const { nodes, edges } = useMemo(() => buildSampleFlow(), []);

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-paper">
      {/* ─── Editorial header ─── */}
      <div className="relative shrink-0 border-b border-stone-subtle bg-paper px-12 pb-5 pt-9">
        <div className="absolute left-12 top-7 flex items-center gap-2">
          <span className="block h-1.5 w-1.5 rounded-sm bg-cohere-purple-500" />
          <span className="font-mono text-2xs uppercase tracking-codeWide text-ink-subtle">
            LIVE RUN · REFUND-HANDLER
          </span>
        </div>

        <div className="mt-7 flex items-end justify-between">
          <div>
            <h1
              className="font-display text-4xl text-ink"
            >
              Watching the agent <span className="italic font-light text-ink-subtle">think</span>.
            </h1>
            <p className="mt-2 max-w-xl text-sm text-ink-muted">
              Every tool call, every decision, every retry — laid out spatially so nothing happens
              behind your back.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <RunStat label="step" value="4 / 6" />
            <RunStat label="tokens" value="12.4k" />
            <RunStat label="cost" value="$0.04" />
            <RunStat label="elapsed" value="22s" />
          </div>
        </div>

        <div className="mt-6 flex items-center gap-2">
          <ControlButton icon={<Pause size={11} />} label="pause" />
          <ControlButton icon={<RotateCcw size={11} />} label="replay" />
          <ControlButton icon={<Play size={11} />} label="resume" primary />
          <span className="ml-auto font-mono text-2xs uppercase tracking-code text-ink-subtle">
            view · spatial trace
          </span>
        </div>
      </div>

      {/* ─── Canvas ─── */}
      <div className="relative flex-1">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5 }}
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
            <Background
              variant={BackgroundVariant.Dots}
              gap={22}
              size={1}
              color="hsl(220 8% 84%)"
            />
            <Controls
              showInteractive={false}
              className="!rounded-xl !border !border-stone !bg-paper-raised"
            />
          </ReactFlow>
        </motion.div>

        {/* Live ticker — Cohere-style mono uppercase */}
        <div className="pointer-events-none absolute bottom-5 left-1/2 -translate-x-1/2">
          <div className="pointer-events-auto flex items-center gap-2.5 rounded-full border border-stone bg-paper px-4 py-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-accent-500 animate-pulseBlue" />
            <span className="font-mono text-2xs uppercase tracking-code text-ink">
              CALLING <span className="text-accent-500">stripe.refunds.create</span> · pi_1NkX
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function RunStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-end rounded-md border border-stone-subtle bg-paper px-2.5 py-1">
      <span className="font-mono text-2xs uppercase tracking-codeWide text-ink-subtle">{label}</span>
      <span className="font-mono text-xs text-ink">{value}</span>
    </div>
  );
}

function ControlButton({
  icon,
  label,
  primary,
}: {
  icon: React.ReactNode;
  label: string;
  primary?: boolean;
}) {
  if (primary) {
    return (
      <button className="btn-dark px-2.5 py-1 text-xs">
        {icon}
        {label}
      </button>
    );
  }
  return (
    <button className="btn-outline px-2.5 py-1 text-xs">
      {icon}
      {label}
    </button>
  );
}

/**
 * Demo trace: a refund-handler agent run.
 * Replace with real run-stream once the runtime emits events.
 */
function buildSampleFlow(): { nodes: Node[]; edges: Edge[] } {
  const make = (
    id: string,
    x: number,
    y: number,
    data: FlowNodeData,
  ): Node => ({
    id,
    type: 'flow',
    position: { x, y },
    data: data as unknown as Record<string, unknown>,
  });

  const nodes: Node[] = [
    make('n1', 0, 200, {
      kind: 'trigger',
      label: 'Webhook · /refund',
      detail: 'POST from billing dashboard',
      status: 'completed',
      durationMs: 12,
    }),
    make('n2', 320, 200, {
      kind: 'thinking',
      label: 'Verify request is in 30-day window',
      detail: 'Reading order metadata, checking purchase date',
      status: 'completed',
      durationMs: 1840,
      tokens: 4200,
    }),
    make('n3', 640, 60, {
      kind: 'tool_call',
      label: 'Fetch customer record',
      detail: 'Look up the buyer in Stripe',
      status: 'completed',
      toolId: 'stripe.customers.retrieve',
      durationMs: 410,
    }),
    make('n4', 640, 340, {
      kind: 'tool_call',
      label: 'Fetch original payment intent',
      detail: 'Need the PI to issue the refund against',
      status: 'completed',
      toolId: 'stripe.charges.list',
      durationMs: 380,
    }),
    make('n5', 980, 200, {
      kind: 'tool_call',
      label: 'Issue refund',
      detail: '$48.00 USD · reason: customer_request',
      status: 'running',
      toolId: 'stripe.refunds.create',
    }),
    make('n6', 1300, 80, {
      kind: 'tool_call',
      label: 'Email confirmation',
      status: 'pending',
      toolId: 'gmail.messages.send',
    }),
    make('n7', 1300, 320, {
      kind: 'tool_call',
      label: 'Post to #ops-billing',
      status: 'pending',
      toolId: 'slack.chat.post',
    }),
    make('n8', 1620, 200, {
      kind: 'done',
      label: 'Run complete',
      status: 'pending',
    }),
  ];

  const e = (id: string, source: string, target: string, animated = false): Edge => ({
    id,
    source,
    target,
    type: 'smoothstep',
    animated,
    style: {
      stroke: animated ? 'hsl(218 75% 47%)' : 'hsl(240 5% 80%)',
      strokeWidth: animated ? 1.4 : 1,
    },
  });

  const edges: Edge[] = [
    e('e1', 'n1', 'n2'),
    e('e2', 'n2', 'n3'),
    e('e3', 'n2', 'n4'),
    e('e4', 'n3', 'n5'),
    e('e5', 'n4', 'n5', true),
    e('e6', 'n5', 'n6'),
    e('e7', 'n5', 'n7'),
    e('e8', 'n6', 'n8'),
    e('e9', 'n7', 'n8'),
  ];

  return { nodes, edges };
}
