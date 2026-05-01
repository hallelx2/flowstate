import { useCallback, useEffect, useState } from 'react';
import { motion } from 'motion/react';
import {
  KeyRound,
  FolderOpen,
  Wrench,
  Shield,
  Palette,
  Keyboard,
  Info,
  Check,
  ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { FlowstateMark } from '@/components/brand/flowstate-mark';
import { ClaudeMark } from '@/components/brand/claude-mark';
import { ModelPicker } from './model-picker';
import { updateSettings, useSettings } from '@/lib/settings-store';

type Section =
  | 'account'
  | 'workspace'
  | 'tools'
  | 'privacy'
  | 'appearance'
  | 'shortcuts'
  | 'about';

const SECTIONS: { id: Section; label: string; icon: typeof KeyRound; sub?: string }[] = [
  { id: 'account', label: 'Account & Model', icon: KeyRound, sub: 'Claude subscription · API · local' },
  { id: 'workspace', label: 'Workspace', icon: FolderOpen, sub: 'Agents + tools paths' },
  { id: 'tools', label: 'Tools', icon: Wrench, sub: 'Global defaults · sandbox' },
  { id: 'privacy', label: 'Privacy', icon: Shield, sub: 'Telemetry off by default' },
  { id: 'appearance', label: 'Appearance', icon: Palette, sub: 'Theme · density' },
  { id: 'shortcuts', label: 'Keyboard', icon: Keyboard, sub: '⌘K · run · navigate' },
  { id: 'about', label: 'About', icon: Info, sub: 'v0.1.0 · open source' },
];

export function SettingsView() {
  const [section, setSection] = useState<Section>('account');

  return (
    <div className="flex h-full bg-paper">
      {/* ─── Section nav ─── */}
      <aside className="flex w-[260px] shrink-0 flex-col border-r border-stone-subtle bg-paper-sunken">
        <div className="border-b border-stone-subtle px-5 pb-3 pt-5">
          <p className="eyebrow">settings</p>
          <h2 className="mt-2 font-display text-xl text-ink">Configuration</h2>
        </div>
        <nav className="flex flex-col gap-px p-2">
          {SECTIONS.map(({ id, label, icon: Icon, sub }) => {
            const isActive = section === id;
            return (
              <button
                key={id}
                onClick={() => setSection(id)}
                className={cn(
                  'group flex w-full items-start gap-3 rounded-md border px-3 py-2.5 text-left transition-all',
                  isActive
                    ? 'border-stone bg-paper'
                    : 'border-transparent hover:border-stone-subtle hover:bg-paper/60',
                )}
              >
                <Icon
                  size={14}
                  strokeWidth={1.6}
                  className={cn('mt-0.5 shrink-0', isActive ? 'text-ink' : 'text-ink-subtle')}
                />
                <div className="min-w-0">
                  <div className="text-sm text-ink">{label}</div>
                  {sub && <div className="mt-0.5 text-2xs text-ink-subtle">{sub}</div>}
                </div>
              </button>
            );
          })}
        </nav>
      </aside>

      {/* ─── Section content ─── */}
      <main className="flex-1 overflow-y-auto">
        <motion.div
          key={section}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          className="mx-auto max-w-3xl px-12 py-10"
        >
          {section === 'account' && <AccountSection />}
          {section === 'workspace' && <WorkspaceSection />}
          {section === 'tools' && <ToolsSection />}
          {section === 'privacy' && <PrivacySection />}
          {section === 'appearance' && <AppearanceSection />}
          {section === 'shortcuts' && <ShortcutsSection />}
          {section === 'about' && <AboutSection />}
        </motion.div>
      </main>
    </div>
  );
}

// ─── Sections ──────────────────────────────────────────────────────────────

function AccountSection() {
  const settings = useSettings();
  const provider = settings.account.provider ?? 'subscription';
  const model = settings.account.model ?? 'claude-opus-4-7';
  const favorites = settings.account.favorites ?? ['claude-opus-4-7'];

  const setProvider = (v: 'subscription' | 'api' | 'local') =>
    updateSettings({ account: { provider: v } });
  const setModel = (id: string) => updateSettings({ account: { model: id } });
  const toggleFavorite = (id: string) =>
    updateSettings({
      account: {
        favorites: favorites.includes(id)
          ? favorites.filter((x) => x !== id)
          : [...favorites, id],
      },
    });

  // ─── API key local state ───────────────────────────────────────────────
  // The renderer NEVER reads the value back — only checks the keychain
  // for whether the name is set, drives a green dot. Editing always means
  // typing the key fresh, then Save → secrets:set. Forgetting calls
  // secrets:delete.
  const [apiKeyDraft, setApiKeyDraft] = useState('');
  const [apiKeyStored, setApiKeyStored] = useState<boolean | null>(null);
  const [apiKeyBusy, setApiKeyBusy] = useState(false);

  // ─── Self-test state ───────────────────────────────────────────────────
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    message: string;
    apiKeySource?: string;
    durationMs?: number;
    tokensIn?: number;
    tokensOut?: number;
  } | null>(null);

  // Refresh the keychain dot on mount and after each save/forget.
  const refreshKeyStatus = useCallback(async () => {
    const names = await window.flowstate.secretsList();
    setApiKeyStored(names.includes('ANTHROPIC_API_KEY'));
  }, []);
  useEffect(() => {
    void refreshKeyStatus();
  }, [refreshKeyStatus]);

  const handleSaveKey = async () => {
    if (!apiKeyDraft.trim()) return;
    setApiKeyBusy(true);
    try {
      await window.flowstate.secretsSet('ANTHROPIC_API_KEY', apiKeyDraft.trim());
      setApiKeyDraft('');
      await refreshKeyStatus();
    } finally {
      setApiKeyBusy(false);
    }
  };

  const handleForgetKey = async () => {
    setApiKeyBusy(true);
    try {
      await window.flowstate.secretsDelete('ANTHROPIC_API_KEY');
      await refreshKeyStatus();
    } finally {
      setApiKeyBusy(false);
    }
  };

  const handleSelfTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const r = await window.flowstate.agentSelfTest();
      setTestResult(r);
    } catch (err) {
      setTestResult({
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Section
      title="Account & model"
      lede="Where your agents' reasoning happens. flowstate respects whatever Claude credentials you already have on this machine."
    >
      <Field label="Provider">
        <RadioGroup
          value={provider}
          onChange={(v) => setProvider(v as 'subscription' | 'api' | 'local')}
          options={[
            {
              value: 'subscription',
              title: 'Claude subscription (recommended)',
              sub: "Uses your local Claude Code auth. No API key needed. Doesn't count against API spend.",
              icon: <ClaudeMark size={14} />,
            },
            {
              value: 'api',
              title: 'Anthropic API key',
              sub: 'Pay per token. Best for shared / hosted workspaces.',
              icon: <ClaudeMark size={14} />,
            },
            {
              value: 'local',
              title: 'Local LLM',
              sub: 'Point at an Ollama / llama.cpp / LM Studio endpoint.',
            },
          ]}
        />
      </Field>

      {provider === 'api' && (
        <Field
          label="ANTHROPIC_API_KEY"
          hint={
            apiKeyStored
              ? 'A key is stored in the OS keychain. Type a new value to replace it, or Forget to remove.'
              : 'Stored in your OS keychain — never written to disk in plaintext.'
          }
        >
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <TextInput
                placeholder={apiKeyStored ? '••••••••••••••••' : 'sk-ant-…'}
                type="password"
                value={apiKeyDraft}
                onChange={(e) => setApiKeyDraft(e.target.value)}
              />
              <Button
                size="sm"
                onClick={handleSaveKey}
                disabled={apiKeyBusy || !apiKeyDraft.trim()}
              >
                {apiKeyBusy ? 'Saving…' : 'Save'}
              </Button>
              {apiKeyStored && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleForgetKey}
                  disabled={apiKeyBusy}
                >
                  Forget
                </Button>
              )}
            </div>
            {apiKeyStored && (
              <span className="flex items-center gap-1.5 text-2xs text-ok">
                <Check size={10} strokeWidth={2.4} />
                Key stored in keychain
              </span>
            )}
          </div>
        </Field>
      )}

      {provider === 'local' && (
        <>
          <Field label="Endpoint URL">
            <TextInput placeholder="http://localhost:11434/v1" />
          </Field>
          <Field label="Model">
            <Select
              options={[
                { value: 'llama3.1:70b', label: 'llama3.1:70b' },
                { value: 'qwen2.5:32b', label: 'qwen2.5:32b' },
                { value: 'custom', label: 'Custom…' },
              ]}
            />
          </Field>
        </>
      )}

      {provider !== 'local' && (
        <Field label="Default model" hint="The model your agents use unless they override it in their frontmatter.">
          <ModelPicker
            value={model}
            onChange={setModel}
            favorites={favorites}
            onToggleFavorite={toggleFavorite}
          />
        </Field>
      )}

      <Field
        label="Connection status"
        hint="Sends a one-token prompt with no tools to verify the SDK can reach Anthropic with your current auth."
      >
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleSelfTest}
              disabled={testing}
            >
              {testing ? 'Testing…' : 'Test connection'}
            </Button>
            {testResult && (
              <span
                className={cn(
                  'inline-flex items-center gap-1.5 text-2xs font-mono uppercase tracking-code',
                  testResult.ok ? 'text-ok' : 'text-err',
                )}
              >
                <span
                  className={cn(
                    'h-1.5 w-1.5 rounded-full',
                    testResult.ok ? 'bg-ok' : 'bg-err',
                  )}
                />
                {testResult.ok ? 'connected' : 'failed'}
                {testResult.apiKeySource && ` · auth: ${testResult.apiKeySource}`}
                {testResult.durationMs != null &&
                  ` · ${(testResult.durationMs / 1000).toFixed(1)}s`}
              </span>
            )}
          </div>
          {testResult && !testResult.ok && (
            <div className="rounded-md border border-err/40 bg-err/10 px-3 py-2 text-xs text-ink-muted">
              {testResult.message}
            </div>
          )}
          {testResult?.ok && testResult.tokensIn != null && (
            <div className="font-mono text-2xs text-ink-subtle">
              {testResult.tokensIn} in · {testResult.tokensOut} out
            </div>
          )}
        </div>
      </Field>
    </Section>
  );
}

function WorkspaceSection() {
  const settings = useSettings();
  const ws = settings.workspace;

  return (
    <Section
      title="Workspace"
      lede="Where flowstate looks for your agents and tool definitions on this machine."
    >
      <Field
        label="Agents directory"
        hint="A folder of .md and .yaml agent files. Subfolders become linked sections."
      >
        <PathInput
          value={ws.agentsDir ?? ''}
          onChange={(v) => updateSettings({ workspace: { agentsDir: v } })}
        />
      </Field>

      <Field label="Tools registry directory" hint="One .yaml or .md per tool. See docs.">
        <PathInput
          value={ws.toolsDir ?? ''}
          onChange={(v) => updateSettings({ workspace: { toolsDir: v } })}
        />
      </Field>

      <Field label="Run history" hint="Where each run's append-only journal is written.">
        <PathInput
          value={ws.runsDir ?? ''}
          onChange={(v) => updateSettings({ workspace: { runsDir: v } })}
        />
      </Field>

      <Field label="Auto-reload">
        <Toggle
          checked={ws.autoReload ?? true}
          onChange={(v) => updateSettings({ workspace: { autoReload: v } })}
          label="Watch the agents directory and reload on save"
        />
      </Field>
    </Section>
  );
}

function ToolsSection() {
  return (
    <Section
      title="Tools"
      lede="Global defaults applied to every tool unless an individual tool overrides them."
    >
      <Field label="Sandbox CLI calls">
        <Toggle defaultChecked label="Run shell + CLI tools inside an OS sandbox (firejail / sandbox-exec)" />
      </Field>

      <Field label="Default timeout" hint="Per tool invocation. Individual tools can shorten this.">
        <div className="flex items-center gap-2">
          <TextInput defaultValue="30" type="number" className="max-w-[100px]" />
          <span className="text-sm text-ink-muted">seconds</span>
        </div>
      </Field>

      <Field label="MCP server pool" hint="Keep most-recently-used MCP servers warm across runs.">
        <div className="flex items-center gap-2">
          <TextInput defaultValue="10" type="number" className="max-w-[100px]" />
          <span className="text-sm text-ink-muted">servers · evict cold after</span>
          <TextInput defaultValue="5" type="number" className="max-w-[80px]" />
          <span className="text-sm text-ink-muted">minutes idle</span>
        </div>
      </Field>

      <Field label="Output truncation" hint="Cap tool stdout sent to the agent's context.">
        <div className="flex items-center gap-2">
          <TextInput defaultValue="4000" type="number" className="max-w-[120px]" />
          <span className="text-sm text-ink-muted">tokens · agent gets a `read_more(offset)` tool</span>
        </div>
      </Field>

      <Field label="Composio (optional)">
        <Toggle label="Enable Composio adapter for OAuth-heavy integrations" />
      </Field>
    </Section>
  );
}

function PrivacySection() {
  return (
    <Section
      title="Privacy"
      lede="flowstate is local-first. Nothing leaves your machine unless a process explicitly reaches out."
    >
      <Card tone="ok">
        <div className="flex items-start gap-3">
          <Check size={14} className="mt-0.5 shrink-0 text-ok" />
          <div>
            <p className="text-sm font-medium text-ink">No telemetry. Ever.</p>
            <p className="mt-1 text-xs leading-relaxed text-ink-muted">
              We do not collect usage statistics, error reports, or any data about your agents
              or runs. The settings below are off by default and stay off unless you explicitly
              opt in.
            </p>
          </div>
        </div>
      </Card>

      <Field label="Anonymous error reports">
        <Toggle label="Send crash reports (no agent content, no identifiers)" />
      </Field>

      <Field label="Anonymous usage stats">
        <Toggle label="Help us understand which views are used most" />
      </Field>

      <Field label="Auto-update check">
        <Toggle defaultChecked label="Check anthropic.com once a week for new versions" />
      </Field>

      <Field label="Credential storage">
        <div className="flex items-start gap-3 rounded-md border border-stone bg-paper-sunken px-3 py-2.5 text-xs">
          <span>API keys and OAuth tokens are stored in your OS keychain (Keychain on macOS, Credential Manager on Windows, libsecret on Linux). They never appear in plaintext on disk.</span>
        </div>
      </Field>
    </Section>
  );
}

function AppearanceSection() {
  return (
    <Section title="Appearance" lede="Visual preferences. flowstate ships light-first; dark mode is reserved for the next minor release.">
      <Field label="Theme">
        <RadioGroup
          value="light"
          onChange={() => {}}
          options={[
            { value: 'light', title: 'Light (Cohere default)', sub: 'Pure white with cool gray borders.' },
            { value: 'dark', title: 'Dark', sub: 'Coming soon.', disabled: true },
            { value: 'system', title: 'Match system', sub: 'Coming soon.', disabled: true },
          ]}
        />
      </Field>

      <Field label="Density">
        <RadioGroup
          value="comfortable"
          onChange={() => {}}
          options={[
            { value: 'comfortable', title: 'Comfortable', sub: 'Editorial spacing, generous whitespace.' },
            { value: 'compact', title: 'Compact', sub: 'Tighter for power users.' },
          ]}
        />
      </Field>

      <Field label="Editor font" hint="Used in the source view + edit mode.">
        <Select
          defaultValue="jetbrains-mono"
          options={[
            { value: 'jetbrains-mono', label: 'JetBrains Mono' },
            { value: 'geist-mono', label: 'Geist Mono' },
            { value: 'sf-mono', label: 'SF Mono' },
            { value: 'cascadia', label: 'Cascadia Code' },
          ]}
        />
      </Field>
    </Section>
  );
}

function ShortcutsSection() {
  const shortcuts = [
    { key: '⌘ K', desc: 'Open the floating composer from anywhere' },
    { key: '⌘ ↵', desc: 'Start the active composer' },
    { key: '⌘ 1', desc: 'Home' },
    { key: '⌘ 2', desc: 'Agents' },
    { key: '⌘ 3', desc: 'Tools' },
    { key: '⌘ 4', desc: 'Flow' },
    { key: '⌘ 5', desc: 'Runs' },
    { key: '⌘ ,', desc: 'Settings (this view)' },
    { key: '⌘ E', desc: 'Toggle Edit mode on the active source file' },
    { key: '⌘ S', desc: 'Save the current edit' },
    { key: '⌘ ⇧ R', desc: 'Re-run the last run' },
    { key: '⌘ /', desc: 'Toggle line comment' },
  ];
  return (
    <Section title="Keyboard shortcuts" lede="Defaults below; most are remappable in a future release.">
      <div className="overflow-hidden rounded-xl border border-stone-subtle">
        <table className="w-full">
          <tbody>
            {shortcuts.map((s, i) => (
              <tr key={s.key} className={i > 0 ? 'border-t border-stone-subtle' : ''}>
                <td className="bg-paper-sunken px-4 py-2.5">
                  <kbd className="rounded border border-stone bg-paper px-2 py-0.5 font-mono text-2xs text-ink">
                    {s.key}
                  </kbd>
                </td>
                <td className="px-4 py-2.5 text-sm text-ink">{s.desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function AboutSection() {
  return (
    <Section title="About" lede="">
      <div className="flex items-start gap-5 rounded-xl border border-stone-subtle bg-paper-raised p-6">
        <FlowstateMark size={56} />
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-2xl text-ink">
            <span className="italic font-light">flow</span>state
          </h2>
          <p className="mt-1 text-xs text-ink-subtle">v0.1.0 · early preview</p>
          <p className="mt-3 max-w-md text-sm leading-relaxed text-ink-muted">
            Talk to your agents like you talk to a person. A markdown-driven process automation
            system that uses the Claude Agent SDK with whatever credentials you already have.
          </p>
          <div className="mt-5 flex items-center gap-1">
            <LinkButton>Documentation</LinkButton>
            <LinkButton>Changelog</LinkButton>
            <LinkButton>GitHub</LinkButton>
            <LinkButton>License</LinkButton>
          </div>
        </div>
      </div>

      <Field label="Built with">
        <div className="flex flex-wrap gap-1">
          {['Electron 33', 'React 18', 'Vite 5', 'Tailwind 4', 'Claude Agent SDK', 'simple-icons', 'React Flow', 'CodeMirror 6'].map((t) => (
            <span
              key={t}
              className="rounded-sm border border-stone-subtle bg-paper-sunken px-2 py-0.5 font-mono text-2xs text-ink-muted"
            >
              {t}
            </span>
          ))}
        </div>
      </Field>
    </Section>
  );
}

// ─── Reusable form primitives ──────────────────────────────────────────────

function Section({
  title,
  lede,
  children,
}: {
  title: string;
  lede?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-6">
      <header className="border-b border-stone-subtle pb-5">
        <h1 className="font-display text-3xl text-ink">{title}</h1>
        {lede && <p className="mt-2 max-w-xl text-sm leading-relaxed text-ink-muted">{lede}</p>}
      </header>
      {children}
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-12 gap-6 border-b border-stone-subtle pb-5 last:border-b-0">
      <div className="col-span-4 pt-2">
        <p className="text-sm font-medium text-ink">{label}</p>
        {hint && <p className="mt-1 text-xs leading-relaxed text-ink-subtle">{hint}</p>}
      </div>
      <div className="col-span-8">{children}</div>
    </div>
  );
}

function TextInput({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        'w-full rounded-md border border-stone bg-paper px-3 py-1.5 text-sm text-ink placeholder:text-ink-subtle',
        'focus:border-cohere-purple-focus focus:outline-none',
        className,
      )}
    />
  );
}

function PathInput({
  value,
  defaultValue,
  onChange,
}: {
  value?: string;
  defaultValue?: string;
  onChange?: (v: string) => void;
}) {
  // Controlled when `value` + `onChange` are supplied; uncontrolled (defaultValue)
  // otherwise. Lets the same primitive serve both wired sections and stubs.
  const isControlled = value != null && onChange != null;
  return (
    <div className="flex items-center gap-2">
      <TextInput
        {...(isControlled
          ? { value, onChange: (e) => onChange!(e.target.value) }
          : { defaultValue })}
        className="font-mono text-xs"
      />
      <Button variant="outline" size="sm" className="shrink-0 text-xs">choose…</Button>
    </div>
  );
}

function Select({
  options,
  defaultValue,
}: {
  options: { value: string; label: string }[];
  defaultValue?: string;
}) {
  return (
    <select
      defaultValue={defaultValue}
      className="w-full appearance-none rounded-md border border-stone bg-paper px-3 py-1.5 pr-8 text-sm text-ink focus:border-cohere-purple-focus focus:outline-none"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function Toggle({
  label,
  checked,
  defaultChecked,
  onChange,
}: {
  label?: string;
  checked?: boolean;
  defaultChecked?: boolean;
  onChange?: (v: boolean) => void;
}) {
  const isControlled = checked != null && onChange != null;
  return (
    <label className="flex cursor-pointer items-center gap-3">
      <input
        type="checkbox"
        {...(isControlled
          ? { checked, onChange: (e) => onChange!(e.target.checked) }
          : { defaultChecked })}
        className="peer sr-only"
      />
      <span className="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full bg-stone transition-colors peer-checked:bg-ink">
        <span className="absolute left-0.5 h-4 w-4 rounded-full bg-paper transition-transform peer-checked:translate-x-4" />
      </span>
      {label && <span className="text-sm text-ink">{label}</span>}
    </label>
  );
}

function RadioGroup({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: {
    value: string;
    title: string;
    sub?: string;
    disabled?: boolean;
    icon?: React.ReactNode;
  }[];
}) {
  return (
    <div className="space-y-2">
      {options.map((opt) => {
        const isSelected = value === opt.value;
        return (
          <button
            key={opt.value}
            disabled={opt.disabled}
            onClick={() => !opt.disabled && onChange(opt.value)}
            className={cn(
              'flex w-full items-start gap-3 rounded-md border p-3 text-left transition-all',
              isSelected
                ? 'border-ink bg-paper-sunken'
                : 'border-stone bg-paper hover:border-stone-strong',
              opt.disabled && 'cursor-not-allowed opacity-50',
            )}
          >
            <span
              className={cn(
                'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
                isSelected ? 'border-ink bg-ink' : 'border-stone-strong bg-paper',
              )}
            >
              {isSelected && <span className="h-1.5 w-1.5 rounded-full bg-paper" />}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                {opt.icon && <span className="shrink-0">{opt.icon}</span>}
                <span className="text-sm text-ink">{opt.title}</span>
              </div>
              {opt.sub && <div className="mt-0.5 text-xs text-ink-muted">{opt.sub}</div>}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function Card({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'ok' | 'warn';
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'rounded-xl border p-4',
        tone === 'ok' && 'border-stone bg-paper-sunken',
        tone === 'warn' && 'border-stone bg-paper-sunken',
        tone === 'neutral' && 'border-stone-subtle bg-paper-raised',
      )}
    >
      {children}
    </div>
  );
}

function LinkButton({ children }: { children: React.ReactNode }) {
  return (
    <button className="group flex items-center gap-1 rounded-md px-2 py-1 text-xs text-ink-muted transition-colors hover:text-accent-500">
      {children}
      <ChevronRight size={11} className="transition-transform group-hover:translate-x-0.5" />
    </button>
  );
}
