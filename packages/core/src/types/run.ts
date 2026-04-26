/**
 * Agent run telemetry — what powers the flow visualization.
 */

export type StepKind =
  | 'trigger'
  | 'thinking'
  | 'tool_call'
  | 'tool_result'
  | 'message'
  | 'awaiting_input'
  | 'error'
  | 'done';

export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface RunStep {
  id: string;
  parentId?: string;
  kind: StepKind;
  status: StepStatus;
  label: string;
  detail?: string;
  toolId?: string;
  toolAction?: string;
  inputs?: Record<string, unknown>;
  output?: unknown;
  startedAt: string;
  endedAt?: string;
  tokens?: { input: number; output: number };
  costUsd?: number;
}

export interface AgentRun {
  id: string;
  agentId: string;
  status: 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  trigger: { kind: string; payload?: unknown };
  steps: RunStep[];
  startedAt: string;
  endedAt?: string;
  totals?: {
    tokensIn: number;
    tokensOut: number;
    costUsd: number;
    durationMs: number;
  };
}
