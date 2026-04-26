import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, Star, ChevronDown, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '@/lib/cn';
import { ClaudeMark } from '@/components/brand/claude-mark';

/**
 * The Claude model lineup.
 *
 * Keep in sync with what the SDK accepts as the `model` option.
 * `id` matches Anthropic's canonical model ids; `shortcut` is the
 * 1-based picker shortcut (Ctrl/Cmd + N).
 */
export interface ClaudeModel {
  id: string;
  name: string;
  family: 'Opus' | 'Sonnet' | 'Haiku';
  blurb: string;
  shortcut: string;
}

export const CLAUDE_MODELS: ClaudeModel[] = [
  { id: 'claude-opus-4-7', name: 'Claude Opus 4.7', family: 'Opus', blurb: 'Highest reasoning · long-form work', shortcut: 'Ctrl+1' },
  { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', family: 'Opus', blurb: 'Previous Opus, still a heavyweight', shortcut: 'Ctrl+2' },
  { id: 'claude-opus-4-5', name: 'Claude Opus 4.5', family: 'Opus', blurb: 'Stable workhorse', shortcut: 'Ctrl+3' },
  { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', family: 'Sonnet', blurb: 'Balanced — best price / latency', shortcut: 'Ctrl+4' },
  { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', family: 'Haiku', blurb: 'Fastest · cheapest · everyday tasks', shortcut: 'Ctrl+5' },
];

interface Props {
  value: string;
  onChange: (id: string) => void;
  /** Models marked as favorites — gold stars in the picker. */
  favorites?: string[];
  onToggleFavorite?: (id: string) => void;
}

export function ModelPicker({ value, onChange, favorites = [], onToggleFavorite }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const selected = CLAUDE_MODELS.find((m) => m.id === value) ?? CLAUDE_MODELS[0]!;

  // Click outside closes the popover
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  // Esc closes
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Auto-focus search when opening
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 0);
    } else {
      setQuery('');
    }
  }, [open]);

  const filtered = useMemo(() => {
    if (!query.trim()) return CLAUDE_MODELS;
    const q = query.toLowerCase();
    return CLAUDE_MODELS.filter(
      (m) => m.name.toLowerCase().includes(q) || m.blurb.toLowerCase().includes(q),
    );
  }, [query]);

  const handleSelect = (id: string) => {
    onChange(id);
    setOpen(false);
  };

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex w-full items-center gap-2.5 rounded-md border bg-paper px-3 py-1.5 text-left text-sm text-ink transition-colors',
          open
            ? 'border-cohere-purple-focus'
            : 'border-stone hover:border-stone-strong',
        )}
      >
        <ClaudeMark size={14} />
        <span className="flex-1 truncate">{selected.name}</span>
        <span className="font-mono text-2xs uppercase tracking-code text-ink-subtle">
          {selected.family.toLowerCase()}
        </span>
        <ChevronDown
          size={13}
          className={cn(
            'text-ink-subtle transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>

      {/* Popover */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.15, ease: [0.2, 0.8, 0.2, 1] }}
            className="absolute left-0 right-0 top-[calc(100%+4px)] z-50 origin-top overflow-hidden rounded-xl border border-stone bg-paper-raised shadow-lift"
          >
            {/* Header */}
            <div className="flex items-center gap-2 border-b border-stone-subtle px-4 py-3">
              <ClaudeMark size={20} />
              <span className="font-display text-base text-ink">Claude</span>
            </div>

            {/* Search */}
            <div className="border-b border-stone-subtle px-3 py-2">
              <div className="flex items-center gap-2 rounded-md border border-stone bg-paper px-3 py-1.5 focus-within:border-cohere-purple-focus">
                <Search size={13} className="text-ink-subtle" />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search models…"
                  className="flex-1 bg-transparent text-sm text-ink placeholder:text-ink-subtle focus:outline-none"
                />
              </div>
            </div>

            {/* List */}
            <ul className="max-h-[280px] overflow-y-auto py-1">
              {filtered.length === 0 ? (
                <li className="px-4 py-6 text-center text-xs text-ink-subtle">No models match.</li>
              ) : (
                filtered.map((model) => {
                  const isSelected = model.id === selected.id;
                  const isFavorite = favorites.includes(model.id);
                  return (
                    <li key={model.id}>
                      <button
                        onClick={() => handleSelect(model.id)}
                        className={cn(
                          'group flex w-full items-center gap-3 px-3 py-2 text-left transition-colors',
                          isSelected ? 'bg-paper-sunken' : 'hover:bg-paper-sunken/60',
                        )}
                      >
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onToggleFavorite?.(model.id);
                          }}
                          className="rounded p-0.5 text-ink-subtle hover:bg-paper hover:text-warn"
                          title={isFavorite ? 'Unfavorite' : 'Favorite'}
                        >
                          <Star
                            size={13}
                            className={cn(
                              'transition-colors',
                              isFavorite && 'fill-warn text-warn',
                            )}
                          />
                        </button>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-ink">{model.name}</span>
                            {isSelected && <Check size={11} className="text-accent-500" />}
                          </div>
                          <p className="mt-0.5 truncate text-2xs text-ink-subtle">{model.blurb}</p>
                        </div>
                        <kbd className="shrink-0 rounded border border-stone bg-paper px-1.5 py-0.5 font-mono text-2xs text-ink-subtle">
                          {model.shortcut}
                        </kbd>
                      </button>
                    </li>
                  );
                })
              )}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
