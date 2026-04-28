/**
 * MCP marketplace — fetch + normalize MCP server catalogs from public
 * registries, then write installs to the user's local tool directory.
 *
 * This module is pure: no `fetch`, no `fs`. The caller injects a
 * `RegistryFetcher` (typically `globalThis.fetch` in the renderer or
 * the Node fetch in main) and a `LocalStore` (the IPC handler that
 * actually writes `~/.flowstate/tools/mcp/<id>.yaml`). Keeps core
 * runtime-agnostic so the same logic ships in browser, Node, and tests.
 *
 * Two sources supported in v1:
 *
 *   official   https://registry.modelcontextprotocol.io/v0.1/servers
 *              The vendor-neutral, freezeed-API source of truth.
 *
 *   glama      https://glama.ai/api/mcp/v1/servers
 *              Larger catalogue (~22k), community-curated, useful as
 *              a fallback when the official registry is missing an entry.
 *
 * Both shapes are normalized into `McpServerDef` (the shape the rest of
 * flowstate already speaks). Callers don't need to know which source an
 * entry came from once it's normalized.
 */

import type { EnvVarSpec, McpServerDef, McpTransport } from './mcp-servers';

// ─── Verified publishers + featured list ─────────────────────────────────

/**
 * Publisher namespaces flowstate trusts on sight. A server whose `name`
 * falls under one of these gets `verified: true` + a quality bonus.
 * Curated centrally; community-submitted servers don't make it in here
 * automatically — they have to earn quality through metadata signals
 * (description, repo, env-var documentation, active status, etc).
 *
 * Match is suffix-on-namespace: `name = "io.github.modelcontextprotocol/x"`
 * matches `io.github.modelcontextprotocol`. Sub-orgs match too —
 * `io.github.modelcontextprotocol.servers/x` matches the parent.
 */
export const VERIFIED_PUBLISHERS = new Set([
  'io.github.modelcontextprotocol',
  'io.github.anthropics',
  'io.github.anthropic',
  'io.github.openai',
  'io.github.googleapis',
  'io.github.cloudflare',
  'io.github.stripe',
  'io.github.github',
  'io.github.notion',
  'io.github.linear',
  'io.github.slackhq',
  'io.github.atlassian',
  'io.github.vercel',
  'io.github.aws',
  'io.github.awslabs',
  'io.github.gitlab',
  'io.github.hubspot',
  'io.github.docker',
  'io.github.mongodb-js',
  'io.github.mongodb',
  'io.github.redis',
  'io.github.elastic',
  'io.github.shopify',
  'io.github.zapier',
]);

/**
 * Hand-picked featured servers — surfaced at the top of the marketplace
 * regardless of source. Implies verified. Match is on the dotted FULL
 * NAME of the registry entry (`<namespace>/<identifier>`).
 */
export const FEATURED_SERVERS = new Set([
  'io.github.modelcontextprotocol/filesystem',
  'io.github.modelcontextprotocol/github',
  'io.github.modelcontextprotocol/git',
  'io.github.modelcontextprotocol/postgres',
  'io.github.modelcontextprotocol/sqlite',
  'io.github.modelcontextprotocol/memory',
  'io.github.modelcontextprotocol/fetch',
  'io.github.modelcontextprotocol/puppeteer',
  'io.github.modelcontextprotocol/brave-search',
  'io.github.modelcontextprotocol/slack',
]);

// ─── Icon derivation ──────────────────────────────────────────────────────

/**
 * Synthesise a brand icon URL for a server. Strategy, in order:
 *
 *   1. GitHub repo URL → `https://github.com/<user>.png` returns the
 *      user/org avatar. Works without auth, has good cache headers,
 *      and gives a real branded icon for the ~70% of servers hosted
 *      on GitHub.
 *
 *   2. Other homepage URL → Google's favicon proxy at
 *      `https://www.google.com/s2/favicons?domain=<host>&sz=128`.
 *      Reliable across most public domains, no auth, ~16ms typical.
 *
 *   3. No usable hint → undefined; the renderer falls back to a
 *      monogram bubble derived from the display name.
 *
 * Pure: takes a repository / homepage URL and returns either a string
 * or undefined. Both inputs optional.
 */
export function iconUrlFromHints(
  repository?: string,
  homepage?: string,
): string | undefined {
  // GitHub repos — extract the owner segment from the URL.
  const ghOwner = githubOwnerFromUrl(repository) ?? githubOwnerFromUrl(homepage);
  if (ghOwner) return `https://github.com/${ghOwner}.png?size=128`;

  // Any other URL — favicon by hostname.
  const host = hostnameFromUrl(homepage) ?? hostnameFromUrl(repository);
  if (host) return `https://www.google.com/s2/favicons?domain=${host}&sz=128`;

  return undefined;
}

function githubOwnerFromUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  // Accept "github:user/repo" shorthand and full https URLs alike.
  const short = /^github:([^/\s]+)\//.exec(url);
  if (short) return short[1];
  const full = /^https?:\/\/(?:www\.)?github\.com\/([^/\s]+)/i.exec(url);
  if (full) return full[1];
  return undefined;
}

function hostnameFromUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

/**
 * Extract the publisher namespace from a registry full name.
 *
 *   "io.github.modelcontextprotocol/filesystem"  →  "io.github.modelcontextprotocol"
 *   "ac.inference.sh/mcp"                         →  "ac.inference.sh"
 *
 * Used both for the verified check and to populate the publisher field
 * on each `McpServerDef`.
 */
export function publisherFromOfficialName(fullName: string): string {
  const slash = fullName.indexOf('/');
  return slash >= 0 ? fullName.slice(0, slash) : fullName;
}

/**
 * True iff the publisher namespace (or any parent of it) is in the
 * verified set. `io.github.modelcontextprotocol.servers` matches its
 * parent `io.github.modelcontextprotocol`.
 */
export function isVerifiedPublisher(publisher: string): boolean {
  if (VERIFIED_PUBLISHERS.has(publisher)) return true;
  // Walk up sub-org chains: a.b.c → a.b → a
  let cursor = publisher;
  while (cursor.includes('.')) {
    cursor = cursor.slice(0, cursor.lastIndexOf('.'));
    if (VERIFIED_PUBLISHERS.has(cursor)) return true;
  }
  return false;
}

// ─── Source descriptors ───────────────────────────────────────────────────

export type MarketplaceSourceId = 'official' | 'glama';

export interface MarketplaceSource {
  id: MarketplaceSourceId;
  name: string;
  description: string;
  baseUrl: string;
  /** API freeze tag — bumps trigger a re-fetch + cache invalidation. */
  apiVersion: string;
  homepage: string;
}

export const MARKETPLACE_SOURCES: Record<MarketplaceSourceId, MarketplaceSource> = {
  official: {
    id: 'official',
    name: 'Official MCP Registry',
    description:
      'Vendor-neutral source of truth maintained by the Model Context Protocol working group.',
    baseUrl: 'https://registry.modelcontextprotocol.io',
    // Production endpoint is /v0/servers — the docs reference /v0.1/ but
    // that path is staging-only, the live registry serves at /v0/.
    apiVersion: 'v0',
    homepage: 'https://registry.modelcontextprotocol.io',
  },
  glama: {
    id: 'glama',
    name: 'Glama',
    description:
      "Community-curated catalogue with the broadest coverage (~22k entries). Use when the official registry doesn't list a server you need.",
    baseUrl: 'https://glama.ai/api/mcp/v1',
    apiVersion: 'v1',
    homepage: 'https://glama.ai/mcp/servers',
  },
};

// ─── Fetcher interface ────────────────────────────────────────────────────

/**
 * Minimal HTTP shape — we only need GET + JSON. Callers wire this to
 * `globalThis.fetch`, Node's `fetch`, or a test stub. Returning `null`
 * on network failure lets the caller fall back to the local cache.
 */
export type RegistryFetcher = (url: string) => Promise<{ ok: boolean; json: () => Promise<unknown> } | null>;

export interface FetchOptions {
  /** Optional free-text search forwarded to the registry. */
  search?: string;
  /** ISO timestamp — fetch only servers updated after this. */
  updatedSince?: string;
  /** Cap results to keep the first call cheap. Defaults to 100. */
  limit?: number;
  /** Server cursor for pagination (official registry uses opaque cursors). */
  cursor?: string;
}

export interface FetchResult {
  source: MarketplaceSourceId;
  servers: McpServerDef[];
  /** Cursor for the next page. Undefined when the catalogue is exhausted. */
  nextCursor?: string;
  /** Wall-clock time of the fetch — caller stores alongside the cache. */
  fetchedAt: string;
  /** Soft errors — entries we couldn't normalize (UI shows a count). */
  warnings: string[];
}

// ─── Public API ───────────────────────────────────────────────────────────

/**
 * Fetch one page of servers from a marketplace source and normalize them
 * into `McpServerDef`. Returns `null` if the network call failed entirely
 * (so the caller can fall back to the local cache).
 *
 * Client-side filter: the official registry's `search` query parameter is
 * undocumented and empirically returns zero hits for many common terms
 * (`gmail`, `stripe`, etc). We always fetch a generous unfiltered page and
 * filter in-process across name/description/tags to guarantee the user
 * gets something back when they search a real keyword.
 */
export async function fetchMarketplace(
  sourceId: MarketplaceSourceId,
  fetcher: RegistryFetcher,
  opts: FetchOptions = {},
): Promise<FetchResult | null> {
  const source = MARKETPLACE_SOURCES[sourceId];
  // For the official registry, drop the `search` param from the URL — the
  // server-side filter is unreliable. Local-filter instead, against a wider
  // page so the user sees real results.
  // The official registry hard-caps `limit` at 100 (returns 422 above that).
  // We always fetch a generous page (~80) and filter client-side; the page
  // size doesn't go through user input, it's bounded by us.
  const OFFICIAL_PAGE_SIZE = 80;
  const fetchOpts: FetchOptions =
    sourceId === 'official'
      ? { ...opts, search: undefined, limit: OFFICIAL_PAGE_SIZE }
      : opts;
  const url = buildListUrl(source, fetchOpts);
  const res = await fetcher(url);
  if (!res || !res.ok) return null;

  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    return null;
  }

  const result =
    sourceId === 'official' ? normalizeOfficial(payload) : normalizeGlama(payload);

  // Apply the user's search term locally if the source needed it.
  if (opts.search?.trim()) {
    const q = opts.search.trim().toLowerCase();
    const hits = result.servers.filter((d) => matchesQuery(d, q));
    return { ...result, servers: hits.slice(0, opts.limit ?? 30) };
  }
  // Even without a search term, cap the visible page so the UI grid stays
  // healthy on first paint (the registry pages are larger than we render).
  return { ...result, servers: result.servers.slice(0, opts.limit ?? 30) };
}

/** Substring match across the fields a user is likely searching against. */
function matchesQuery(def: McpServerDef, q: string): boolean {
  if (def.id.toLowerCase().includes(q)) return true;
  if (def.name.toLowerCase().includes(q)) return true;
  if (def.description.toLowerCase().includes(q)) return true;
  if (def.tags?.some((t) => t.toLowerCase().includes(q))) return true;
  if (def.capabilities.some((c) => c.toLowerCase().includes(q))) return true;
  return false;
}

/**
 * Fetch every page from a source and concatenate. Bounded by `maxPages`
 * so a misbehaving server can't pull our whole memory budget.
 *
 * Internal note: this calls the lower-level page-fetch (NOT the
 * client-side-filtered `fetchMarketplace`), so the user-supplied
 * `search` term is irrelevant here — we always pull every entry the
 * registry knows about and let the caller filter once.
 */
export async function fetchMarketplaceAll(
  sourceId: MarketplaceSourceId,
  fetcher: RegistryFetcher,
  opts: FetchOptions = {},
  maxPages = 60,
  onProgress?: (loaded: number, page: number) => void,
): Promise<FetchResult | null> {
  const source = MARKETPLACE_SOURCES[sourceId];
  const merged: McpServerDef[] = [];
  const warnings: string[] = [];
  let cursor = opts.cursor;
  let pages = 0;
  let lastFetchedAt = new Date().toISOString();

  while (pages < maxPages) {
    const url = buildListUrl(source, {
      ...opts,
      search: undefined,
      // Registry caps `limit` at 100. Use the max so we minimise round trips.
      limit: 100,
      cursor,
    });
    const res = await fetcher(url);
    if (!res || !res.ok) {
      // Network failure on first page → null. Mid-stream → return what we have
      // so the cache still gets a partial snapshot rather than nothing.
      return pages === 0
        ? null
        : { source: sourceId, servers: merged, fetchedAt: lastFetchedAt, warnings };
    }

    let payload: unknown;
    try {
      payload = await res.json();
    } catch {
      return pages === 0
        ? null
        : { source: sourceId, servers: merged, fetchedAt: lastFetchedAt, warnings };
    }

    const page =
      sourceId === 'official' ? normalizeOfficial(payload) : normalizeGlama(payload);
    merged.push(...page.servers);
    warnings.push(...page.warnings);
    lastFetchedAt = page.fetchedAt;
    onProgress?.(merged.length, pages + 1);

    if (!page.nextCursor) break;
    cursor = page.nextCursor;
    pages += 1;
  }

  return { source: sourceId, servers: merged, fetchedAt: lastFetchedAt, warnings };
}

/**
 * Sort a server list alphabetically by display name (case-insensitive).
 * Pure helper so the renderer can re-sort after any filter change.
 */
export function sortByName(servers: McpServerDef[]): McpServerDef[] {
  return [...servers].sort((a, b) =>
    a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
  );
}

/**
 * Sort by composite quality score, descending. Servers with no quality
 * field land at the bottom (treated as 0). Featured servers always come
 * first regardless of raw score, then verified, then everyone else.
 * Within each tier, ties break alphabetically so reruns are stable.
 */
export function sortByQuality(servers: McpServerDef[]): McpServerDef[] {
  return [...servers].sort((a, b) => {
    const tierA = a.featured ? 2 : a.verified ? 1 : 0;
    const tierB = b.featured ? 2 : b.verified ? 1 : 0;
    if (tierA !== tierB) return tierB - tierA;
    const qA = a.quality ?? 0;
    const qB = b.quality ?? 0;
    if (qA !== qB) return qB - qA;
    return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  });
}

/**
 * Sort by `updatedAt` descending — most-recently-published first. Servers
 * without a timestamp land at the bottom. Used by the "Recently Updated"
 * sort mode in the marketplace UI.
 */
export function sortByUpdated(servers: McpServerDef[]): McpServerDef[] {
  return [...servers].sort((a, b) => {
    const tA = a.updatedAt ? Date.parse(a.updatedAt) : 0;
    const tB = b.updatedAt ? Date.parse(b.updatedAt) : 0;
    if (tA !== tB) return tB - tA;
    return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  });
}

// ─── Quality scoring ──────────────────────────────────────────────────────

/**
 * Inputs to the quality scorer. All optional / boolean signals derived
 * from a single registry entry. The scorer is pure — same input always
 * yields the same number, so the score is stable across reloads.
 */
export interface QualityInputs {
  /** Publisher namespace is in VERIFIED_PUBLISHERS. +30 pts. */
  verified?: boolean;
  /** Hand-picked featured server. +20 pts on top of verified. */
  featured?: boolean;
  /** _meta status === 'active'. +10 pts. */
  active?: boolean;
  /** Length of the description in characters. ≥50 = +10, ≥150 = +5 more. */
  descriptionLength?: number;
  /** Server has at least one stdio package definition. +5 pts. */
  hasPackages?: boolean;
  /** Server has at least one remote endpoint definition. +5 pts. */
  hasRemotes?: boolean;
  /** Server has a repository URL. +5 pts. */
  hasRepository?: boolean;
  /** Server provides a human-readable title separate from the namespaced name. +5 pts. */
  hasTitle?: boolean;
  /** Number of documented env vars (signals auth thoughtfulness). 1+ = +5 pts. */
  envVarCount?: number;
  /** Number of tags. ≥1 = +5 pts. */
  tagCount?: number;
}

/**
 * Compute a 0-100 quality score from a server's metadata signals. Higher
 * is better. The math is intentionally simple and tweakable in one place
 * — if registries start exposing real signals (install counts, GitHub
 * stars), they fold in here.
 */
export function computeQuality(inputs: QualityInputs): number {
  let score = 0;
  if (inputs.verified) score += 30;
  if (inputs.featured) score += 20;
  if (inputs.active) score += 10;
  if ((inputs.descriptionLength ?? 0) >= 50) score += 10;
  if ((inputs.descriptionLength ?? 0) >= 150) score += 5;
  if (inputs.hasPackages) score += 5;
  if (inputs.hasRemotes) score += 5;
  if (inputs.hasRepository) score += 5;
  if (inputs.hasTitle) score += 5;
  if ((inputs.envVarCount ?? 0) >= 1) score += 5;
  if ((inputs.tagCount ?? 0) >= 1) score += 5;
  return Math.min(100, score);
}

/**
 * Map a 0-100 score into one of four UI tiers. Threshold choices:
 *   - 'top'   ≥75  Verified + complete metadata
 *   - 'good'  50–74 Active, well-described, may not be verified
 *   - 'fair'  25–49 Has the basics, not much metadata
 *   - 'low'   <25  Sparse — surface to power users only
 */
export function qualityTier(score: number | undefined): 'top' | 'good' | 'fair' | 'low' {
  const s = score ?? 0;
  if (s >= 75) return 'top';
  if (s >= 50) return 'good';
  if (s >= 25) return 'fair';
  return 'low';
}

/**
 * Pull the registry's `_meta.io.modelcontextprotocol.registry/official`
 * block out of an entry. The key contains a slash so we have to look it
 * up by string lookup rather than dot access.
 */
function registryMetaFromEntry(
  entry: Record<string, unknown>,
): { status?: string; isLatest?: boolean; updatedAt?: string; publishedAt?: string } | undefined {
  const meta = entry['_meta'] as Record<string, unknown> | undefined;
  if (!meta) return undefined;
  const block = meta['io.modelcontextprotocol.registry/official'] as
    | Record<string, unknown>
    | undefined;
  if (!block) return undefined;
  return {
    status: typeof block['status'] === 'string' ? (block['status'] as string) : undefined,
    isLatest: typeof block['isLatest'] === 'boolean' ? (block['isLatest'] as boolean) : undefined,
    updatedAt: typeof block['updatedAt'] === 'string' ? (block['updatedAt'] as string) : undefined,
    publishedAt:
      typeof block['publishedAt'] === 'string' ? (block['publishedAt'] as string) : undefined,
  };
}

/**
 * De-duplicate by `id`, keeping the FIRST occurrence. The official
 * registry returns one entry per published version, so the same logical
 * server appears multiple times — we only want one card per id.
 */
export function dedupeById(servers: McpServerDef[]): McpServerDef[] {
  const seen = new Set<string>();
  const out: McpServerDef[] = [];
  for (const s of servers) {
    if (seen.has(s.id)) continue;
    seen.add(s.id);
    out.push(s);
  }
  return out;
}

/**
 * Merge a fetched marketplace catalogue with the local starter + already-
 * installed registry. Local entries always win on id collision so a user's
 * customizations (env tweaks, capability additions) survive a re-fetch.
 */
export function mergeRegistries(
  starter: McpServerDef[],
  installed: McpServerDef[],
  fetched: McpServerDef[],
): McpServerDef[] {
  const seen = new Set<string>();
  const out: McpServerDef[] = [];
  // Local installs win first (they may override starter env vars etc.)
  for (const def of installed) {
    if (seen.has(def.id)) continue;
    seen.add(def.id);
    out.push(def);
  }
  // Then starter — well-known shapes ship with the app.
  for (const def of starter) {
    if (seen.has(def.id)) continue;
    seen.add(def.id);
    out.push(def);
  }
  // Then fetched — the long tail.
  for (const def of fetched) {
    if (seen.has(def.id)) continue;
    seen.add(def.id);
    out.push(def);
  }
  return out;
}

// ─── URL builders ─────────────────────────────────────────────────────────

function buildListUrl(source: MarketplaceSource, opts: FetchOptions): string {
  const q = new URLSearchParams();
  if (opts.search) q.set('search', opts.search);
  if (opts.updatedSince) q.set('updated_since', opts.updatedSince);
  if (opts.limit) q.set('limit', String(opts.limit));
  if (opts.cursor) q.set('cursor', opts.cursor);
  // The official registry exposes /v0.1/servers; Glama's path is /servers.
  const path = source.id === 'official' ? `/${source.apiVersion}/servers` : '/servers';
  const qs = q.toString();
  return `${source.baseUrl}${path}${qs ? `?${qs}` : ''}`;
}

// ─── Normalizers ──────────────────────────────────────────────────────────

/**
 * Official registry shape (v0 — the live production endpoint):
 *
 *   {
 *     servers: [
 *       {
 *         server: {                                 // ← entries are wrapped!
 *           name: "<namespace>/<identifier>",       // e.g. "ac.tandem/docs-mcp"
 *           title?: string,                         // human-readable display name
 *           description?: string,
 *           repository?: { url: string, source?: string },
 *           version: string,
 *           packages?: [                            // stdio entry points
 *             {
 *               registryType: "npm" | "pypi" | "oci" | ...,
 *               identifier: string,                 // e.g. "@scope/pkg-name"
 *               version: string,
 *               transport: { type: "stdio" },
 *               environmentVariables?: [{ name, description?, isRequired?, format? }],
 *               packageArguments?: [{ name?, value?, default? }],
 *             }
 *           ],
 *           remotes?: [                             // HTTP / SSE entry points
 *             { type: "streamable-http" | "sse", url: string, headers?: ... }
 *           ],
 *         },
 *         _meta: { ... },                           // status, timestamps (sibling, not nested)
 *       }
 *     ],
 *     metadata: { nextCursor?: string, count: number }
 *   }
 *
 * Notes / quirks discovered against the live API:
 *   - `nextCursor` is camelCase (NOT `next_cursor`).
 *   - There is no top-level `name`/`displayName` separate from the namespaced
 *     `name`; we synthesize a display name from the identifier portion.
 *   - The registry doesn't surface a `runtime_hint`. We derive the launcher
 *     command from `registryType` instead: npm → npx, pypi → uvx, oci → docker.
 *   - Many entries are remote-only (`remotes[]` with no `packages[]`).
 */
function normalizeOfficial(payload: unknown): FetchResult {
  const out: McpServerDef[] = [];
  const warnings: string[] = [];

  const root = payload as {
    servers?: Array<Record<string, unknown>>;
    metadata?: { nextCursor?: string };
  };
  const entries = root?.servers ?? [];
  const nextCursor = root?.metadata?.nextCursor;

  for (const entry of entries) {
    // Each top-level array element is a wrapper { server, _meta }. Older
    // shapes shipped the fields flat — accept both for forward-compat.
    const server = (entry['server'] as Record<string, unknown> | undefined) ?? entry;
    const meta = registryMetaFromEntry(entry);

    // Skip non-latest version rows so we don't list 5 cards for the same
    // server. The registry returns one row per published version; only
    // the row with isLatest=true represents the current install target.
    // If isLatest is absent (older shapes), keep the entry — better to
    // show something than silently drop the whole catalogue.
    if (meta?.isLatest === false) continue;

    // Drop deprecated / withdrawn rows entirely.
    if (meta?.status && meta.status !== 'active') continue;

    const fullName = stringField(server, 'name'); // e.g. "ac.tandem/docs-mcp"
    if (!fullName) {
      warnings.push('skipped: server missing name');
      continue;
    }
    const id = idFromOfficialName(fullName);
    const description = stringField(server, 'description') ?? '';
    const repository = (server['repository'] as { url?: string } | undefined)?.url;
    const homepage = repository;
    // Prefer the registry-supplied human-readable title when present.
    const title = stringField(server, 'title');

    const transport = transportFromOfficial(server);
    if (!transport) {
      warnings.push(`skipped ${fullName}: no usable transport`);
      continue;
    }

    const publisher = publisherFromOfficialName(fullName);
    const verified = isVerifiedPublisher(publisher);
    const featured = FEATURED_SERVERS.has(fullName);
    const envVarSpecs = envVarSpecsFromOfficial(server);
    const envVars = envVarSpecs.map((s) => s.name);
    const tags = tagsFromOfficial(server);

    out.push({
      id,
      name: title ?? prettyNameFromOfficialName(fullName),
      family: id,
      description,
      capabilities: [], // official registry doesn't carry capability tags yet
      transport,
      envVars,
      envVarSpecs,
      tags,
      ...(homepage ? { homepage } : {}),
      iconUrl: iconUrlFromHints(repository, homepage),
      publisher,
      verified,
      featured,
      updatedAt: meta?.updatedAt,
      quality: computeQuality({
        verified,
        featured,
        active: meta?.status === 'active',
        descriptionLength: description.length,
        hasPackages: Array.isArray(server['packages']) && (server['packages'] as unknown[]).length > 0,
        hasRemotes: Array.isArray(server['remotes']) && (server['remotes'] as unknown[]).length > 0,
        hasRepository: !!repository,
        hasTitle: !!title,
        envVarCount: envVars.length,
        tagCount: tags?.length ?? 0,
      }),
    });
  }

  return {
    source: 'official',
    servers: out,
    nextCursor,
    fetchedAt: new Date().toISOString(),
    warnings,
  };
}

/**
 * Glama shape:
 *
 *   { servers: [{ id, name, description, repository, command, args, env,
 *                 url, transport, environmentVariables, tags, attributes }],
 *     pagination: { nextCursor } }
 *
 * Glama's schema isn't versioned the way the official one is, so we keep
 * the parser permissive and fall through to warnings on unknown shapes.
 */
function normalizeGlama(payload: unknown): FetchResult {
  const out: McpServerDef[] = [];
  const warnings: string[] = [];

  const root = payload as {
    servers?: Array<Record<string, unknown>>;
    pagination?: { nextCursor?: string };
  };
  const servers = root?.servers ?? [];
  const nextCursor = root?.pagination?.nextCursor;

  for (const raw of servers) {
    const id = stringField(raw, 'id') ?? stringField(raw, 'slug');
    if (!id) {
      warnings.push('skipped: glama entry missing id/slug');
      continue;
    }
    const description = stringField(raw, 'description') ?? '';
    const transport = transportFromGlama(raw);
    if (!transport) {
      warnings.push(`skipped ${id}: no transport described`);
      continue;
    }

    const repo = stringField(raw, 'repository');
    out.push({
      id,
      name: stringField(raw, 'name') ?? prettyNameFromOfficialName(id),
      family: id,
      description,
      capabilities: [],
      transport,
      envVars: envVarsFromGlama(raw),
      tags: stringArrayField(raw, 'tags'),
      ...(repo ? { homepage: repo } : {}),
      iconUrl: iconUrlFromHints(repo, repo),
    });
  }

  return {
    source: 'glama',
    servers: out,
    nextCursor,
    fetchedAt: new Date().toISOString(),
    warnings,
  };
}

// ─── Per-source detail extractors ─────────────────────────────────────────

function transportFromOfficial(raw: Record<string, unknown>): McpTransport | null {
  // Prefer stdio packages — derive launcher command from registryType
  // (the registry never surfaces a `runtime_hint` directly).
  const packages = (raw['packages'] as Array<Record<string, unknown>> | undefined) ?? [];
  for (const pkg of packages) {
    const registry = (stringField(pkg, 'registryType') ?? stringField(pkg, 'registry_name') ?? '').toLowerCase();
    const identifier = stringField(pkg, 'identifier') ?? stringField(pkg, 'name');
    if (!identifier) continue;

    if (registry === 'npm') {
      return { type: 'stdio', command: 'npx', args: ['-y', identifier, ...packageArgs(pkg)] };
    }
    if (registry === 'pypi' || registry === 'pip') {
      return { type: 'stdio', command: 'uvx', args: [identifier, ...packageArgs(pkg)] };
    }
    if (registry === 'oci' || registry === 'docker') {
      return {
        type: 'stdio',
        command: 'docker',
        args: ['run', '--rm', '-i', identifier, ...packageArgs(pkg)],
      };
    }
    if (registry === 'cargo') {
      return { type: 'stdio', command: 'cargo', args: ['run', identifier, ...packageArgs(pkg)] };
    }
  }

  // Fall back to remotes — the official registry uses bare `type` (not
  // `transport_type`) and emits "streamable-http" for HTTP-streaming servers.
  const remotes = (raw['remotes'] as Array<Record<string, unknown>> | undefined) ?? [];
  for (const rem of remotes) {
    const t = (stringField(rem, 'type') ?? stringField(rem, 'transport_type') ?? '').toLowerCase();
    const url = stringField(rem, 'url');
    if (!url) continue;
    if (t === 'http' || t === 'streamable-http' || t === 'streaming-http') {
      return { type: 'http', url };
    }
    if (t === 'sse') return { type: 'sse', url };
  }
  return null;
}

function transportFromGlama(raw: Record<string, unknown>): McpTransport | null {
  const command = stringField(raw, 'command');
  const args = stringArrayField(raw, 'args');
  if (command) return { type: 'stdio', command, ...(args ? { args } : {}) };
  const url = stringField(raw, 'url');
  if (url) {
    const t = stringField(raw, 'transport') ?? 'http';
    return { type: t === 'sse' ? 'sse' : 'http', url };
  }
  return null;
}

/**
 * Pull rich env-var specs from each package + remote in the registry
 * entry. Names are deduped — first occurrence wins, so packages declared
 * earlier (typically the recommended runtime) define the canonical
 * description for a given env var.
 *
 * Live API field names are camelCase (`environmentVariables`,
 * `isRequired`, `isSecret`); older docs use snake_case. Accept both.
 *
 * Heuristic for `secret`: registry's explicit `isSecret` flag wins.
 * When absent, common token-shaped names (`*_KEY`, `*_TOKEN`,
 * `*_SECRET`, `*_PASSWORD`) are treated as secret so the input gets
 * masked even when the publisher forgot to flag the field.
 */
function envVarSpecsFromOfficial(raw: Record<string, unknown>): EnvVarSpec[] {
  const out: EnvVarSpec[] = [];
  const seen = new Set<string>();
  const sources = [
    ...((raw['packages'] as Array<Record<string, unknown>> | undefined) ?? []),
    ...((raw['remotes'] as Array<Record<string, unknown>> | undefined) ?? []),
  ];

  for (const src of sources) {
    const list =
      (src['environmentVariables'] as Array<Record<string, unknown>> | undefined) ??
      (src['environment_variables'] as Array<Record<string, unknown>> | undefined);
    if (!list) continue;
    for (const e of list) {
      const name = stringField(e, 'name');
      if (!name || seen.has(name)) continue;
      seen.add(name);
      const explicitSecret =
        (e['isSecret'] as boolean | undefined) ?? (e['is_secret'] as boolean | undefined);
      out.push({
        name,
        description: stringField(e, 'description'),
        required:
          (e['isRequired'] as boolean | undefined) ??
          (e['is_required'] as boolean | undefined),
        secret: explicitSecret ?? looksLikeSecret(name),
        format: stringField(e, 'format'),
        default: stringField(e, 'default'),
      });
    }
  }
  return out;
}

/** Conservative classifier for env var names that almost certainly hold secrets. */
function looksLikeSecret(name: string): boolean {
  return /(?:_KEY|_TOKEN|_SECRET|_PASSWORD|_PWD|_CREDENTIAL|_BEARER)$/i.test(name);
}

function envVarsFromGlama(raw: Record<string, unknown>): string[] {
  const list = raw['environmentVariables'] as Array<Record<string, unknown>> | undefined;
  if (!list) return [];
  return [...new Set(list.map((e) => stringField(e, 'name')).filter((s): s is string => !!s))];
}

function tagsFromOfficial(raw: Record<string, unknown>): string[] {
  // Official registry currently embeds tags in `attributes` — be lenient.
  const attrs = raw['attributes'] as Record<string, unknown> | undefined;
  const tags = (attrs?.['tags'] as string[] | undefined) ?? stringArrayField(raw, 'tags') ?? [];
  return tags;
}

function packageArgs(pkg: Record<string, unknown>): string[] {
  // Live API: camelCase `packageArguments`. Older docs: snake_case. Accept both.
  const list =
    (pkg['packageArguments'] as Array<Record<string, unknown>> | undefined) ??
    (pkg['package_arguments'] as Array<Record<string, unknown>> | undefined);
  if (!list) return [];
  return list
    .map((a) => stringField(a, 'value') ?? stringField(a, 'default'))
    .filter((s): s is string => !!s);
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function stringField(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key];
  return typeof v === 'string' ? v : undefined;
}

function stringArrayField(obj: Record<string, unknown>, key: string): string[] | undefined {
  const v = obj[key];
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((x): x is string => typeof x === 'string');
  return out.length > 0 ? out : undefined;
}

/**
 * Official registry names look like `<namespace>/<identifier>` —
 * `ac.tandem/docs-mcp`, `io.github.modelcontextprotocol/filesystem`,
 * etc. The trailing identifier becomes the flowstate id so refs read
 * naturally (`mcp:filesystem`). Collisions across namespaces fall back
 * to the namespace-disambiguated form (`mcp:tandem-docs-mcp`).
 *
 * Output is always kebab-cased lowercase with no dots — flowstate's
 * tool-ref grammar uses dots to delimit `provider:id.action`, so
 * preserving them in the id breaks downstream resolvers.
 */
function idFromOfficialName(fullName: string): string {
  const slash = fullName.lastIndexOf('/');
  const tail = slash >= 0 ? fullName.slice(slash + 1) : fullName;
  const cleaned = tail.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (cleaned) return cleaned;
  // Pathological case — identifier was all symbols. Fall back to flattened
  // namespaced form so we still produce SOMETHING usable.
  return fullName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * Display name for the marketplace card. We render the trailing identifier
 * with separators turned into spaces and word-cased, plus the namespace
 * shown small underneath. Example:
 *
 *   "ac.tandem/docs-mcp"   →  "Docs Mcp"   (namespace "ac.tandem" surfaced separately by UI)
 *   "io.github.x/filesystem" → "Filesystem"
 */
function prettyNameFromOfficialName(fullName: string): string {
  const slash = fullName.lastIndexOf('/');
  const tail = slash >= 0 ? fullName.slice(slash + 1) : fullName;
  const words = tail
    .replace(/^@[^/]+\//, '') // strip npm scope if present
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/);
  if (words.length === 0 || (words.length === 1 && !words[0])) return tail;
  return words
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : ''))
    .join(' ');
}
