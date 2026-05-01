/**
 * Renderer-side Conductor store.
 *
 * Owns the chat thread state for the home composer: turns (user / assistant),
 * inline tool-call rows, phase chips, dispatched run links, pending
 * approval and ask_user prompt-cards. Subscribes to the conductor:event
 * IPC stream and translates events into UI mutations.
 *
 * Singleton + useSyncExternalStore — same pattern as run-store.ts.
 */

import { useSyncExternalStore } from 'react';

export interface PendingApproval {
  id: string;
  toolName: string;
  input: Record<string, unknown>;
}

export interface PendingUserInput {
  id: string;
  question: string;
  placeholder?: string;
  secret?: boolean;
}

export type ChatItem =
  | { kind: 'user'; turnId: string; text: string; ts: string }
  | { kind: 'assistant-text'; turnId: string; text: string; ts: string }
  | {
      kind: 'tool-call';
      turnId: string;
      toolUseId: string;
      toolName: string;
      input: unknown;
      result?: unknown;
      isError?: boolean;
      ts: string;
    }
  | { kind: 'phase'; phase: 'start' | 'stop'; subagent?: string; ts: string }
  | { kind: 'dispatch'; turnId: string; runId: string; ts: string }
  | {
      kind: 'turn-summary';
      turnId: string;
      tokensIn: number;
      tokensOut: number;
      costUsd: number;
      ts: string;
    }
  | { kind: 'turn-error'; turnId: string; error: string; ts: string }
  | {
      kind: 'approval-feedback';
      toolName: string;
      approved: boolean;
      ts: string;
    };

export interface ToastEntry {
  id: string;
  kind: 'info' | 'warn' | 'error';
  text: string;
  ts: string;
}

export interface ConductorState {
  status: 'idle' | 'starting' | 'ready' | 'thinking';
  sessionId: string | null;
  items: ChatItem[];
  pendingApproval: PendingApproval | null;
  pendingUserInput: PendingUserInput | null;
  toasts: ToastEntry[];
}

type Listener = () => void;

class ConductorStore {
  private state: ConductorState = {
    status: 'idle',
    sessionId: null,
    items: [],
    pendingApproval: null,
    pendingUserInput: null,
    toasts: [],
  };
  private cached: ConductorState = this.state;
  private listeners = new Set<Listener>();
  private bound = false;

  subscribe = (cb: Listener): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };
  getSnapshot = (): ConductorState => this.cached;

  /** Bind once — wires the IPC subscriptions. */
  bind(): void {
    if (this.bound) return;
    this.bound = true;
    window.flowstate.onConductorEvent((evRaw) => this.applyEvent(evRaw));
    window.flowstate.onConductorApprovalRequest((req) => {
      this.set({ pendingApproval: req });
    });
    window.flowstate.onConductorUserInputRequest((req) => {
      this.set({ pendingUserInput: req });
    });
  }

  async start(): Promise<void> {
    if (this.state.status !== 'idle') return;
    this.set({ status: 'starting' });
    this.bind();
    try {
      await window.flowstate.conductorStart();
      this.set({ status: 'ready' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.appendItem({
        kind: 'turn-error',
        turnId: 'init',
        error: msg,
        ts: nowISO(),
      });
      this.set({ status: 'idle' });
    }
  }

  async send(text: string): Promise<void> {
    if (!text.trim()) return;
    if (this.state.status === 'idle') await this.start();
    const turnId = `local_${Math.random().toString(36).slice(2, 8)}`;
    this.appendItem({ kind: 'user', turnId, text, ts: nowISO() });
    this.set({ status: 'thinking' });
    try {
      await window.flowstate.conductorSend(text);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.appendItem({ kind: 'turn-error', turnId, error: msg, ts: nowISO() });
      this.set({ status: 'ready' });
    }
  }

  async respondApproval(approved: boolean, reason?: string): Promise<void> {
    const p = this.state.pendingApproval;
    if (!p) return;
    // Append a feedback bubble so the chat shows what just happened.
    this.appendItem({
      kind: 'approval-feedback',
      toolName: p.toolName,
      approved,
      ts: nowISO(),
    });
    this.set({ pendingApproval: null });
    await window.flowstate.conductorRespondApproval({ id: p.id, approved, reason });
  }

  async respondUserInput(answer: string | null): Promise<void> {
    const p = this.state.pendingUserInput;
    if (!p) return;
    this.set({ pendingUserInput: null });
    if (answer == null) {
      await window.flowstate.conductorRespondUserInput({ id: p.id, cancelled: true });
    } else {
      await window.flowstate.conductorRespondUserInput({ id: p.id, answer });
    }
  }

  async interrupt(): Promise<void> {
    await window.flowstate.conductorInterrupt();
    this.set({ status: 'ready' });
  }

  // ─── Internals ──────────────────────────────────────────────────────

  private applyEvent(evRaw: unknown): void {
    const ev = evRaw as { type?: string; [k: string]: unknown };
    const ts = nowISO();
    switch (ev.type) {
      case 'session-ready':
        this.set({ sessionId: (ev['sessionId'] as string) ?? null });
        return;
      case 'assistant-text':
        this.appendItem({
          kind: 'assistant-text',
          turnId: ev['turnId'] as string,
          text: ev['text'] as string,
          ts,
        });
        return;
      case 'tool-call':
        this.appendItem({
          kind: 'tool-call',
          turnId: ev['turnId'] as string,
          toolUseId: ev['toolUseId'] as string,
          toolName: ev['toolName'] as string,
          input: ev['input'],
          ts,
        });
        return;
      case 'tool-result':
        this.updateToolResult(
          ev['toolUseId'] as string,
          ev['output'],
          ev['isError'] === true,
        );
        return;
      case 'subagent-phase':
        this.appendItem({
          kind: 'phase',
          phase: ev['phase'] as 'start' | 'stop',
          subagent: ev['subagent'] as string | undefined,
          ts,
        });
        return;
      case 'dispatch-run':
        this.appendItem({
          kind: 'dispatch',
          turnId: ev['turnId'] as string,
          runId: ev['runId'] as string,
          ts,
        });
        return;
      case 'turn-complete':
        this.appendItem({
          kind: 'turn-summary',
          turnId: ev['turnId'] as string,
          tokensIn: ev['tokensIn'] as number,
          tokensOut: ev['tokensOut'] as number,
          costUsd: ev['costUsd'] as number,
          ts,
        });
        this.set({ status: 'ready' });
        return;
      case 'turn-error':
        this.appendItem({
          kind: 'turn-error',
          turnId: ev['turnId'] as string,
          error: ev['error'] as string,
          ts,
        });
        this.set({ status: 'ready' });
        return;
      case 'toast':
        this.pushToast({
          id: `toast_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          kind: (ev['kind'] as 'info' | 'warn' | 'error') ?? 'info',
          text: ev['text'] as string,
          ts,
        });
        return;
    }
  }

  /** Add a toast and auto-expire after 6s. */
  private pushToast(toast: ToastEntry): void {
    this.state = { ...this.state, toasts: [...this.state.toasts, toast] };
    this.refresh();
    setTimeout(() => this.dismissToast(toast.id), 6000);
  }

  dismissToast(id: string): void {
    if (!this.state.toasts.some((t) => t.id === id)) return;
    this.state = { ...this.state, toasts: this.state.toasts.filter((t) => t.id !== id) };
    this.refresh();
  }

  private appendItem(item: ChatItem): void {
    this.state = { ...this.state, items: [...this.state.items, item] };
    this.refresh();
  }

  private updateToolResult(toolUseId: string, output: unknown, isError: boolean): void {
    let touched = false;
    const items = this.state.items.map((it) => {
      if (it.kind === 'tool-call' && it.toolUseId === toolUseId) {
        touched = true;
        return { ...it, result: output, isError };
      }
      return it;
    });
    if (touched) {
      this.state = { ...this.state, items };
      this.refresh();
    }
  }

  private set(patch: Partial<ConductorState>): void {
    this.state = { ...this.state, ...patch };
    this.refresh();
  }

  private refresh(): void {
    this.cached = this.state;
    for (const cb of this.listeners) cb();
  }
}

export const conductorStore = new ConductorStore();

export function useConductor(): ConductorState {
  return useSyncExternalStore(conductorStore.subscribe, conductorStore.getSnapshot);
}

function nowISO(): string {
  return new Date().toISOString();
}
