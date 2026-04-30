import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Search,
  X,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  Download,
  Trash2,
  KeyRound,
  Loader2,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  Star,
  Sparkles,
} from 'lucide-react';
import { qualityTier, type MarketplaceSourceId, type McpServerDef } from '@flowstate/core';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import {
  applyFilter,
  applySort,
  isReady,
  lettersPresent,
  marketplaceStore,
  useMarketplace,
  type SortMode,
} from '@/lib/marketplace-store';

/**
 * Live MCP marketplace browser.
 *
 * Renderer asks main to fetch from the public registry (official by default,
 * Glama as fallback for the long tail). Each result is one MCP server def.
 * Clicking install writes it to ~/.flowstate/tools/mcp/<id>.json — from
 * that moment forward, agents can declare `mcp:<id>` and the runtime will
 * recognise the ref.
 *
 * Required secrets are surfaced inline so the user can authenticate the
 * server right after install without leaving the screen.
 */

const SOURCES: { id: MarketplaceSourceId; label: string; sub: string }[] = [
  { id: 'official', label: 'Official Registry', sub: 'modelcontextprotocol.io' },
  { id: 'glama', label: 'Glama', sub: '22k+ community servers' },
];

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

export function MarketplaceView() {
  const state = useMarketplace();
  const [selected, setSelected] = useState<McpServerDef | null>(null);

  // Cold-load the catalogue (cache-first) on mount. Subsequent renders
  // hit the disk cache and complete in tens of ms.
  useEffect(() => {
    void marketplaceStore.hydrate();
  }, []);

  // Filter first, then sort. Both pure — re-runs only when inputs change.
  const filtered = useMemo(
    () => applyFilter(state.allServers, state.query, state.letter),
    [state.allServers, state.query, state.letter],
  );

  const sorted = useMemo(
    () => applySort(filtered, state.sort),
    [filtered, state.sort],
  );

  const presentLetters = useMemo(() => lettersPresent(state.allServers), [state.allServers]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / state.pageSize));
  const page = Math.min(state.page, totalPages - 1);
  const pageStart = page * state.pageSize;
  const pageItems = sorted.slice(pageStart, pageStart + state.pageSize);

  const handleSourceChange = (next: MarketplaceSourceId) => {
    if (next === state.source) return;
    void marketplaceStore.setSource(next);
  };

  return (
    <div className="relative flex h-full bg-paper">
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* ─── Header ─────────────────────────────────────────────────── */}
        <div className="relative shrink-0 border-b border-stone-subtle bg-paper px-12 pb-7 pt-12">
          <div className="absolute left-12 top-7 flex items-center gap-2">
            <span className="block h-1.5 w-1.5 rounded-sm bg-cohere-purple-500" />
            <span className="font-mono text-2xs uppercase tracking-codeWide text-ink-subtle">
              MCP MARKETPLACE
            </span>
          </div>

          <div className="mt-8 flex items-end justify-between gap-8">
            <div className="max-w-2xl">
              <h1 className="font-display text-5xl text-ink">
                Find an MCP server,
                <br />
                <span className="italic font-light text-ink-subtle">install it</span>, attach it.
              </h1>
              <p className="mt-4 max-w-xl text-base leading-relaxed text-ink-muted">
                The full live catalogue. Pick a server, populate its secrets, and any agent that
                declares <code className="font-mono text-xs text-ink">mcp:&lt;id&gt;</code> will use it on
                the next run — and only that agent will see it.
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {SOURCES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => handleSourceChange(s.id)}
                  className={cn(
                    'flex flex-col items-start rounded-md border px-3 py-2 text-left transition-colors',
                    state.source === s.id
                      ? 'border-ink bg-ink text-paper'
                      : 'border-stone bg-paper text-ink-muted hover:border-ink hover:text-ink',
                  )}
                >
                  <span className="text-xs font-medium">{s.label}</span>
                  <span className="font-mono text-2xs uppercase tracking-code opacity-70">
                    {s.sub}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Search + refresh + status */}
          <div className="mt-9 flex items-center gap-3">
            <div className="flex w-full max-w-xl items-center gap-2 rounded-md border border-stone bg-paper-raised px-3 py-1.5 focus-within:border-cohere-purple-focus">
              <Search size={14} className="text-ink-subtle" />
              <input
                value={state.query}
                onChange={(e) => marketplaceStore.setQuery(e.target.value)}
                placeholder="search by name, description, capability… (gmail, postgres, stripe…)"
                className="flex-1 bg-transparent text-sm text-ink placeholder:text-ink-subtle focus:outline-none"
              />
              {state.query && (
                <button
                  type="button"
                  onClick={() => marketplaceStore.setQuery('')}
                  className="text-ink-subtle hover:text-ink"
                >
                  <X size={13} />
                </button>
              )}
            </div>
            <SortMenu
              value={state.sort}
              onChange={(s) => marketplaceStore.setSort(s)}
            />
            <button
              type="button"
              onClick={() => void marketplaceStore.refresh()}
              disabled={state.loading}
              className="inline-flex items-center gap-1.5 rounded-md border border-stone bg-paper px-3 py-1.5 text-xs font-medium text-ink hover:border-ink disabled:opacity-50"
              title={state.fetchedAt ? `Last fetched ${new Date(state.fetchedAt).toLocaleString()}` : 'Refresh'}
            >
              <RefreshCw size={12} className={state.loading ? 'animate-spin' : ''} />
              Refresh
            </button>
            <span className="ml-auto font-mono text-2xs uppercase tracking-code text-ink-subtle">
              {state.installedIds.size} installed · {state.allServers.length.toLocaleString()} total · {filtered.length.toLocaleString()} match
            </span>
          </div>

          {/* A→Z chips */}
          <AlphaBar
            current={state.letter}
            present={presentLetters}
            onChange={(l) => marketplaceStore.setLetter(l)}
          />
        </div>

        {/* ─── Body ───────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-12 py-6">
          {state.error ? (
            <ErrorState message={state.error} />
          ) : state.loading && state.allServers.length === 0 ? (
            <LoadingState progress={state.progress} />
          ) : pageItems.length === 0 ? (
            <EmptyState query={state.query} letter={state.letter} />
          ) : (
            <motion.div layout className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {pageItems.map((def, i) => (
                <motion.div
                  key={def.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25, delay: Math.min(i * 0.015, 0.15) }}
                >
                  <McpCard
                    def={def}
                    installed={state.installedIds.has(def.id)}
                    ready={isReady(def, state.secretNames)}
                    onSelect={() => setSelected(def)}
                  />
                </motion.div>
              ))}
            </motion.div>
          )}
        </div>

        {/* ─── Pagination footer ──────────────────────────────────────── */}
        {filtered.length > 0 && (
          <Pagination
            page={page}
            totalPages={totalPages}
            pageStart={pageStart}
            pageEnd={Math.min(pageStart + state.pageSize, filtered.length)}
            total={filtered.length}
            onPrev={() => marketplaceStore.prevPage()}
            onNext={() => marketplaceStore.nextPage()}
            onJump={(p) => marketplaceStore.setPage(p)}
          />
        )}
      </div>

      <AnimatePresence>
        {selected && (
          <McpDetail
            key={selected.id}
            def={selected}
            installed={state.installedIds.has(selected.id)}
            secretNames={state.secretNames}
            onClose={() => setSelected(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Card ────────────────────────────────────────────────────────────────

function McpCard({
  def,
  installed,
  ready,
  onSelect,
}: {
  def: McpServerDef;
  installed: boolean;
  ready: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="group relative flex h-full w-full flex-col rounded-[18px] border border-stone-subtle bg-paper p-5 pr-28 text-left transition-colors hover:border-ink"
    >
      {/* Status badge anchored to the top-right corner so it never crowds
          the title or id row, regardless of how long either string is. */}
      <span className="absolute right-4 top-4">
        <StatusBadge installed={installed} ready={ready} />
      </span>

      {/* Quality / verified / featured badges sit above the title.
          Featured implies verified, so we only render one of the two. */}
      <div className="mb-1.5 flex items-center gap-1.5">
        {def.featured ? (
          <span className="inline-flex items-center gap-1 rounded-sm bg-ink px-1.5 py-0.5 font-mono text-2xs uppercase tracking-code text-paper">
            <Sparkles size={9} />
            Featured
          </span>
        ) : def.verified ? (
          <span className="inline-flex items-center gap-1 rounded-sm border border-ok px-1.5 py-0.5 font-mono text-2xs uppercase tracking-code text-ok">
            <ShieldCheck size={9} />
            Verified
          </span>
        ) : null}
        <QualityPill quality={def.quality} />
      </div>

      {/* Title row — icon + display name + publisher/id underneath. */}
      <div className="flex items-start gap-3">
        <ServerIcon def={def} size={36} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-display text-xl text-ink">{def.name}</h3>
          <span className="mt-0.5 block truncate font-mono text-2xs lowercase tracking-code text-ink-subtle">
            {def.publisher ? `${def.publisher} · ` : ''}mcp:{def.id}
          </span>
        </div>
      </div>

      <p className="mt-2.5 line-clamp-2 text-sm text-ink-muted">{def.description}</p>

      <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-4">
        {(def.tags ?? []).slice(0, 3).map((t) => (
          <span
            key={t}
            className="rounded-sm bg-paper-sunken px-1.5 py-0.5 font-mono text-2xs uppercase tracking-code text-ink-muted"
          >
            {t}
          </span>
        ))}
        {def.envVars && def.envVars.length > 0 && (
          <span className="ml-auto inline-flex items-center gap-1 font-mono text-2xs text-ink-subtle">
            <KeyRound size={10} />
            {def.envVars.length}
          </span>
        )}
      </div>
    </button>
  );
}

/**
 * Brand icon for an MCP server. Tries `def.iconUrl` first (synthesized
 * from the GitHub repo or homepage favicon during normalization). Falls
 * back to a monogram bubble — the first letter of the display name in
 * a deterministic colour derived from the id, so the same server gets
 * the same colour every render.
 *
 * `onError` swap: image loads can quietly 404 (favicon services miss,
 * GitHub user renames). When that happens we drop the broken `<img>`
 * and render the monogram instead — never a busted icon.
 */
function ServerIcon({ def, size }: { def: McpServerDef; size: number }) {
  const [broken, setBroken] = useState(false);
  const dimensionStyle = { width: size, height: size };

  if (def.iconUrl && !broken) {
    return (
      <span
        className="flex shrink-0 items-center justify-center overflow-hidden rounded-md border border-stone-subtle bg-paper"
        style={dimensionStyle}
      >
        <img
          src={def.iconUrl}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setBroken(true)}
          className="h-full w-full object-cover"
        />
      </span>
    );
  }

  // Monogram fallback — first alphanumeric of the display name.
  const letter = (def.name.match(/[a-z0-9]/i)?.[0] ?? '?').toUpperCase();
  const hue = hashHue(def.id);
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-md border border-stone-subtle font-display text-ink"
      style={{
        ...dimensionStyle,
        background: `hsl(${hue} 35% 94%)`,
        color: `hsl(${hue} 40% 28%)`,
        fontSize: Math.round(size * 0.42),
      }}
    >
      {letter}
    </span>
  );
}

/** Stable 0-359 hue derived from a string. Same input always maps to the same hue. */
function hashHue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}

/**
 * Quality tier pill — colour-graded by `qualityTier()`.
 *
 *   top   ≥75   filled black star + "TOP"  (highest signal — verified + complete)
 *   good  50-74 outlined star + "GOOD"
 *   fair  25-49 dim star + "FAIR"
 *   low   <25   no pill (don't surface low-quality entries with their own badge)
 */
function QualityPill({ quality }: { quality?: number }) {
  if (quality == null) return null;
  const tier = qualityTier(quality);
  if (tier === 'low') return null;
  const cfg = {
    top: { label: 'TOP', cls: 'border-ink bg-ink text-paper', filled: true },
    good: { label: 'GOOD', cls: 'border-ink text-ink', filled: false },
    fair: { label: 'FAIR', cls: 'border-stone text-ink-muted', filled: false },
  }[tier];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 font-mono text-2xs uppercase tracking-code',
        cfg.cls,
      )}
      title={`Quality score ${quality}/100`}
    >
      <Star size={9} fill={cfg.filled ? 'currentColor' : 'none'} />
      {cfg.label}
    </span>
  );
}

/**
 * Sort dropdown — segmented-button style so the choices are visible without
 * a click. Quality-first by default; click a label to switch.
 */
function SortMenu({
  value,
  onChange,
}: {
  value: SortMode;
  onChange: (s: SortMode) => void;
}) {
  const OPTIONS: Array<{ id: SortMode; label: string; icon: typeof Star }> = [
    { id: 'top', label: 'Top Rated', icon: Star },
    { id: 'name', label: 'A→Z', icon: Sparkles },
    { id: 'updated', label: 'Recent', icon: RefreshCw },
  ];
  return (
    <div className="inline-flex items-stretch overflow-hidden rounded-md border border-stone bg-paper">
      {OPTIONS.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          className={cn(
            'px-2.5 py-1.5 text-xs font-medium transition-colors',
            value === id
              ? 'bg-ink text-paper'
              : 'text-ink-muted hover:bg-paper-sunken hover:text-ink',
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function StatusBadge({ installed, ready }: { installed: boolean; ready: boolean }) {
  if (!installed) {
    return (
      <span className="inline-flex items-center gap-1 font-mono text-2xs uppercase tracking-code text-ink-subtle">
        not installed
      </span>
    );
  }
  if (ready) {
    return (
      <span className="inline-flex items-center gap-1 font-mono text-2xs uppercase tracking-code text-ok">
        <CheckCircle2 size={11} />
        ready
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 font-mono text-2xs uppercase tracking-code text-warn">
      <AlertCircle size={11} />
      needs auth
    </span>
  );
}

// ─── Detail drawer ───────────────────────────────────────────────────────

function McpDetail({
  def,
  installed,
  secretNames,
  onClose,
}: {
  def: McpServerDef;
  installed: boolean;
  secretNames: Set<string>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);

  const handleInstall = async () => {
    setBusy(true);
    try {
      await marketplaceStore.install(def);
    } finally {
      setBusy(false);
    }
  };

  const handleUninstall = async () => {
    setBusy(true);
    try {
      await marketplaceStore.uninstall(def.id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.aside
      initial={{ x: 460, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 460, opacity: 0 }}
      transition={{ duration: 0.35, ease: [0.2, 0.8, 0.2, 1] }}
      className="relative flex w-[480px] shrink-0 flex-col overflow-hidden border-l border-stone bg-paper"
    >
      <div className="border-b border-stone-subtle px-7 py-7">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-5 top-5 rounded-md p-1 text-ink-muted hover:bg-paper-sunken hover:text-ink"
        >
          <X size={15} />
        </button>

        <span className="font-mono text-2xs uppercase tracking-codeWide text-ink-subtle">
          {def.publisher ? `${def.publisher} · ` : ''}mcp:{def.id} · {def.transport.type}
        </span>

        <div className="mt-3 flex items-center gap-1.5">
          {def.featured ? (
            <span className="inline-flex items-center gap-1 rounded-sm bg-ink px-1.5 py-0.5 font-mono text-2xs uppercase tracking-code text-paper">
              <Sparkles size={9} />
              Featured
            </span>
          ) : def.verified ? (
            <span className="inline-flex items-center gap-1 rounded-sm border border-ok px-1.5 py-0.5 font-mono text-2xs uppercase tracking-code text-ok">
              <ShieldCheck size={9} />
              Verified publisher
            </span>
          ) : null}
          <QualityPill quality={def.quality} />
        </div>

        <div className="mt-3 flex items-start gap-3">
          <ServerIcon def={def} size={48} />
          <h2 className="font-display text-3xl leading-none text-ink">{def.name}</h2>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-ink-muted">{def.description}</p>

        {def.homepage && (
          <a
            href={def.homepage}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex items-center gap-1 font-mono text-2xs uppercase tracking-code text-ink-subtle hover:text-ink"
          >
            <ExternalLink size={11} />
            {def.homepage.replace(/^https?:\/\//, '')}
          </a>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-7 py-6">
        {def.capabilities.length > 0 && (
          <section className="mb-7">
            <p className="eyebrow mb-3">capabilities</p>
            <ul className="space-y-px">
              {def.capabilities.map((cap) => (
                <li
                  key={cap}
                  className="rounded-md px-2 py-1.5 font-mono text-xs text-ink hover:bg-paper-sunken"
                >
                  {cap}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="mb-7">
          <p className="eyebrow mb-3">transport</p>
          <pre className="overflow-x-auto rounded-md border border-stone-subtle bg-paper-sunken p-3 font-mono text-2xs leading-relaxed text-ink-muted">
            {JSON.stringify(def.transport, null, 2)}
          </pre>
        </section>

        {def.envVars && def.envVars.length > 0 && (
          <AuthSection
            def={def}
            secretNames={secretNames}
            installed={installed}
          />
        )}

        {def.tags && def.tags.length > 0 && (
          <section>
            <p className="eyebrow mb-3">tags</p>
            <div className="flex flex-wrap gap-1.5">
              {def.tags.map((t) => (
                <span
                  key={t}
                  className="rounded-sm bg-paper-sunken px-1.5 py-0.5 font-mono text-2xs uppercase tracking-code text-ink-muted"
                >
                  {t}
                </span>
              ))}
            </div>
          </section>
        )}
      </div>

      <DetailFooter
        def={def}
        installed={installed}
        secretNames={secretNames}
        busy={busy}
        onInstall={handleInstall}
        onUninstall={handleUninstall}
      />
    </motion.aside>
  );
}

// ─── Detail drawer footer ────────────────────────────────────────────────

/**
 * Smart install / uninstall footer.
 *
 * The button label + state reflects authentication readiness:
 *   - already installed         →  Uninstall
 *   - no required secrets       →  Install
 *   - required secrets pending  →  "Set N keys above" — disabled, points the
 *                                  user up to the auth section
 *   - all required set          →  Install (live)
 *
 * The left side shows a one-line status so the user knows why the button
 * is in the state it is without having to scan the whole drawer.
 */
function DetailFooter({
  def,
  installed,
  secretNames,
  busy,
  onInstall,
  onUninstall,
}: {
  def: McpServerDef;
  installed: boolean;
  secretNames: Set<string>;
  busy: boolean;
  onInstall: () => void;
  onUninstall: () => void;
}) {
  const requiredMissing = useMemo(() => {
    const specs = def.envVarSpecs ?? [];
    return specs.filter((s) => s.required && !secretNames.has(s.name));
  }, [def.envVarSpecs, secretNames]);

  const blocked = !installed && requiredMissing.length > 0;

  return (
    <div className="flex items-center justify-between gap-3 border-t border-stone-subtle px-6 py-4">
      <span className="truncate font-mono text-2xs uppercase tracking-code text-ink-subtle">
        {installed
          ? 'installed · ready to attach'
          : blocked
            ? `${requiredMissing.length} required key${requiredMissing.length === 1 ? '' : 's'} missing`
            : 'ready to install'}
      </span>
      {installed ? (
        <button
          type="button"
          onClick={onUninstall}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-md border border-stone px-3 py-1.5 text-xs font-medium text-ink hover:border-warn hover:text-warn disabled:opacity-50"
        >
          <Trash2 size={12} />
          Uninstall
        </button>
      ) : (
        <Button
          type="button"
          onClick={onInstall}
          disabled={busy || blocked}
          className="disabled:opacity-40"
          title={blocked ? 'Set the required keys above first' : undefined}
        >
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
          {blocked ? 'Set keys to install' : 'Install'}
        </Button>
      )}
    </div>
  );
}

// ─── Auth section ────────────────────────────────────────────────────────

/**
 * Pre-install auth panel. Surfaces:
 *   - Required vs optional secrets (separated, required up top)
 *   - Per-secret descriptions + format hints from the registry
 *   - "X of Y configured" progress headline
 *   - "Set required keys before installing" gentle nudge when uninstalled
 *     and at least one required value is missing
 *   - Secret/non-secret aware input masking (no masking on plain config like a URL)
 */
function AuthSection({
  def,
  secretNames,
  installed,
}: {
  def: McpServerDef;
  secretNames: Set<string>;
  installed: boolean;
}) {
  // Build a unified list: prefer the rich spec; fall back to bare names.
  const specs = useMemo<EnvVarSpecLike[]>(() => {
    if (def.envVarSpecs && def.envVarSpecs.length > 0) {
      return def.envVarSpecs.map((s) => ({ ...s }));
    }
    return (def.envVars ?? []).map((name) => ({ name } as EnvVarSpecLike));
  }, [def.envVarSpecs, def.envVars]);

  const required = specs.filter((s) => s.required);
  const optional = specs.filter((s) => !s.required);
  const requiredMissing = required.filter((s) => !secretNames.has(s.name));
  const totalSet = specs.filter((s) => secretNames.has(s.name)).length;

  return (
    <section className="mb-7">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="eyebrow">
          authentication · {totalSet}/{specs.length} configured
        </p>
        {required.length > 0 && (
          <span className="font-mono text-2xs uppercase tracking-code text-ink-subtle">
            {required.length} required
          </span>
        )}
      </div>

      {!installed && requiredMissing.length > 0 && (
        <div className="mb-3 rounded-md border border-warn/40 bg-warn/5 px-3 py-2 text-xs text-ink">
          <span className="font-medium">Set the required keys before installing</span>
          <span className="block text-2xs text-ink-muted">
            {requiredMissing.length} of {required.length} required value
            {required.length === 1 ? '' : 's'} not yet stored — the server
            won't start without them.
          </span>
        </div>
      )}

      {required.length > 0 && (
        <div className="mb-3">
          <p className="mb-1.5 font-mono text-2xs uppercase tracking-code text-ink-subtle">
            required
          </p>
          <div className="space-y-2">
            {required.map((s) => (
              <SecretRow key={s.name} spec={s} present={secretNames.has(s.name)} />
            ))}
          </div>
        </div>
      )}

      {optional.length > 0 && (
        <div className="mb-3">
          <p className="mb-1.5 font-mono text-2xs uppercase tracking-code text-ink-subtle">
            optional
          </p>
          <div className="space-y-2">
            {optional.map((s) => (
              <SecretRow key={s.name} spec={s} present={secretNames.has(s.name)} />
            ))}
          </div>
        </div>
      )}

      <p className="mt-3 text-2xs text-ink-subtle">
        Values are encrypted on disk via the OS keychain. The renderer never
        reads them — only the agent runtime injects them into the MCP
        server's env at invocation time.
      </p>
    </section>
  );
}

// ─── Per-secret row with inline value entry ──────────────────────────────

/**
 * Local minimal type so the row works whether the registry handed us a
 * full EnvVarSpec or just a bare name string. Mirrors EnvVarSpec but
 * `name` is the only required field.
 */
type EnvVarSpecLike = {
  name: string;
  description?: string;
  required?: boolean;
  secret?: boolean;
  format?: string;
  default?: string;
};

function SecretRow({ spec, present }: { spec: EnvVarSpecLike; present: boolean }) {
  const { name } = spec;
  // The registry's `secret` flag drives input masking. Plain config values
  // (URLs, region names, paths) get a regular text input so the user can
  // verify what they typed.
  const masked = spec.secret ?? false;
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(spec.default ?? '');
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);

  const handleSave = async () => {
    if (!value) return;
    setBusy(true);
    try {
      await marketplaceStore.setSecret(name, value);
      setValue('');
      setEditing(false);
      setReveal(false);
    } finally {
      setBusy(false);
    }
  };

  const handleClear = async () => {
    setBusy(true);
    try {
      await marketplaceStore.deleteSecret(name);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-md border border-stone-subtle bg-paper-sunken px-3 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              'h-1.5 w-1.5 shrink-0 rounded-full',
              present ? 'bg-ok' : spec.required ? 'bg-warn' : 'bg-ink-subtle',
            )}
          />
          <code className="truncate font-mono text-xs text-ink">{name}</code>
          {spec.required && (
            <span className="shrink-0 rounded-sm bg-ink/5 px-1 font-mono text-[10px] uppercase tracking-code text-ink-muted">
              required
            </span>
          )}
          {spec.format && (
            <span className="shrink-0 font-mono text-[10px] lowercase tracking-code text-ink-subtle">
              {spec.format}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {present && !editing && (
            <button
              type="button"
              onClick={handleClear}
              className="font-mono text-2xs uppercase tracking-code text-ink-subtle hover:text-warn"
              disabled={busy}
            >
              clear
            </button>
          )}
          <button
            type="button"
            onClick={() => setEditing((e) => !e)}
            className="font-mono text-2xs uppercase tracking-code text-ink-subtle hover:text-ink"
          >
            {editing ? 'cancel' : present ? 'replace' : 'set'}
          </button>
        </div>
      </div>

      {/* Description always visible — the user needs to know what to paste. */}
      {spec.description && (
        <p className="mt-1.5 text-2xs leading-relaxed text-ink-muted">
          {spec.description}
        </p>
      )}

      {editing && (
        <div className="mt-2.5 space-y-1.5">
          <div className="flex items-center gap-2">
            <input
              ref={(el) => el?.focus()}
              type={masked && !reveal ? 'password' : 'text'}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={
                spec.default
                  ? `default: ${spec.default}`
                  : masked
                    ? `paste your ${name.toLowerCase()}`
                    : `enter ${spec.format ?? 'value'}`
              }
              className="flex-1 rounded-sm border border-stone bg-paper px-2 py-1.5 font-mono text-xs text-ink focus:border-cohere-purple-focus focus:outline-none"
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleSave();
                if (e.key === 'Escape') setEditing(false);
              }}
            />
            {masked && (
              <button
                type="button"
                onClick={() => setReveal((r) => !r)}
                className="rounded-sm border border-stone bg-paper px-2 py-1.5 font-mono text-2xs uppercase tracking-code text-ink-muted hover:text-ink"
                title={reveal ? 'Hide value' : 'Reveal value while typing'}
              >
                {reveal ? 'hide' : 'show'}
              </button>
            )}
            <button
              type="button"
              onClick={handleSave}
              disabled={!value || busy}
              className="rounded-sm border border-ink bg-ink px-2.5 py-1.5 font-mono text-2xs uppercase tracking-code text-paper disabled:opacity-50"
            >
              {busy ? '…' : 'save'}
            </button>
          </div>
          <p className="font-mono text-[10px] tracking-code text-ink-subtle">
            ↵ save · esc cancel
          </p>
        </div>
      )}
    </div>
  );
}

// ─── States ──────────────────────────────────────────────────────────────

function EmptyState({ query, letter }: { query: string; letter: string | null }) {
  return (
    <div className="flex h-full min-h-[40vh] flex-col items-center justify-center text-center">
      <div className="font-display text-3xl text-ink">No matches.</div>
      <p className="mt-2 max-w-sm text-sm text-ink-muted">
        {query ? (
          <>
            Nothing in the catalogue matches{' '}
            <span className="font-mono text-ink">"{query}"</span>. Try a different word, or clear
            the search.
          </>
        ) : letter ? (
          <>
            No servers starting with <span className="font-mono text-ink">{letter}</span>. Try a
            different letter, or clear the filter.
          </>
        ) : (
          'No servers in the catalogue yet. Click Refresh to pull a fresh copy.'
        )}
      </p>
    </div>
  );
}

function LoadingState({ progress }: { progress: { loaded: number; page: number } | null }) {
  return (
    <div className="flex h-full min-h-[40vh] flex-col items-center justify-center text-center">
      <Loader2 size={32} className="animate-spin text-ink-subtle" />
      <p className="mt-4 font-mono text-2xs uppercase tracking-code text-ink-subtle">
        {progress
          ? `pulling registry · ${progress.loaded.toLocaleString()} servers across ${progress.page} pages…`
          : 'contacting registry…'}
      </p>
    </div>
  );
}

// ─── A→Z chip row ────────────────────────────────────────────────────────

function AlphaBar({
  current,
  present,
  onChange,
}: {
  current: string | null;
  present: Set<string>;
  onChange: (letter: string | null) => void;
}) {
  return (
    <div className="mt-5 flex flex-wrap items-center gap-1">
      <button
        type="button"
        onClick={() => onChange(null)}
        className={cn(
          'rounded-sm px-2 py-1 font-mono text-2xs uppercase tracking-code transition-colors',
          current === null
            ? 'bg-ink text-paper'
            : 'text-ink-muted hover:bg-paper-sunken hover:text-ink',
        )}
      >
        all
      </button>
      {ALPHABET.map((letter) => {
        const has = present.has(letter);
        const active = current === letter;
        return (
          <button
            key={letter}
            type="button"
            disabled={!has}
            onClick={() => onChange(letter)}
            className={cn(
              'min-w-[28px] rounded-sm px-1.5 py-1 font-mono text-2xs uppercase tracking-code transition-colors',
              active
                ? 'bg-ink text-paper'
                : has
                  ? 'text-ink-muted hover:bg-paper-sunken hover:text-ink'
                  : 'text-ink-subtle/40 cursor-default',
            )}
          >
            {letter}
          </button>
        );
      })}
      {present.has('#') && (
        <button
          type="button"
          onClick={() => onChange('#')}
          className={cn(
            'rounded-sm px-1.5 py-1 font-mono text-2xs tracking-code transition-colors',
            current === '#'
              ? 'bg-ink text-paper'
              : 'text-ink-muted hover:bg-paper-sunken hover:text-ink',
          )}
        >
          #
        </button>
      )}
    </div>
  );
}

// ─── Pagination footer ───────────────────────────────────────────────────

function Pagination({
  page,
  totalPages,
  pageStart,
  pageEnd,
  total,
  onPrev,
  onNext,
  onJump,
}: {
  page: number;
  totalPages: number;
  pageStart: number;
  pageEnd: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
  onJump: (page: number) => void;
}) {
  const window = 5;
  const half = Math.floor(window / 2);
  const from = Math.max(0, Math.min(page - half, totalPages - window));
  const to = Math.min(totalPages, from + window);
  const pages: number[] = [];
  for (let p = from; p < to; p += 1) pages.push(p);

  return (
    <div className="flex shrink-0 items-center justify-between border-t border-stone-subtle bg-paper px-12 py-4">
      <span className="font-mono text-2xs uppercase tracking-code text-ink-subtle">
        {pageStart + 1}–{pageEnd} of {total.toLocaleString()}
      </span>

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onPrev}
          disabled={page === 0}
          className="inline-flex items-center gap-1 rounded-md border border-stone bg-paper px-2.5 py-1 text-xs font-medium text-ink hover:border-ink disabled:opacity-40"
        >
          <ChevronLeft size={12} />
          Prev
        </button>

        {from > 0 && (
          <>
            <PageButton page={0} active={false} onClick={() => onJump(0)} />
            {from > 1 && (
              <span className="px-1 font-mono text-2xs text-ink-subtle">…</span>
            )}
          </>
        )}
        {pages.map((p) => (
          <PageButton key={p} page={p} active={p === page} onClick={() => onJump(p)} />
        ))}
        {to < totalPages && (
          <>
            {to < totalPages - 1 && (
              <span className="px-1 font-mono text-2xs text-ink-subtle">…</span>
            )}
            <PageButton
              page={totalPages - 1}
              active={false}
              onClick={() => onJump(totalPages - 1)}
            />
          </>
        )}

        <button
          type="button"
          onClick={onNext}
          disabled={page >= totalPages - 1}
          className="inline-flex items-center gap-1 rounded-md border border-stone bg-paper px-2.5 py-1 text-xs font-medium text-ink hover:border-ink disabled:opacity-40"
        >
          Next
          <ChevronRight size={12} />
        </button>
      </div>

      <span className="font-mono text-2xs uppercase tracking-code text-ink-subtle">
        page {page + 1} / {totalPages}
      </span>
    </div>
  );
}

function PageButton({
  page,
  active,
  onClick,
}: {
  page: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'min-w-[32px] rounded-md border px-2 py-1 text-xs font-medium transition-colors',
        active
          ? 'border-ink bg-ink text-paper'
          : 'border-stone bg-paper text-ink-muted hover:border-ink hover:text-ink',
      )}
    >
      {page + 1}
    </button>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex h-full min-h-[40vh] flex-col items-center justify-center text-center">
      <AlertCircle size={28} className="text-warn" />
      <p className="mt-3 max-w-md text-sm text-ink-muted">
        Couldn't reach the registry: <span className="font-mono text-ink">{message}</span>
      </p>
      <p className="mt-2 max-w-md text-2xs text-ink-subtle">
        Check your network. Already-installed servers continue to work offline.
      </p>
    </div>
  );
}
