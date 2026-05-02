/**
 * SQLite-backed run + run_step CRUD.
 *
 * Companion to `workspace-db.ts` — that module owns the database lifecycle
 * and the schema (`initSchema`); this one owns the read/write helpers for
 * the `runs` and `run_steps` tables.
 *
 * Two-layer persistence:
 *   - `runs` / `run_steps` tables — indexable summary; powers list views,
 *     run-detail rendering, and M4 analytics queries.
 *   - `~/.flowstate/runs/<run-id>.jsonl` — full transcript, append-only,
 *     crash-safe. Owned by `run-journal.ts` (M1 task #6); this module
 *     only stores the path on the run row.
 *
 * The two are kept in sync by `run-registry.ts` (M1 task #5), which is
 * the single writer for both. Reading: callers read from SQL for summary
 * data, JSONL only for full replay.
 */

import type { AgentRun, RunStep } from '@flowstate/core';
import { getDb } from './workspace-db';

// ─── Row types — direct mirror of the SQL schema ───────────────────────────

interface RunRow {
  id: string;
  agent_id: string;
  agent_name: string;
  workspace_id: string | null;
  status: AgentRun['status'];
  trigger_kind: string | null;
  trigger_payload: string | null;
  started_at: string;
  ended_at: string | null;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  duration_ms: number | null;
  journal_path: string | null;
}

interface RunStepRow {
  id: string;
  run_id: string;
  parent_id: string | null;
  seq: number;
  kind: RunStep['kind'];
  status: RunStep['status'];
  label: string;
  detail: string | null;
  tool_id: string | null;
  tool_action: string | null;
  inputs_json: string | null;
  output_json: string | null;
  started_at: string;
  ended_at: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  cost_usd: number | null;
}

/**
 * Returned by `listRuns` and `getRun` — superset of the IR's `AgentRun`
 * because we also surface `agentName` (snapshot taken at run start, so
 * historical runs survive renames/deletions of their agent file).
 */
export interface AgentRunRecord extends AgentRun {
  agentName: string;
  workspaceId: string | null;
  journalPath: string | null;
}

// ─── Row → IR mappers ──────────────────────────────────────────────────────

function rowToRun(r: RunRow, steps: RunStep[]): AgentRunRecord {
  let triggerPayload: unknown;
  if (r.trigger_payload != null) {
    try {
      triggerPayload = JSON.parse(r.trigger_payload);
    } catch {
      triggerPayload = r.trigger_payload;
    }
  }
  return {
    id: r.id,
    agentId: r.agent_id,
    agentName: r.agent_name,
    workspaceId: r.workspace_id,
    journalPath: r.journal_path,
    status: r.status,
    trigger: {
      kind: r.trigger_kind ?? 'manual',
      ...(triggerPayload !== undefined ? { payload: triggerPayload } : {}),
    },
    steps,
    startedAt: r.started_at,
    ...(r.ended_at != null ? { endedAt: r.ended_at } : {}),
    ...(r.duration_ms != null
      ? {
          totals: {
            tokensIn: r.tokens_in,
            tokensOut: r.tokens_out,
            costUsd: r.cost_usd,
            durationMs: r.duration_ms,
          },
        }
      : {}),
  };
}

function rowToStep(r: RunStepRow): RunStep {
  let inputs: Record<string, unknown> | undefined;
  let output: unknown;
  if (r.inputs_json) {
    try {
      const parsed = JSON.parse(r.inputs_json);
      if (parsed && typeof parsed === 'object') inputs = parsed as Record<string, unknown>;
    } catch {
      /* leave undefined */
    }
  }
  if (r.output_json) {
    try {
      output = JSON.parse(r.output_json);
    } catch {
      output = r.output_json;
    }
  }
  return {
    id: r.id,
    ...(r.parent_id != null ? { parentId: r.parent_id } : {}),
    kind: r.kind,
    status: r.status,
    label: r.label,
    ...(r.detail != null ? { detail: r.detail } : {}),
    ...(r.tool_id != null ? { toolId: r.tool_id } : {}),
    ...(r.tool_action != null ? { toolAction: r.tool_action } : {}),
    ...(inputs ? { inputs } : {}),
    ...(output !== undefined ? { output } : {}),
    startedAt: r.started_at,
    ...(r.ended_at != null ? { endedAt: r.ended_at } : {}),
    ...(r.tokens_in != null && r.tokens_out != null
      ? { tokens: { input: r.tokens_in, output: r.tokens_out } }
      : {}),
    ...(r.cost_usd != null ? { costUsd: r.cost_usd } : {}),
  };
}

// ─── Run CRUD ──────────────────────────────────────────────────────────────

export interface InsertRunInput {
  id: string;
  agentId: string;
  agentName: string;
  workspaceId?: string | null;
  status?: AgentRun['status'];
  triggerKind?: string | null;
  triggerPayload?: unknown;
  startedAt?: string;
  journalPath?: string | null;
}

/** Create a new run row. Idempotent under primary-key conflict (replaces). */
export function insertRun(input: InsertRunInput): void {
  const startedAt = input.startedAt ?? new Date().toISOString();
  const triggerPayload =
    input.triggerPayload === undefined ? null : JSON.stringify(input.triggerPayload);
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO runs
         (id, agent_id, agent_name, workspace_id, status,
          trigger_kind, trigger_payload, started_at, journal_path)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.id,
      input.agentId,
      input.agentName,
      input.workspaceId ?? null,
      input.status ?? 'running',
      input.triggerKind ?? null,
      triggerPayload,
      startedAt,
      input.journalPath ?? null,
    );
}

/**
 * Update status. When transitioning to a terminal state and `endedAt` is
 * not supplied, stamps the current time.
 */
export function setRunStatus(
  id: string,
  status: AgentRun['status'],
  endedAt?: string,
): void {
  const isTerminal =
    status === 'completed' || status === 'failed' || status === 'cancelled';
  const ended = endedAt ?? (isTerminal ? new Date().toISOString() : null);
  getDb()
    .prepare(
      `UPDATE runs
         SET status = ?,
             ended_at = COALESCE(?, ended_at)
       WHERE id = ?`,
    )
    .run(status, ended, id);
}

/** Update aggregate totals — called when the runtime emits a `result` message. */
export function setRunTotals(id: string, totals: NonNullable<AgentRun['totals']>): void {
  getDb()
    .prepare(
      `UPDATE runs
         SET tokens_in = ?, tokens_out = ?, cost_usd = ?, duration_ms = ?
       WHERE id = ?`,
    )
    .run(totals.tokensIn, totals.tokensOut, totals.costUsd, totals.durationMs, id);
}

/** Set the journal path after the JSONL file is created. */
export function setRunJournalPath(id: string, path: string): void {
  getDb().prepare(`UPDATE runs SET journal_path = ? WHERE id = ?`).run(path, id);
}

// ─── Step CRUD ─────────────────────────────────────────────────────────────

export interface AppendStepInput extends Omit<RunStep, 'tokens'> {
  runId: string;
  tokens?: { input: number; output: number };
}

/**
 * Append a step. `seq` is auto-assigned monotonically per run, so callers
 * don't have to track ordering — JSONL line index and `seq` agree.
 */
export function appendStep(input: AppendStepInput): void {
  const db = getDb();
  const next = db
    .prepare(
      `SELECT COALESCE(MAX(seq), -1) + 1 AS next FROM run_steps WHERE run_id = ?`,
    )
    .get(input.runId) as { next: number };

  const inputsJson = input.inputs ? JSON.stringify(input.inputs) : null;
  const outputJson = input.output !== undefined ? JSON.stringify(input.output) : null;

  db.prepare(
    `INSERT INTO run_steps
       (id, run_id, parent_id, seq, kind, status, label, detail,
        tool_id, tool_action, inputs_json, output_json,
        started_at, ended_at, tokens_in, tokens_out, cost_usd)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.id,
    input.runId,
    input.parentId ?? null,
    next.next,
    input.kind,
    input.status,
    input.label,
    input.detail ?? null,
    input.toolId ?? null,
    input.toolAction ?? null,
    inputsJson,
    outputJson,
    input.startedAt,
    input.endedAt ?? null,
    input.tokens?.input ?? null,
    input.tokens?.output ?? null,
    input.costUsd ?? null,
  );
}

export interface UpdateStepPatch {
  status?: RunStep['status'];
  detail?: string;
  output?: unknown;
  endedAt?: string;
  tokens?: { input: number; output: number };
  costUsd?: number;
}

/** Patch an existing step — typical use is flipping `running → completed/failed`. */
export function updateStep(stepId: string, patch: UpdateStepPatch): void {
  const fields: string[] = [];
  const values: unknown[] = [];
  if (patch.status !== undefined) {
    fields.push('status = ?');
    values.push(patch.status);
  }
  if (patch.detail !== undefined) {
    fields.push('detail = ?');
    values.push(patch.detail);
  }
  if (patch.output !== undefined) {
    fields.push('output_json = ?');
    values.push(JSON.stringify(patch.output));
  }
  if (patch.endedAt !== undefined) {
    fields.push('ended_at = ?');
    values.push(patch.endedAt);
  }
  if (patch.tokens !== undefined) {
    fields.push('tokens_in = ?', 'tokens_out = ?');
    values.push(patch.tokens.input, patch.tokens.output);
  }
  if (patch.costUsd !== undefined) {
    fields.push('cost_usd = ?');
    values.push(patch.costUsd);
  }
  if (fields.length === 0) return;
  values.push(stepId);
  getDb()
    .prepare(`UPDATE run_steps SET ${fields.join(', ')} WHERE id = ?`)
    .run(...values);
}

// ─── Reads ─────────────────────────────────────────────────────────────────

/** Full run record with all steps loaded — for the run-detail view. */
export function getRun(id: string): AgentRunRecord | null {
  const r = getDb().prepare('SELECT * FROM runs WHERE id = ?').get(id) as
    | RunRow
    | undefined;
  if (!r) return null;
  const stepRows = getDb()
    .prepare('SELECT * FROM run_steps WHERE run_id = ? ORDER BY seq ASC')
    .all(id) as RunStepRow[];
  return rowToRun(r, stepRows.map(rowToStep));
}

export interface ListRunsFilter {
  workspaceId?: string | null;
  agentId?: string;
  status?: AgentRun['status'] | AgentRun['status'][];
  limit?: number;
  offset?: number;
}

/**
 * Summary list — does NOT load steps. Callers needing the full trace
 * (run-detail) should call `getRun(id)`. Default limit 200.
 */
export function listRuns(filter: ListRunsFilter = {}): AgentRunRecord[] {
  const where: string[] = [];
  const params: unknown[] = [];

  if (filter.workspaceId !== undefined) {
    if (filter.workspaceId === null) {
      where.push('workspace_id IS NULL');
    } else {
      where.push('workspace_id = ?');
      params.push(filter.workspaceId);
    }
  }
  if (filter.agentId) {
    where.push('agent_id = ?');
    params.push(filter.agentId);
  }
  if (filter.status) {
    const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
    if (statuses.length > 0) {
      where.push(`status IN (${statuses.map(() => '?').join(', ')})`);
      params.push(...statuses);
    }
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const limit = filter.limit ?? 200;
  const offset = filter.offset ?? 0;
  params.push(limit, offset);

  const rows = getDb()
    .prepare(
      `SELECT * FROM runs ${whereSql}
       ORDER BY started_at DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...params) as RunRow[];

  // Empty steps array — callers are expected to call getRun(id) for the trace.
  return rows.map((r) => rowToRun(r, []));
}

/** Hard delete a run + cascade its steps (FK ON DELETE CASCADE). */
export function deleteRun(id: string): boolean {
  const result = getDb().prepare('DELETE FROM runs WHERE id = ?').run(id);
  return result.changes > 0;
}

/** Retention sweep — delete runs whose `started_at` is older than the cutoff. */
export function deleteRunsBefore(cutoffIso: string): number {
  const result = getDb()
    .prepare('DELETE FROM runs WHERE started_at < ?')
    .run(cutoffIso);
  return result.changes;
}

/**
 * In-flight runs — for boot-time reconciliation. Anything still flagged
 * `running` or `queued` after a clean restart is a crash artifact and
 * should be marked `failed` (the runtime can't recover from a process
 * exit mid-run). Caller is responsible for the status flip.
 */
export function listOrphanedRuns(): Array<{ id: string; agentName: string; startedAt: string }> {
  const rows = getDb()
    .prepare(
      `SELECT id, agent_name AS agentName, started_at AS startedAt
         FROM runs
        WHERE status IN ('running', 'queued')
        ORDER BY started_at DESC`,
    )
    .all() as Array<{ id: string; agentName: string; startedAt: string }>;
  return rows;
}
