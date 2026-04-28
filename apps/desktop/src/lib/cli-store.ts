import { useSyncExternalStore } from 'react';
import {
  STARTER_CLI_FAMILIES,
  sortFamilies,
  type CliToolFamily,
} from '@flowstate/core';

/**
 * Renderer-side store for the CLI tool marketplace.
 *
 * State:
 *   families        the curated catalogue (sorted: featured > verified > A→Z)
 *   probes          per-family install probe result (installed?, version)
 *   authStatus      per-family auth probe result (authenticated?)
 *   secretNames     env-var names with values stored in the keychain
 *   query           search box value
 *   loading         true while initial probe-all is in flight
 *   error           last error, if any
 *
 * The store doesn't pull "all" CLIs from a remote registry the way the
 * MCP store does — there isn't one. We ship the catalogue with the app
 * and probe each entry's `versionProbe` against the local PATH on hydrate.
 */

type Listener = () => void;

export interface CliProbeResult {
  installed: boolean;
  version?: string;
}

export interface CliAuthResult {
  authenticated: boolean;
  output?: string;
}

export interface CliState {
  families: CliToolFamily[];
  probes: Record<string, CliProbeResult>;
  authStatus: Record<string, CliAuthResult>;
  secretNames: Set<string>;
  query: string;
  loading: boolean;
  error: string | null;
}

class CliStore {
  private snapshot: CliState = {
    families: sortFamilies(STARTER_CLI_FAMILIES),
    probes: {},
    authStatus: {},
    secretNames: new Set(),
    query: '',
    loading: false,
    error: null,
  };
  private listeners = new Set<Listener>();

  subscribe = (cb: Listener): (() => void) => {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  };

  getSnapshot = (): CliState => this.snapshot;

  private commit(patch: Partial<CliState>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const cb of this.listeners) cb();
  }

  private requireApi(): typeof window.flowstate {
    const api = window.flowstate;
    if (!api || typeof api.cliProbeAll !== 'function') {
      throw new Error(
        'CLI probe IPC not available — restart the app to load the latest preload bundle.',
      );
    }
    return api;
  }

  /** Probe every family for installed-ness, plus pull keychain names. */
  async hydrate(): Promise<void> {
    let api: typeof window.flowstate;
    try {
      api = this.requireApi();
    } catch (err) {
      this.commit({ error: err instanceof Error ? err.message : String(err) });
      return;
    }
    this.commit({ loading: true, error: null });
    try {
      const [probes, secrets] = await Promise.all([
        api.cliProbeAll(),
        api.secretsList(),
      ]);
      this.commit({
        probes,
        secretNames: new Set(secrets),
        loading: false,
      });
      // Auth probes are slower and only meaningful when installed. Run
      // them in the background so the grid paints with install status
      // first, then upgrades to auth status as results stream in.
      void this.refreshAuthStatuses();
    } catch (err) {
      this.commit({
        loading: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** Run auth probes for every installed family, in parallel. */
  async refreshAuthStatuses(): Promise<void> {
    const api = this.requireApi();
    const installed = this.snapshot.families.filter(
      (f) => this.snapshot.probes[f.id]?.installed,
    );
    const results = await Promise.all(
      installed.map(async (f) => {
        const r = await api.cliAuthProbe(f.id);
        return [f.id, r] as const;
      }),
    );
    const authStatus = { ...this.snapshot.authStatus };
    for (const [id, r] of results) {
      if (r) authStatus[id] = r;
    }
    this.commit({ authStatus });
  }

  /** Re-run a single family's probe — used after Install / Run-auth. */
  async refreshFamily(id: string): Promise<void> {
    const api = this.requireApi();
    const probe = await api.cliProbe(id);
    const probes = { ...this.snapshot.probes, [id]: probe };
    let authStatus = this.snapshot.authStatus;
    if (probe.installed) {
      const r = await api.cliAuthProbe(id);
      if (r) authStatus = { ...authStatus, [id]: r };
    }
    this.commit({ probes, authStatus });
  }

  setQuery(query: string): void {
    this.commit({ query });
  }

  /** Spawn the family's auth command in a new terminal. */
  async runAuth(id: string): Promise<boolean> {
    const ok = await this.requireApi().cliRunAuth(id);
    return ok;
  }

  /** Open the install instructions URL in the default browser. */
  async openInstallPage(url: string): Promise<void> {
    await this.requireApi().openExternal(url);
  }

  async setSecret(name: string, value: string): Promise<void> {
    await this.requireApi().secretsSet(name, value);
    const next = new Set(this.snapshot.secretNames);
    next.add(name);
    this.commit({ secretNames: next });
  }

  async deleteSecret(name: string): Promise<void> {
    await this.requireApi().secretsDelete(name);
    const next = new Set(this.snapshot.secretNames);
    next.delete(name);
    this.commit({ secretNames: next });
  }
}

export const cliStore = new CliStore();

export function useCliStore(): CliState {
  return useSyncExternalStore(cliStore.subscribe, cliStore.getSnapshot);
}

/** Free-text search across name, description, capabilities, tags, family id. */
export function filterFamilies(families: CliToolFamily[], query: string): CliToolFamily[] {
  const q = query.trim().toLowerCase();
  if (!q) return families;
  return families.filter((f) => {
    if (f.id.toLowerCase().includes(q)) return true;
    if (f.name.toLowerCase().includes(q)) return true;
    if (f.description.toLowerCase().includes(q)) return true;
    if (f.tags?.some((t) => t.toLowerCase().includes(q))) return true;
    if (f.capabilities.some((c) => c.toLowerCase().includes(q))) return true;
    return false;
  });
}
