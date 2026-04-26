import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, FileText, Plus } from 'lucide-react';
import { cn } from '@/lib/cn';
import { FIXTURE_TOOLS } from '@/components/tools/fixtures';
import { ToolIcon } from '@/components/tools/tool-icon';
import { kindLabel } from '@/components/tools/tool-meta';

type TriggerKind = 'manual' | 'webhook' | 'cron' | 'watch' | 'event';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Called after a successful save with the new file's relative path. */
  onCreated?: (relPath: string) => void;
}

/**
 * Modal form for authoring a new agent. Generates a YAML frontmatter +
 * markdown body file and writes it to disk through the main process. After
 * vite HMR reloads, the new agent appears in the Agents list automatically.
 */
export function CreateAgentModal({ open, onClose, onCreated }: Props) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [triggerKind, setTriggerKind] = useState<TriggerKind>('manual');
  const [webhookPath, setWebhookPath] = useState('/');
  const [cronSchedule, setCronSchedule] = useState('0 9 * * MON');
  const [watchSource, setWatchSource] = useState('');
  const [eventName, setEventName] = useState('');
  const [selectedTools, setSelectedTools] = useState<string[]>([]);
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const id = useMemo(() => kebabCase(name), [name]);
  const canSubmit = name.trim().length > 0 && id.length > 0 && !saving;

  // Reset form on close
  useEffect(() => {
    if (!open) {
      setTimeout(() => {
        setName('');
        setDescription('');
        setTriggerKind('manual');
        setWebhookPath('/');
        setCronSchedule('0 9 * * MON');
        setWatchSource('');
        setEventName('');
        setSelectedTools([]);
        setBody('');
        setErr(null);
      }, 200);
    }
  }, [open]);

  // Esc closes
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const toggleTool = (ref: string) =>
    setSelectedTools((s) => (s.includes(ref) ? s.filter((t) => t !== ref) : [...s, ref]));

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setErr(null);
    setSaving(true);

    // Preload changes don't HMR — the IPC handlers added in Stage 2 only
    // exist after Electron is restarted. Detect that explicitly so the
    // user gets actionable guidance instead of a silent no-op.
    if (typeof window.flowstate?.writeAgentFile !== 'function') {
      console.error(
        '[create-agent] window.flowstate.writeAgentFile is undefined — restart `pnpm dev` to pick up new preload IPC handlers',
      );
      setErr(
        'Preload IPC not loaded. Restart `pnpm dev` (the Electron process needs to relaunch to pick up new preload handlers).',
      );
      setSaving(false);
      return;
    }

    try {
      const content = serializeAgent({
        id,
        name: name.trim(),
        description: description.trim() || undefined,
        triggerKind,
        webhookPath,
        cronSchedule,
        watchSource,
        eventName,
        tools: selectedTools,
        body: body.trim() || `## Goal\n\nDescribe what this agent should accomplish.`,
      });
      const relPath = `./${id}.md`;
      console.log('[create-agent] writing', relPath, '\n', content);
      const result = await window.flowstate.writeAgentFile(relPath, content);
      console.log('[create-agent] saved', result);
      onCreated?.(relPath);
      onClose();
    } catch (e) {
      console.error('[create-agent] save failed', e);
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-40 bg-ink/30 backdrop-blur-sm"
            onClick={onClose}
          />

          {/* Modal */}
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
            <motion.div
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.98 }}
              transition={{ duration: 0.25, ease: [0.2, 0.8, 0.2, 1] }}
              className="flex h-[640px] max-h-[88vh] w-[760px] max-w-[92vw] flex-col overflow-hidden rounded-xl border border-stone bg-paper-raised shadow-lift"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex shrink-0 items-center justify-between border-b border-stone-subtle px-6 py-4">
                <div className="flex items-center gap-2">
                  <FileText size={14} className="text-ink-muted" />
                  <span className="font-mono text-2xs uppercase tracking-code-wide text-ink-subtle">
                    NEW AGENT
                  </span>
                </div>
                <button
                  onClick={onClose}
                  className="rounded-md p-1 text-ink-muted hover:bg-paper-sunken hover:text-ink"
                >
                  <X size={14} />
                </button>
              </div>

              {/* Sticky error banner — visible no matter how far the user scrolled */}
              {err && (
                <div className="shrink-0 border-b border-err/40 bg-err/10 px-6 py-3">
                  <div className="flex items-start gap-2 text-sm text-err">
                    <span className="mt-0.5 font-mono text-2xs uppercase tracking-code">error</span>
                    <span className="flex-1">{err}</span>
                    <button
                      onClick={() => setErr(null)}
                      className="rounded p-0.5 hover:bg-err/20"
                      title="Dismiss"
                    >
                      <X size={11} />
                    </button>
                  </div>
                </div>
              )}

              {/* Body — scrollable form */}
              <div className="flex-1 overflow-y-auto px-7 py-6">
                <div className="space-y-6">
                  {/* Name + id preview */}
                  <FormRow label="Name" hint="What you'll see in the agent list.">
                    <input
                      autoFocus
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Refund handler"
                      className="w-full rounded-md border border-stone bg-paper px-3 py-1.5 text-sm text-ink placeholder:text-ink-subtle focus:border-cohere-purple-focus focus:outline-none"
                    />
                    {id && (
                      <p className="mt-1.5 font-mono text-2xs text-ink-subtle">
                        will save as <span className="text-ink">./{id}.md</span>
                      </p>
                    )}
                  </FormRow>

                  <FormRow label="Description" hint="One line summarizing what the agent does.">
                    <input
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="Process customer refund requests within 30 days."
                      className="w-full rounded-md border border-stone bg-paper px-3 py-1.5 text-sm text-ink placeholder:text-ink-subtle focus:border-cohere-purple-focus focus:outline-none"
                    />
                  </FormRow>

                  {/* Trigger */}
                  <FormRow label="Trigger" hint="What kicks the agent off.">
                    <div className="flex flex-wrap gap-1">
                      {(['manual', 'webhook', 'cron', 'watch', 'event'] as TriggerKind[]).map((k) => (
                        <button
                          key={k}
                          onClick={() => setTriggerKind(k)}
                          className={cn(
                            'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                            triggerKind === k
                              ? 'border-ink bg-ink text-paper'
                              : 'border-stone bg-paper text-ink-muted hover:border-ink hover:text-ink',
                          )}
                        >
                          {k}
                        </button>
                      ))}
                    </div>
                    <div className="mt-3">
                      {triggerKind === 'webhook' && (
                        <input
                          value={webhookPath}
                          onChange={(e) => setWebhookPath(e.target.value)}
                          placeholder="/refund"
                          className="w-full rounded-md border border-stone bg-paper px-3 py-1.5 font-mono text-sm text-ink placeholder:text-ink-subtle focus:border-cohere-purple-focus focus:outline-none"
                        />
                      )}
                      {triggerKind === 'cron' && (
                        <input
                          value={cronSchedule}
                          onChange={(e) => setCronSchedule(e.target.value)}
                          placeholder="0 9 * * MON"
                          className="w-full rounded-md border border-stone bg-paper px-3 py-1.5 font-mono text-sm text-ink placeholder:text-ink-subtle focus:border-cohere-purple-focus focus:outline-none"
                        />
                      )}
                      {triggerKind === 'watch' && (
                        <input
                          value={watchSource}
                          onChange={(e) => setWatchSource(e.target.value)}
                          placeholder="fs:./inbox"
                          className="w-full rounded-md border border-stone bg-paper px-3 py-1.5 font-mono text-sm text-ink placeholder:text-ink-subtle focus:border-cohere-purple-focus focus:outline-none"
                        />
                      )}
                      {triggerKind === 'event' && (
                        <input
                          value={eventName}
                          onChange={(e) => setEventName(e.target.value)}
                          placeholder="refund.completed"
                          className="w-full rounded-md border border-stone bg-paper px-3 py-1.5 font-mono text-sm text-ink placeholder:text-ink-subtle focus:border-cohere-purple-focus focus:outline-none"
                        />
                      )}
                    </div>
                  </FormRow>

                  {/* Tools */}
                  <FormRow
                    label="Tools"
                    hint={`${selectedTools.length} selected · click to add`}
                  >
                    <div className="grid grid-cols-2 gap-1.5">
                      {FIXTURE_TOOLS.map((tool) => {
                        const ref = `${tool.kind}:${tool.id}`;
                        const isSelected = selectedTools.includes(ref);
                        return (
                          <button
                            key={tool.id}
                            onClick={() => toggleTool(ref)}
                            className={cn(
                              'group flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-left transition-all',
                              isSelected
                                ? 'border-ink bg-paper-sunken'
                                : 'border-stone-subtle bg-paper hover:border-stone-strong',
                            )}
                          >
                            <ToolIcon name={tool.icon} size={14} />
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-sm text-ink">{tool.name}</div>
                              <div className="font-mono text-2xs uppercase tracking-code text-ink-subtle">
                                {kindLabel(tool.kind)}
                              </div>
                            </div>
                            {isSelected && (
                              <span className="h-1.5 w-1.5 rounded-full bg-accent-500" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </FormRow>

                  {/* Body */}
                  <FormRow
                    label="Goal & steps"
                    hint="Markdown. Becomes the agent's body — describe what it should do."
                  >
                    <textarea
                      value={body}
                      onChange={(e) => setBody(e.target.value)}
                      rows={8}
                      placeholder={DEFAULT_BODY_PLACEHOLDER}
                      className="w-full rounded-md border border-stone bg-paper px-3 py-2 font-sans text-sm leading-relaxed text-ink placeholder:text-ink-subtle focus:border-cohere-purple-focus focus:outline-none"
                    />
                  </FormRow>

                </div>
              </div>

              {/* Footer */}
              <div className="flex shrink-0 items-center justify-between border-t border-stone-subtle bg-paper-sunken px-6 py-3">
                <span className="font-mono text-2xs uppercase tracking-code text-ink-subtle">
                  {selectedTools.length} tools · trigger: {triggerKind}
                </span>
                <div className="flex items-center gap-2">
                  <button onClick={onClose} className="btn-ghost text-xs">
                    cancel
                  </button>
                  <button
                    onClick={handleSubmit}
                    disabled={!canSubmit}
                    className={cn(
                      'btn-dark text-xs',
                      !canSubmit && 'cursor-not-allowed opacity-50',
                    )}
                  >
                    <Plus size={11} />
                    {saving ? 'creating…' : 'create agent'}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}

function FormRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <label className="text-sm font-medium text-ink">{label}</label>
        {hint && <span className="font-mono text-2xs text-ink-subtle">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function kebabCase(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

interface SerializeOpts {
  id: string;
  name: string;
  description?: string;
  triggerKind: TriggerKind;
  webhookPath: string;
  cronSchedule: string;
  watchSource: string;
  eventName: string;
  tools: string[];
  body: string;
}

function serializeAgent(o: SerializeOpts): string {
  const lines: string[] = ['---'];
  lines.push(`id: ${o.id}`);
  lines.push(`name: ${yamlString(o.name)}`);
  if (o.description) lines.push(`description: ${yamlString(o.description)}`);
  lines.push('');
  lines.push('trigger:');
  lines.push(`  kind: ${o.triggerKind}`);
  switch (o.triggerKind) {
    case 'webhook':
      lines.push('  config:');
      lines.push(`    path: ${yamlString(o.webhookPath || '/')}`);
      break;
    case 'cron':
      lines.push('  config:');
      lines.push(`    schedule: ${yamlString(o.cronSchedule)}`);
      break;
    case 'watch':
      lines.push('  config:');
      lines.push(`    source: ${yamlString(o.watchSource || 'fs:./')}`);
      break;
    case 'event':
      lines.push('  config:');
      lines.push(`    name: ${yamlString(o.eventName || 'event.name')}`);
      break;
  }
  if (o.tools.length > 0) {
    lines.push('');
    lines.push('tools:');
    for (const t of o.tools) lines.push(`  - ${t}`);
  }
  lines.push('---');
  lines.push('');
  lines.push(o.body);
  lines.push('');
  return lines.join('\n');
}

/** Quote a YAML string when it contains chars that need escaping. */
function yamlString(s: string): string {
  if (/^[a-zA-Z0-9_./-]+$/.test(s) && !s.match(/^[0-9]/)) return s;
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

const DEFAULT_BODY_PLACEHOLDER = `## Goal

Describe in plain English what this agent should accomplish.

## Steps

### 1. First step
What to do first.

### 2. Second step
What to do next.

## On failure
What to do when something breaks.`;
