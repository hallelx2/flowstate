import { useSyncExternalStore } from 'react';
import {
  withDefaults,
  type ResolvedSettings,
  type Settings,
} from '@flowstate/core';

/**
 * Renderer-side settings store.
 *
 * Lifecycle:
 *   1. App.tsx calls `hydrateSettings()` on boot (before the first paint
 *      that reads settings — typically in the splash screen).
 *   2. The store holds a `Required<Settings>` (every field populated from
 *      either disk or DEFAULT_SETTINGS).
 *   3. UI reads via `useSettings()` (re-renders on change).
 *   4. UI writes via `updateSettings({ section: { key: value } })` — the
 *      patch is applied locally synchronously, then debounced through IPC
 *      to the main process for atomic disk write.
 *
 * Debouncing keeps slider / text-input drag traffic from flooding the disk;
 * 350ms is below human perception of "saved" but above typical typing burst.
 */

type Listener = () => void;

const WRITE_DEBOUNCE_MS = 350;

class SettingsStore {
  private snapshot: ResolvedSettings = withDefaults({});
  private hydrated = false;
  private listeners = new Set<Listener>();
  private writeTimer: ReturnType<typeof setTimeout> | null = null;
  /** Patches enqueued while a debounced write is pending. Merged before flush. */
  private pendingPatch: Partial<Settings> = {};

  subscribe = (cb: Listener): (() => void) => {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  };

  getSnapshot = (): ResolvedSettings => this.snapshot;

  isHydrated(): boolean {
    return this.hydrated;
  }

  /**
   * Read settings.json from main and seed the store. Idempotent — calling
   * twice is a no-op once hydrated.
   */
  async hydrate(): Promise<void> {
    if (this.hydrated) return;
    try {
      const raw = await window.flowstate.readSettings();
      this.snapshot = withDefaults(raw);
    } catch (err) {
      console.warn('[settings-store] hydrate failed; using defaults', err);
      this.snapshot = withDefaults({});
    }
    this.hydrated = true;
    this.emit();
  }

  /**
   * Apply a deep-partial patch and schedule a debounced disk write.
   * Returns immediately so callers (form onChange handlers) stay responsive.
   */
  update(patch: Partial<Settings>): void {
    this.snapshot = mergeRequired(this.snapshot, patch);
    this.pendingPatch = mergePartial(this.pendingPatch, patch);
    this.emit();

    if (this.writeTimer) clearTimeout(this.writeTimer);
    this.writeTimer = setTimeout(() => {
      void this.flush();
    }, WRITE_DEBOUNCE_MS);
  }

  /** Force any pending writes to disk. Useful before app quit. */
  async flush(): Promise<void> {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
      this.writeTimer = null;
    }
    if (Object.keys(this.pendingPatch).length === 0) return;
    const patch = this.pendingPatch;
    this.pendingPatch = {};
    try {
      const merged = await window.flowstate.writeSettings(patch);
      // Re-seed from the validated value the main process returned, so the
      // store always tracks what's actually on disk.
      this.snapshot = withDefaults(merged);
      this.emit();
    } catch (err) {
      console.warn('[settings-store] write failed; re-queueing patch', err);
      // Don't lose the user's edit — fold it back into the next attempt.
      this.pendingPatch = mergePartial(patch, this.pendingPatch);
    }
  }

  private emit(): void {
    for (const cb of this.listeners) cb();
  }
}

export const settingsStore = new SettingsStore();

export async function hydrateSettings(): Promise<void> {
  return settingsStore.hydrate();
}

export function useSettings(): ResolvedSettings {
  return useSyncExternalStore(
    settingsStore.subscribe,
    settingsStore.getSnapshot,
  );
}

export function updateSettings(patch: Partial<Settings>): void {
  settingsStore.update(patch);
}

// ─── Internal merge helpers ───────────────────────────────────────────────
// Both keep the shape of their first argument (don't introduce undefined
// fields when the patch omits a section).

function mergeRequired(current: ResolvedSettings, patch: Partial<Settings>): ResolvedSettings {
  return {
    schemaVersion: patch.schemaVersion ?? current.schemaVersion,
    account: { ...current.account, ...(patch.account ?? {}) },
    workspace: { ...current.workspace, ...(patch.workspace ?? {}) },
    tools: { ...current.tools, ...(patch.tools ?? {}) },
    privacy: { ...current.privacy, ...(patch.privacy ?? {}) },
    appearance: { ...current.appearance, ...(patch.appearance ?? {}) },
  };
}

function mergePartial(
  base: Partial<Settings>,
  next: Partial<Settings>,
): Partial<Settings> {
  const out: Partial<Settings> = { ...base };
  if (next.schemaVersion != null) out.schemaVersion = next.schemaVersion;
  if (next.account) out.account = { ...(base.account ?? {}), ...next.account };
  if (next.workspace) out.workspace = { ...(base.workspace ?? {}), ...next.workspace };
  if (next.tools) out.tools = { ...(base.tools ?? {}), ...next.tools };
  if (next.privacy) out.privacy = { ...(base.privacy ?? {}), ...next.privacy };
  if (next.appearance) out.appearance = { ...(base.appearance ?? {}), ...next.appearance };
  return out;
}
