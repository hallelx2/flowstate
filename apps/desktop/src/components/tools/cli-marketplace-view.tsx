import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Search,
  X,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  KeyRound,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Terminal,
  Copy,
  Play,
} from 'lucide-react';
import {
  actionsForFamily,
  instructionsForPlatform,
  type CliToolFamily,
  type Platform,
  type CliToolDef,
} from '@flowstate/core';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import {
  cliStore,
  filterFamilies,
  useCliStore,
  type CliAuthResult,
  type CliProbeResult,
} from '@/lib/cli-store';

/**
 * CLI tool marketplace.
 *
 * Sibling of the MCP marketplace. Curated catalog ships with the app —
 * each entry describes one CLI brand (`gh`, `aws`, `docker`, …). On open,
 * we probe every entry's `versionProbe` against the local PATH so the
 * grid shows install status at a glance, then run auth probes for the
 * installed ones in the background.
 *
 * Per family, the user can:
 *   - See install instructions for their OS, copy a one-liner, or open
 *     the official install page
 *   - Run an interactive auth command in a fresh terminal
 *     (gh auth login, gcloud auth login, stripe login, …)
 *   - Set env-var secrets directly into the keychain
 *     (AWS_ACCESS_KEY_ID, PGPASSWORD, …)
 *   - Browse the actions agents can call (cli:gh.pr.create, …)
 */
export function CliMarketplaceView() {
  const state = useCliStore();
  const [selected, setSelected] = useState<CliToolFamily | null>(null);
  const [platform, setPlatform] = useState<Platform>(detectInitialPlatform());

  useEffect(() => {
    void cliStore.hydrate();
    if (window.flowstate?.platformId) {
      const p = window.flowstate.platformId();
      if (p === 'darwin' || p === 'win32' || p === 'linux') {
        setPlatform(p);
      }
    }
  }, []);

  const filtered = useMemo(
    () => filterFamilies(state.families, state.query),
    [state.families, state.query],
  );

  const installedCount = state.families.filter((f) => state.probes[f.id]?.installed).length;

  return (
    <div className="relative flex h-full bg-paper">
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* ─── Header ─────────────────────────────────────────────────── */}
        <div className="relative shrink-0 border-b border-stone-subtle bg-paper px-12 pb-7 pt-12">
          <div className="absolute left-12 top-7 flex items-center gap-2">
            <span className="block h-1.5 w-1.5 rounded-sm bg-cohere-purple-500" />
            <span className="font-mono text-2xs uppercase tracking-codeWide text-ink-subtle">
              CLI MARKETPLACE
            </span>
          </div>

          <div className="mt-8 flex items-end justify-between gap-8">
            <div className="max-w-2xl">
              <h1 className="font-display text-5xl text-ink">
                Hook your existing CLIs
                <br />
                <span className="italic font-light text-ink-subtle">into agents</span>.
              </h1>
              <p className="mt-4 max-w-xl text-base leading-relaxed text-ink-muted">
                If you already use <code className="font-mono text-xs text-ink">gh</code>,{' '}
                <code className="font-mono text-xs text-ink">aws</code>, or{' '}
                <code className="font-mono text-xs text-ink">stripe</code> from the terminal,
                flowstate detects them, runs their auth flow when you ask, and lets agents call
                templated subcommands via{' '}
                <code className="font-mono text-xs text-ink">cli:&lt;name&gt;</code>.
              </p>
            </div>

            <PlatformPicker value={platform} onChange={setPlatform} />
          </div>

          <div className="mt-9 flex items-center gap-3">
            <div className="flex w-full max-w-xl items-center gap-2 rounded-md border border-stone bg-paper-raised px-3 py-1.5 focus-within:border-cohere-purple-focus">
              <Search size={14} className="text-ink-subtle" />
              <input
                value={state.query}
                onChange={(e) => cliStore.setQuery(e.target.value)}
                placeholder="search by name, capability, tag… (gh, aws, postgres, deploy…)"
                className="flex-1 bg-transparent text-sm text-ink placeholder:text-ink-subtle focus:outline-none"
              />
              {state.query && (
                <button
                  type="button"
                  onClick={() => cliStore.setQuery('')}
                  className="text-ink-subtle hover:text-ink"
                >
                  <X size={13} />
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => void cliStore.hydrate()}
              disabled={state.loading}
              className="inline-flex items-center gap-1.5 rounded-md border border-stone bg-paper px-3 py-1.5 text-xs font-medium text-ink hover:border-ink disabled:opacity-50"
              title="Re-probe all CLIs"
            >
              <RefreshCw size={12} className={state.loading ? 'animate-spin' : ''} />
              Re-probe
            </button>
            <span className="ml-auto font-mono text-2xs uppercase tracking-code text-ink-subtle">
              {installedCount} of {state.families.length} installed · {filtered.length} match
            </span>
          </div>
        </div>

        {/* ─── Body ───────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-12 py-6">
          {state.error ? (
            <ErrorState message={state.error} />
          ) : state.loading && Object.keys(state.probes).length === 0 ? (
            <LoadingState />
          ) : filtered.length === 0 ? (
            <EmptyState query={state.query} />
          ) : (
            <motion.div layout className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {filtered.map((family, i) => (
                <motion.div
                  key={family.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25, delay: Math.min(i * 0.015, 0.15) }}
                >
                  <CliCard
                    family={family}
                    probe={state.probes[family.id]}
                    auth={state.authStatus[family.id]}
                    secretNames={state.secretNames}
                    onSelect={() => setSelected(family)}
                  />
                </motion.div>
              ))}
            </motion.div>
          )}
        </div>
      </div>

      <AnimatePresence>
        {selected && (
          <CliDetail
            key={selected.id}
            family={selected}
            probe={state.probes[selected.id]}
            auth={state.authStatus[selected.id]}
            secretNames={state.secretNames}
            platform={platform}
            onClose={() => setSelected(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Card ────────────────────────────────────────────────────────────────

function CliCard({
  family,
  probe,
  auth,
  secretNames,
  onSelect,
}: {
  family: CliToolFamily;
  probe: CliProbeResult | undefined;
  auth: CliAuthResult | undefined;
  secretNames: Set<string>;
  onSelect: () => void;
}) {
  const installed = probe?.installed ?? false;
  const authReady = isAuthReady(family, auth, secretNames);

  return (
    <button
      type="button"
      onClick={onSelect}
      className="group relative flex h-full w-full flex-col rounded-[18px] border border-stone-subtle bg-paper p-5 pr-28 text-left transition-colors hover:border-ink"
    >
      <span className="absolute right-4 top-4">
        <CliStatusBadge installed={installed} authReady={authReady} />
      </span>

      <div className="mb-1.5 flex items-center gap-1.5">
        {family.featured ? (
          <span className="inline-flex items-center gap-1 rounded-sm bg-ink px-1.5 py-0.5 font-mono text-2xs uppercase tracking-code text-paper">
            <Sparkles size={9} />
            Featured
          </span>
        ) : family.verified ? (
          <span className="inline-flex items-center gap-1 rounded-sm border border-ok px-1.5 py-0.5 font-mono text-2xs uppercase tracking-code text-ok">
            <ShieldCheck size={9} />
            Verified
          </span>
        ) : null}
      </div>

      <div className="flex items-start gap-3">
        <FamilyIcon family={family} size={36} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-display text-xl text-ink">{family.name}</h3>
          <span className="mt-0.5 block truncate font-mono text-2xs lowercase tracking-code text-ink-subtle">
            cli:{family.id}
          </span>
        </div>
      </div>

      <p className="mt-2.5 line-clamp-2 text-sm text-ink-muted">{family.description}</p>

      <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-4">
        {(family.tags ?? []).slice(0, 3).map((t) => (
          <span
            key={t}
            className="rounded-sm bg-paper-sunken px-1.5 py-0.5 font-mono text-2xs uppercase tracking-code text-ink-muted"
          >
            {t}
          </span>
        ))}
        {family.auth.kind === 'env' && (
          <span className="ml-auto inline-flex items-center gap-1 font-mono text-2xs text-ink-subtle">
            <KeyRound size={10} />
            {family.auth.envVars.length}
          </span>
        )}
      </div>
    </button>
  );
}

function CliStatusBadge({
  installed,
  authReady,
}: {
  installed: boolean;
  authReady: boolean | null;
}) {
  if (!installed) {
    return (
      <span className="inline-flex items-center gap-1 font-mono text-2xs uppercase tracking-code text-ink-subtle">
        not installed
      </span>
    );
  }
  if (authReady === false) {
    return (
      <span className="inline-flex items-center gap-1 font-mono text-2xs uppercase tracking-code text-warn">
        <AlertCircle size={11} />
        needs auth
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 font-mono text-2xs uppercase tracking-code text-ok">
      <CheckCircle2 size={11} />
      ready
    </span>
  );
}

// ─── Detail drawer ───────────────────────────────────────────────────────

function CliDetail({
  family,
  probe,
  auth,
  secretNames,
  platform,
  onClose,
}: {
  family: CliToolFamily;
  probe: CliProbeResult | undefined;
  auth: CliAuthResult | undefined;
  secretNames: Set<string>;
  platform: Platform;
  onClose: () => void;
}) {
  const installed = probe?.installed ?? false;
  const actions = actionsForFamily(family.id);
  const installSteps = instructionsForPlatform(family, platform);

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
          {family.publisher ? `${family.publisher} · ` : ''}cli:{family.id}
        </span>

        <div className="mt-3 flex items-center gap-1.5">
          {family.featured ? (
            <span className="inline-flex items-center gap-1 rounded-sm bg-ink px-1.5 py-0.5 font-mono text-2xs uppercase tracking-code text-paper">
              <Sparkles size={9} />
              Featured
            </span>
          ) : family.verified ? (
            <span className="inline-flex items-center gap-1 rounded-sm border border-ok px-1.5 py-0.5 font-mono text-2xs uppercase tracking-code text-ok">
              <ShieldCheck size={9} />
              Verified publisher
            </span>
          ) : null}
        </div>

        <div className="mt-3 flex items-start gap-3">
          <FamilyIcon family={family} size={48} />
          <h2 className="font-display text-3xl leading-none text-ink">{family.name}</h2>
        </div>

        <p className="mt-3 text-sm leading-relaxed text-ink-muted">
          {family.longDescription ?? family.description}
        </p>

        {family.homepage && (
          <a
            href={family.homepage}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex items-center gap-1 font-mono text-2xs uppercase tracking-code text-ink-subtle hover:text-ink"
          >
            <ExternalLink size={11} />
            {family.homepage.replace(/^https?:\/\//, '')}
          </a>
        )}

        {/* Live probe summary */}
        <div className="mt-4 rounded-md border border-stone-subtle bg-paper-sunken px-3 py-2">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  'h-1.5 w-1.5 rounded-full',
                  installed ? 'bg-ok' : 'bg-ink-subtle',
                )}
              />
              <span className="text-xs font-medium text-ink">
                {installed ? 'Installed on this machine' : 'Not detected on PATH'}
              </span>
            </div>
            {installed && probe?.version && (
              <code className="truncate font-mono text-2xs text-ink-subtle">
                {firstLine(probe.version)}
              </code>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-7 py-6">
        {/* Install section */}
        {!installed && (
          <InstallSection
            family={family}
            steps={installSteps}
            platform={platform}
          />
        )}

        {/* Auth section */}
        {installed && family.auth.kind !== 'none' && (
          <CliAuthSection family={family} auth={auth} secretNames={secretNames} />
        )}

        {/* Actions */}
        {actions.length > 0 && (
          <section className="mt-7">
            <p className="eyebrow mb-3">
              actions · {actions.length} agent-callable
            </p>
            <ul className="divide-y divide-stone-subtle border-y border-stone-subtle">
              {actions.map((a) => (
                <CliActionRow key={a.id} action={a} />
              ))}
            </ul>
            <p className="mt-3 text-2xs text-ink-subtle">
              Agents reference these as <code className="font-mono">cli:{family.id}.&lt;action&gt;</code>
              . The runtime gates Bash to only the templates listed above.
            </p>
          </section>
        )}

        {/* Capabilities */}
        {family.capabilities.length > 0 && (
          <section className="mt-7">
            <p className="eyebrow mb-3">capabilities</p>
            <ul className="space-y-px">
              {family.capabilities.map((cap) => (
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
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-stone-subtle px-6 py-4">
        <span className="truncate font-mono text-2xs uppercase tracking-code text-ink-subtle">
          {installed
            ? family.auth.kind === 'none'
              ? 'ready · attach to agents via cli:'
              : isAuthReady(family, auth, secretNames)
                ? 'authenticated · ready to attach'
                : 'installed · not yet authenticated'
            : 'not installed yet'}
        </span>
        <button
          type="button"
          onClick={() => void cliStore.refreshFamily(family.id)}
          className="inline-flex items-center gap-1.5 rounded-md border border-stone px-2.5 py-1 text-xs font-medium text-ink-muted hover:border-ink hover:text-ink"
        >
          <RefreshCw size={11} />
          Re-probe
        </button>
      </div>
    </motion.aside>
  );
}

// ─── Install section ─────────────────────────────────────────────────────

function InstallSection({
  family,
  steps,
  platform,
}: {
  family: CliToolFamily;
  steps: ReturnType<typeof instructionsForPlatform>;
  platform: Platform;
}) {
  return (
    <section>
      <p className="eyebrow mb-3">
        install on {platformLabel(platform)}
      </p>
      {steps.length === 0 ? (
        <p className="text-sm text-ink-muted">
          No package-manager instruction shipped for this platform — see the official docs.
        </p>
      ) : (
        <div className="space-y-2">
          {steps.map((s) => (
            <CommandRow
              key={`${s.label}:${s.command}`}
              label={s.label}
              command={s.command}
              primary={s.primary}
            />
          ))}
        </div>
      )}
      {family.install.manual && (
        <ManualInstallLink
          url={family.install.manual.url}
          description={family.install.manual.description}
        />
      )}
    </section>
  );
}

function ManualInstallLink({
  url,
  description,
}: {
  url: string;
  description?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => void cliStore.openInstallPage(url)}
      className="mt-3 inline-flex items-center gap-1.5 font-mono text-2xs uppercase tracking-code text-ink-muted hover:text-ink"
    >
      <ExternalLink size={11} />
      {description ?? 'Open install docs'}
    </button>
  );
}

function CommandRow({
  label,
  command,
  primary,
}: {
  label: string;
  command: string;
  primary?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    await navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };
  return (
    <div
      className={cn(
        'rounded-md border bg-paper-sunken px-3 py-2',
        primary ? 'border-ink' : 'border-stone-subtle',
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-2xs uppercase tracking-code text-ink-muted">
          {label}
          {primary && <span className="ml-1 text-ok">· recommended</span>}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1 font-mono text-2xs uppercase tracking-code text-ink-subtle hover:text-ink"
        >
          <Copy size={10} />
          {copied ? 'copied' : 'copy'}
        </button>
      </div>
      <code className="mt-1 block break-all font-mono text-xs text-ink">{command}</code>
    </div>
  );
}

// ─── Auth section ────────────────────────────────────────────────────────

function CliAuthSection({
  family,
  auth,
  secretNames,
}: {
  family: CliToolFamily;
  auth: CliAuthResult | undefined;
  secretNames: Set<string>;
}) {
  const cfg = family.auth;
  if (cfg.kind === 'none') return null;

  if (cfg.kind === 'command') {
    const ready = auth?.authenticated ?? false;
    return (
      <section className="mb-7">
        <p className="eyebrow mb-3">authenticate · interactive</p>
        <div className="rounded-md border border-stone-subtle bg-paper-sunken px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-ink">
                {ready ? 'Signed in' : 'Run the auth command'}
              </p>
              {cfg.description && (
                <p className="mt-1 text-2xs text-ink-muted">{cfg.description}</p>
              )}
              <code className="mt-1.5 block font-mono text-2xs text-ink">
                $ {cfg.command}
              </code>
            </div>
            <Button
              type="button"
              onClick={async () => {
                const ok = await cliStore.runAuth(family.id);
                if (ok) {
                  // Give the user a few seconds to complete the flow,
                  // then re-probe. Cheap; user can also click Re-probe.
                  setTimeout(() => void cliStore.refreshFamily(family.id), 6000);
                }
              }}
            >
              <Terminal size={12} />
              {ready ? 'Re-run' : 'Open terminal'}
            </Button>
          </div>
        </div>
      </section>
    );
  }

  // env-var auth
  const required = cfg.envVars.filter((e) => e.required);
  const optional = cfg.envVars.filter((e) => !e.required);
  const setCount = cfg.envVars.filter((e) => secretNames.has(e.name)).length;
  const requiredMissing = required.filter((e) => !secretNames.has(e.name));

  return (
    <section className="mb-7">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="eyebrow">
          authenticate · {setCount}/{cfg.envVars.length} configured
        </p>
        {required.length > 0 && (
          <span className="font-mono text-2xs uppercase tracking-code text-ink-subtle">
            {required.length} required
          </span>
        )}
      </div>

      {cfg.description && (
        <p className="mb-3 text-2xs text-ink-muted">{cfg.description}</p>
      )}

      {requiredMissing.length > 0 && (
        <div className="mb-3 rounded-md border border-warn/40 bg-warn/5 px-3 py-2 text-xs text-ink">
          <span className="font-medium">Set the required keys to use this CLI</span>
          <span className="block text-2xs text-ink-muted">
            Until they're present, agents that declare{' '}
            <code className="font-mono">cli:{family.id}.*</code> will fail at run time.
          </span>
        </div>
      )}

      {required.length > 0 && (
        <div className="mb-3">
          <p className="mb-1.5 font-mono text-2xs uppercase tracking-code text-ink-subtle">
            required
          </p>
          <div className="space-y-2">
            {required.map((e) => (
              <CliSecretRow key={e.name} spec={e} present={secretNames.has(e.name)} />
            ))}
          </div>
        </div>
      )}

      {optional.length > 0 && (
        <div className="mb-1">
          <p className="mb-1.5 font-mono text-2xs uppercase tracking-code text-ink-subtle">
            optional
          </p>
          <div className="space-y-2">
            {optional.map((e) => (
              <CliSecretRow key={e.name} spec={e} present={secretNames.has(e.name)} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function CliSecretRow({
  spec,
  present,
}: {
  spec: { name: string; description?: string; required?: boolean; secret?: boolean };
  present: boolean;
}) {
  const masked = spec.secret ?? false;
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);

  const handleSave = async () => {
    if (!value) return;
    setBusy(true);
    try {
      await cliStore.setSecret(spec.name, value);
      setValue('');
      setEditing(false);
      setReveal(false);
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
          <code className="truncate font-mono text-xs text-ink">{spec.name}</code>
          {spec.required && (
            <span className="shrink-0 rounded-sm bg-ink/5 px-1 font-mono text-[10px] uppercase tracking-code text-ink-muted">
              required
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {present && !editing && (
            <button
              type="button"
              onClick={() => void cliStore.deleteSecret(spec.name)}
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

      {spec.description && (
        <p className="mt-1.5 text-2xs leading-relaxed text-ink-muted">{spec.description}</p>
      )}

      {editing && (
        <div className="mt-2.5 flex items-center gap-2">
          <input
            ref={(el) => el?.focus()}
            type={masked && !reveal ? 'password' : 'text'}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={masked ? `paste your ${spec.name.toLowerCase()}` : 'enter value'}
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
      )}
    </div>
  );
}

// ─── Misc ────────────────────────────────────────────────────────────────

function CliActionRow({ action }: { action: CliToolDef }) {
  return (
    <li className="flex items-center justify-between gap-3 py-3">
      <div className="min-w-0 flex-1">
        <span className="block truncate font-mono text-xs text-ink">cli:{action.id}</span>
        <span className="mt-0.5 block truncate text-2xs text-ink-muted">
          {action.description}
        </span>
      </div>
      <Play size={11} className="shrink-0 text-ink-subtle" />
    </li>
  );
}

function PlatformPicker({
  value,
  onChange,
}: {
  value: Platform;
  onChange: (p: Platform) => void;
}) {
  const OPTIONS: Array<{ id: Platform; label: string }> = [
    { id: 'darwin', label: 'macOS' },
    { id: 'win32', label: 'Windows' },
    { id: 'linux', label: 'Linux' },
  ];
  return (
    <div className="inline-flex items-stretch overflow-hidden rounded-md border border-stone bg-paper">
      {OPTIONS.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          className={cn(
            'px-2.5 py-1.5 text-xs font-medium transition-colors',
            value === o.id
              ? 'bg-ink text-paper'
              : 'text-ink-muted hover:bg-paper-sunken hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function FamilyIcon({ family, size }: { family: CliToolFamily; size: number }) {
  const [broken, setBroken] = useState(false);
  const dim = { width: size, height: size };

  if (family.iconUrl && !broken) {
    return (
      <span
        className="flex shrink-0 items-center justify-center overflow-hidden rounded-md border border-stone-subtle bg-paper"
        style={dim}
      >
        <img
          src={family.iconUrl}
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
  const letter = (family.name.match(/[a-z0-9]/i)?.[0] ?? '?').toUpperCase();
  const hue = hashHue(family.id);
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-md border border-stone-subtle font-display text-ink"
      style={{
        ...dim,
        background: family.brandColor ?? `hsl(${hue} 35% 94%)`,
        color: family.brandColor ? '#fff' : `hsl(${hue} 40% 28%)`,
        fontSize: Math.round(size * 0.42),
      }}
    >
      {letter}
    </span>
  );
}

function hashHue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}

function isAuthReady(
  family: CliToolFamily,
  auth: CliAuthResult | undefined,
  secretNames: Set<string>,
): boolean | null {
  if (family.auth.kind === 'none') return true;
  if (family.auth.kind === 'command') return auth?.authenticated ?? null;
  // env-var auth — ready when every required var is in the keychain
  const required = family.auth.envVars.filter((e) => e.required);
  if (required.length === 0) return true;
  return required.every((e) => secretNames.has(e.name));
}

function platformLabel(p: Platform): string {
  return p === 'darwin' ? 'macOS' : p === 'win32' ? 'Windows' : 'Linux';
}

function detectInitialPlatform(): Platform {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('mac')) return 'darwin';
  if (ua.includes('linux')) return 'linux';
  return 'win32';
}

function firstLine(s: string): string {
  return s.split(/\r?\n/)[0]?.slice(0, 80) ?? s;
}

// ─── States ──────────────────────────────────────────────────────────────

function EmptyState({ query }: { query: string }) {
  return (
    <div className="flex h-full min-h-[40vh] flex-col items-center justify-center text-center">
      <div className="font-display text-3xl text-ink">No matches.</div>
      <p className="mt-2 max-w-sm text-sm text-ink-muted">
        {query ? (
          <>
            Nothing in the catalogue matches{' '}
            <span className="font-mono text-ink">"{query}"</span>.
          </>
        ) : (
          'No CLIs in the catalogue yet.'
        )}
      </p>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex h-full min-h-[40vh] flex-col items-center justify-center text-center">
      <Loader2 size={32} className="animate-spin text-ink-subtle" />
      <p className="mt-4 font-mono text-2xs uppercase tracking-code text-ink-subtle">
        probing local CLIs…
      </p>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex h-full min-h-[40vh] flex-col items-center justify-center text-center">
      <AlertCircle size={28} className="text-warn" />
      <p className="mt-3 max-w-md text-sm text-ink-muted">{message}</p>
    </div>
  );
}
