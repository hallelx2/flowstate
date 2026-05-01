import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Plus, Pencil, Trash2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import {
  createWorkspace,
  deleteWorkspace,
  renameWorkspace,
  switchWorkspace,
  useWorkspaces,
} from '@/lib/workspace-store';

/**
 * Title-bar workspace switcher.
 *
 * Replaces the static "/ untitled workspace" label. Click to open a
 * dropdown of every workspace (most-recent first), pick one to switch,
 * or use the footer to create / rename / delete.
 *
 * Edits are inline — no modals — to keep the title bar from feeling like
 * a settings page. Dangerous actions (delete) ask once via window.confirm.
 */
export function WorkspaceSwitcher() {
  const { list, active, hydrated } = useWorkspaces();
  const [open, setOpen] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [creating, setCreating] = useState(false);
  const [createValue, setCreateValue] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);

  // Click-outside to close. Pointerdown beats click for fewer surprises
  // (esp. when a button inside the menu does its own preventDefault).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [open]);

  // Reset transient inline-edit state every time the menu closes.
  useEffect(() => {
    if (!open) {
      setRenamingId(null);
      setRenameValue('');
      setCreating(false);
      setCreateValue('');
    }
  }, [open]);

  if (!hydrated) {
    return (
      <span className="font-mono text-2xs uppercase tracking-code text-ink-subtle">
        / loading…
      </span>
    );
  }

  const label = active?.name ?? 'no workspace';

  async function handleSwitch(id: string) {
    if (id === active?.id) {
      setOpen(false);
      return;
    }
    await switchWorkspace(id);
    setOpen(false);
  }

  async function handleCreate() {
    const name = createValue.trim();
    if (!name) return;
    const ws = await createWorkspace({
      name,
      provider: 'subscription',
      model: 'claude-opus-4-7',
      color: '#9b60aa',
    });
    await switchWorkspace(ws.id);
    setOpen(false);
  }

  async function handleRename(id: string) {
    const name = renameValue.trim();
    if (!name) {
      setRenamingId(null);
      return;
    }
    await renameWorkspace(id, name);
    setRenamingId(null);
  }

  async function handleDelete(id: string, name: string) {
    if (list.length <= 1) {
      window.alert('You need at least one workspace.');
      return;
    }
    if (!window.confirm(`Delete workspace "${name}"? This can't be undone.`)) return;
    try {
      await deleteWorkspace(id);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div ref={rootRef} className="app-no-drag relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 rounded px-1 py-0.5 font-mono text-2xs uppercase tracking-code text-ink-subtle hover:bg-stone-subtle hover:text-ink"
      >
        <span>/ {label}</span>
        <ChevronDown size={11} strokeWidth={1.8} className={cn('transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-72 overflow-hidden rounded-lg border border-stone-subtle bg-paper shadow-lg">
          <div className="border-b border-stone-subtle px-3 py-2">
            <div className="font-mono text-2xs uppercase tracking-code text-ink-subtle">
              Workspaces · {list.length}
            </div>
          </div>

          <ul className="max-h-72 overflow-y-auto py-1">
            {list.map((ws) => {
              const isActive = ws.id === active?.id;
              const isRenaming = ws.id === renamingId;
              return (
                <li key={ws.id} className="px-1">
                  {isRenaming ? (
                    <div className="flex items-center gap-2 px-2 py-1.5">
                      <input
                        autoFocus
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void handleRename(ws.id);
                          if (e.key === 'Escape') setRenamingId(null);
                        }}
                        onBlur={() => void handleRename(ws.id)}
                        className="w-full rounded border border-focus-purple bg-paper px-2 py-1 text-sm text-ink outline-none"
                      />
                    </div>
                  ) : (
                    <div
                      className={cn(
                        'group flex items-center gap-2 rounded px-2 py-1.5 hover:bg-paper-sunken',
                        isActive && 'bg-paper-sunken',
                      )}
                    >
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: ws.color ?? '#9b60aa' }}
                      />
                      <button
                        onClick={() => void handleSwitch(ws.id)}
                        className="flex-1 truncate text-left text-sm text-ink"
                      >
                        {ws.name}
                      </button>
                      {isActive && <Check size={13} strokeWidth={2} className="text-ink-subtle" />}
                      <button
                        onClick={() => {
                          setRenamingId(ws.id);
                          setRenameValue(ws.name);
                        }}
                        title="Rename"
                        className="rounded p-1 text-ink-subtle opacity-0 hover:bg-stone-subtle hover:text-ink group-hover:opacity-100"
                      >
                        <Pencil size={11} strokeWidth={1.8} />
                      </button>
                      <button
                        onClick={() => void handleDelete(ws.id, ws.name)}
                        title="Delete"
                        className="rounded p-1 text-ink-subtle opacity-0 hover:bg-stone-subtle hover:text-ink group-hover:opacity-100"
                      >
                        <Trash2 size={11} strokeWidth={1.8} />
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          <div className="border-t border-stone-subtle p-1">
            {creating ? (
              <div className="flex items-center gap-2 px-2 py-1.5">
                <input
                  autoFocus
                  placeholder="New workspace name…"
                  value={createValue}
                  onChange={(e) => setCreateValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleCreate();
                    if (e.key === 'Escape') setCreating(false);
                  }}
                  onBlur={() => {
                    if (!createValue.trim()) setCreating(false);
                  }}
                  className="w-full rounded border border-focus-purple bg-paper px-2 py-1 text-sm text-ink outline-none"
                />
              </div>
            ) : (
              <button
                onClick={() => setCreating(true)}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-ink-subtle hover:bg-paper-sunken hover:text-ink"
              >
                <Plus size={13} strokeWidth={1.8} />
                New workspace
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
