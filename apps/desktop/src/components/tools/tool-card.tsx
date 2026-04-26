import type { ToolManifest } from '@flowstate/core';
import { cn } from '@/lib/cn';
import { ToolIcon } from './tool-icon';
import { kindLabel, statusInfo } from './tool-meta';

interface Props {
  tool: ToolManifest;
  onSelect?: (tool: ToolManifest) => void;
  selected?: boolean;
}

export function ToolCard({ tool, onSelect, selected }: Props) {
  const status = statusInfo(tool.authStatus ?? 'unknown');
  const visibleCaps = tool.capabilities.slice(0, 3);
  const hiddenCount = tool.capabilities.length - visibleCaps.length;

  return (
    <button
      onClick={() => onSelect?.(tool)}
      className={cn(
        // 22px Cohere card on pure white. Selection promotes border to ink.
        'group relative flex w-full flex-col items-start gap-3 rounded-xl border bg-paper-raised p-4 text-left transition-all',
        selected
          ? 'border-ink shadow-lift'
          : 'border-stone-subtle hover:border-stone-strong hover:shadow-lift',
      )}
    >
      <div className="flex w-full items-start justify-between gap-2">
        <div className="flex items-center gap-2.5">
          {/* Icon tile — pure white with hairline border */}
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-stone-subtle bg-paper text-ink"
            style={tool.brandColor ? { color: tool.brandColor } : undefined}
          >
            <ToolIcon name={tool.icon} size={17} />
          </span>
          <div className="flex min-w-0 flex-col">
            <span
              className="font-display text-base leading-tight text-ink"
            >
              {tool.name}
            </span>
            <span className="font-mono text-2xs uppercase tracking-codeWide text-ink-subtle">
              {kindLabel(tool.kind)}
            </span>
          </div>
        </div>

        {/* Status pill — monochrome chrome, color signal in the dot */}
        <span
          className={cn(
            'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-2xs',
            status.bg,
            status.fg,
            status.border,
          )}
          title={status.label}
        >
          <span className={cn('h-1.5 w-1.5 rounded-full', status.dot)} />
          <span className="font-mono uppercase tracking-code">{status.short}</span>
        </span>
      </div>

      <p className="line-clamp-2 text-xs leading-relaxed text-ink-muted">{tool.description}</p>

      <div className="mt-auto flex w-full flex-wrap items-center gap-1">
        {visibleCaps.map((cap) => (
          <span
            key={cap}
            className="rounded-sm border border-stone-subtle px-1.5 py-0.5 font-mono text-2xs uppercase tracking-code text-ink-subtle"
          >
            {cap.split('.').slice(-1)[0]}
          </span>
        ))}
        {hiddenCount > 0 && (
          <span className="font-mono text-2xs uppercase tracking-code text-ink-subtle">
            +{hiddenCount}
          </span>
        )}
      </div>

      {/* Brand-color corner dot — tiny signature, not a stripe */}
      {tool.brandColor && (
        <span
          className="absolute right-3 top-3 block h-1.5 w-1.5 rounded-sm opacity-60 transition-opacity group-hover:opacity-100"
          style={{ backgroundColor: tool.brandColor }}
        />
      )}
    </button>
  );
}
