import { useSyncExternalStore } from 'react';
import type { Workspace, WorkspaceInput } from '@flowstate/core';

/**
 * Renderer-side workspace store.
 *
 * Source of truth lives in SQLite in the main process (flowstate.db). This
 * store is a cache of `list + active` that re-reads after every mutation —
 * round-tripping through IPC keeps us honest about which writer wins when
 * a future second window touches the same DB.
 *
 * Usage:
 *   await hydrateWorkspaces();          // once on boot
 *   const { list, active } = useWorkspaces();
 *   await createWorkspace({ name }) ;   // mutations refresh automatically
 */

type Listener = () => void;

interface WorkspaceSnapshot {
  list: Workspace[];
  active: Workspace | null;
  hydrated: boolean;
}

class WorkspaceStore {
  private snapshot: WorkspaceSnapshot = { list: [], active: null, hydrated: false };
  private listeners = new Set<Listener>();

  subscribe = (cb: Listener): (() => void) => {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  };

  getSnapshot = (): WorkspaceSnapshot => this.snapshot;

  async hydrate(): Promise<void> {
    if (this.snapshot.hydrated) return;
    await this.refresh();
  }

  /**
   * Re-read list + active from main. Called after every mutation so the UI
   * tracks SQLite, not an optimistic local copy.
   */
  async refresh(): Promise<void> {
    try {
      const [list, active] = await Promise.all([
        window.flowstate.workspaceList(),
        window.flowstate.workspaceActive(),
      ]);
      this.snapshot = { list, active, hydrated: true };
      this.emit();
    } catch (err) {
      console.warn('[workspace-store] refresh failed', err);
      // Mark hydrated anyway so the UI can render an empty state instead
      // of blocking forever on a permanently broken IPC.
      this.snapshot = { ...this.snapshot, hydrated: true };
      this.emit();
    }
  }

  private emit(): void {
    for (const cb of this.listeners) cb();
  }
}

export const workspaceStore = new WorkspaceStore();

export async function hydrateWorkspaces(): Promise<void> {
  return workspaceStore.hydrate();
}

export function useWorkspaces(): WorkspaceSnapshot {
  return useSyncExternalStore(workspaceStore.subscribe, workspaceStore.getSnapshot);
}

export async function createWorkspace(input: WorkspaceInput): Promise<Workspace> {
  const ws = await window.flowstate.workspaceCreate(input);
  await workspaceStore.refresh();
  return ws;
}

export async function switchWorkspace(id: string): Promise<void> {
  await window.flowstate.workspaceSwitch(id);
  await workspaceStore.refresh();
}

export async function renameWorkspace(id: string, name: string): Promise<void> {
  await window.flowstate.workspaceUpdate(id, { name });
  await workspaceStore.refresh();
}

export async function updateWorkspace(
  id: string,
  patch: Partial<WorkspaceInput>,
): Promise<void> {
  await window.flowstate.workspaceUpdate(id, patch);
  await workspaceStore.refresh();
}

export async function deleteWorkspace(id: string): Promise<void> {
  await window.flowstate.workspaceDelete(id);
  await workspaceStore.refresh();
}
