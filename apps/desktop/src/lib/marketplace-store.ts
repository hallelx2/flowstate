import { useSyncExternalStore } from 'react';
import {
  sortByName,
  sortByQuality,
  sortByUpdated,
  type MarketplaceSourceId,
  type McpServerDef,
} from '@flowstate/core';

export type SortMode = 'top' | 'name' | 'updated';

/**
 * Renderer-side marketplace store.
 *
 * Pulls the ENTIRE registry catalogue once (via the cached fetch-all IPC
 * in main), holds it sorted A→Z, then derives the visible page locally.
 * That gives instant client-side search + letter-jump + pagination across
 * the whole 3k+ entries — no per-keystroke network round-trips.
 *
 * State:
 *   - allServers      every server the registry knows about, sorted A→Z, deduped
 *   - query           current search box value
 *   - letter          'A'..'Z' filter, or '#' for non-letter, or null
 *   - page            zero-indexed page within the current filtered set
 *   - pageSize        rows per page (30 by default)
 *   - source          which registry the catalogue came from
 *   - loading         true while the cold fetch runs
 *   - progress        live "loaded N across P pages" while loading
 *   - fetchedAt       ISO timestamp of the catalogue snapshot in memory
 *   - fromCache       true if the in-memory snapshot came from disk cache
 *   - installedIds    server ids the user already has on disk
 *   - secretNames     env-var names with values in the keychain
 *   - error           last error if any
 */

type Listener = () => void;

export const PAGE_SIZE = 30;

export interface MarketplaceState {
  allServers: McpServerDef[];
  query: string;
  letter: string | null;
  page: number;
  pageSize: number;
  /**
   * How the visible list is ordered.
   *   'top'      Featured first, then verified, then by quality score (default).
   *   'name'     Plain A→Z by display name.
   *   'updated'  Most-recently published first.
   */
  sort: SortMode;
  source: MarketplaceSourceId;
  loading: boolean;
  progress: { loaded: number; page: number } | null;
  fetchedAt: string | null;
  fromCache: boolean;
  installedIds: Set<string>;
  secretNames: Set<string>;
  error: string | null;
}

class MarketplaceStore {
  private snapshot: MarketplaceState = {
    allServers: [],
    query: '',
    letter: null,
    page: 0,
    pageSize: PAGE_SIZE,
    sort: 'top',
    source: 'official',
    loading: false,
    progress: null,
    fetchedAt: null,
    fromCache: false,
    installedIds: new Set(),
    secretNames: new Set(),
    error: null,
  };
  private listeners = new Set<Listener>();
  private unsubProgress: (() => void) | null = null;

  subscribe = (cb: Listener): (() => void) => {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  };

  getSnapshot = (): MarketplaceState => this.snapshot;

  private commit(patch: Partial<MarketplaceState>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const cb of this.listeners) cb();
  }

  /**
   * The preload bridge is a separate bundle from the renderer. During dev,
   * the renderer hot-reloads but the preload does NOT — restarting the
   * Electron window picks up new methods. Surface a friendly message
   * instead of a cryptic undefined-read crash.
   */
  private requireApi(): typeof window.flowstate {
    const api = window.flowstate;
    if (!api || typeof api.marketplaceFetchAll !== 'function') {
      throw new Error(
        'Marketplace IPC not available — restart the app to load the latest preload bundle.',
      );
    }
    return api;
  }

  /**
   * Pull the on-disk install list + keychain names + the full catalogue.
   * Catalogue comes from the disk cache when fresh (instant), otherwise
   * from the live registry while progress events stream in.
   */
  async hydrate(): Promise<void> {
    let api: typeof window.flowstate;
    try {
      api = this.requireApi();
    } catch (err) {
      this.commit({ error: err instanceof Error ? err.message : String(err) });
      return;
    }

    // Subscribe to fetch-all progress before kicking off the call so we
    // don't miss the first event.
    if (!this.unsubProgress) {
      this.unsubProgress = api.onMarketplaceProgress((info) => {
        if (info.source !== this.snapshot.source) return;
        this.commit({ progress: { loaded: info.loaded, page: info.page } });
      });
    }

    this.commit({ loading: true, error: null, progress: null });

    try {
      const [installed, secrets, all] = await Promise.all([
        api.marketplaceListInstalled(),
        api.secretsList(),
        api.marketplaceFetchAll({ source: this.snapshot.source }),
      ]);
      this.commit({
        installedIds: new Set(installed.map((d) => d.id)),
        secretNames: new Set(secrets),
        allServers: all.servers,
        fetchedAt: all.fetchedAt,
        fromCache: all.fromCache,
        loading: false,
        progress: null,
      });
    } catch (err) {
      this.commit({
        loading: false,
        progress: null,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** Force-refresh the catalogue from the live registry, bypassing the cache. */
  async refresh(): Promise<void> {
    let api: typeof window.flowstate;
    try {
      api = this.requireApi();
    } catch (err) {
      this.commit({ error: err instanceof Error ? err.message : String(err) });
      return;
    }
    this.commit({ loading: true, error: null, progress: null });
    try {
      const all = await api.marketplaceFetchAll({
        source: this.snapshot.source,
        force: true,
      });
      this.commit({
        allServers: all.servers,
        fetchedAt: all.fetchedAt,
        fromCache: all.fromCache,
        loading: false,
        progress: null,
        page: 0,
      });
    } catch (err) {
      this.commit({
        loading: false,
        progress: null,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** Switch registries. Reloads the catalogue from disk/live. */
  async setSource(source: MarketplaceSourceId): Promise<void> {
    if (source === this.snapshot.source) return;
    this.commit({
      source,
      allServers: [],
      page: 0,
      letter: null,
      query: '',
    });
    await this.hydrate();
  }

  /** Update the search box; resets pagination + letter so results are visible. */
  setQuery(query: string): void {
    this.commit({ query, page: 0, letter: null });
  }

  /** Filter to entries starting with the given letter. Pass null to clear. */
  setLetter(letter: string | null): void {
    this.commit({ letter, page: 0, query: '' });
  }

  setSort(sort: SortMode): void {
    this.commit({ sort, page: 0 });
  }

  setPage(page: number): void {
    this.commit({ page: Math.max(0, page) });
  }

  nextPage(): void {
    this.commit({ page: this.snapshot.page + 1 });
  }

  prevPage(): void {
    this.commit({ page: Math.max(0, this.snapshot.page - 1) });
  }

  async install(def: McpServerDef): Promise<void> {
    await this.requireApi().marketplaceInstall(def);
    const next = new Set(this.snapshot.installedIds);
    next.add(def.id);
    this.commit({ installedIds: next });
  }

  async uninstall(id: string): Promise<void> {
    await this.requireApi().marketplaceUninstall(id);
    const next = new Set(this.snapshot.installedIds);
    next.delete(id);
    this.commit({ installedIds: next });
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

export const marketplaceStore = new MarketplaceStore();

export function useMarketplace(): MarketplaceState {
  return useSyncExternalStore(marketplaceStore.subscribe, marketplaceStore.getSnapshot);
}

/**
 * Apply the current sort mode to a server list. Pure helper so the
 * renderer can re-sort cheaply when the user toggles the dropdown.
 */
export function applySort(servers: McpServerDef[], sort: SortMode): McpServerDef[] {
  if (sort === 'name') return sortByName(servers);
  if (sort === 'updated') return sortByUpdated(servers);
  return sortByQuality(servers);
}

/**
 * Apply the current filter (search OR letter) to the full catalogue.
 * Returns the filtered subset — caller paginates from there.
 */
export function applyFilter(
  servers: McpServerDef[],
  query: string,
  letter: string | null,
): McpServerDef[] {
  const q = query.trim().toLowerCase();
  if (q) {
    return servers.filter((d) => matchesQuery(d, q));
  }
  if (letter) {
    if (letter === '#') {
      return servers.filter((d) => !/^[a-z]/i.test(firstChar(d.name)));
    }
    return servers.filter(
      (d) => firstChar(d.name).toUpperCase() === letter.toUpperCase(),
    );
  }
  return servers;
}

/** Set of letters present in the catalogue, for the A→Z chip row. */
export function lettersPresent(servers: McpServerDef[]): Set<string> {
  const set = new Set<string>();
  for (const d of servers) {
    const c = firstChar(d.name).toUpperCase();
    set.add(/^[A-Z]/.test(c) ? c : '#');
  }
  return set;
}

function firstChar(name: string): string {
  // Trim leading non-letter characters (`@scope/name` becomes 'n' for "name")
  const cleaned = name.trim().replace(/^[^a-z0-9]+/i, '');
  return cleaned[0] ?? '';
}

function matchesQuery(def: McpServerDef, q: string): boolean {
  if (def.id.toLowerCase().includes(q)) return true;
  if (def.name.toLowerCase().includes(q)) return true;
  if (def.description.toLowerCase().includes(q)) return true;
  if (def.tags?.some((t) => t.toLowerCase().includes(q))) return true;
  if (def.capabilities.some((c) => c.toLowerCase().includes(q))) return true;
  return false;
}

/**
 * True iff every required env var for `def` has a value in the keychain.
 * Used by marketplace cards to render "ready / needs setup" dots.
 */
export function isReady(def: McpServerDef, secretNames: Set<string>): boolean {
  if (!def.envVars || def.envVars.length === 0) return true;
  return def.envVars.every((v) => secretNames.has(v));
}
