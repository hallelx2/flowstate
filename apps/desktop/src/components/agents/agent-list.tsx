import type { Agent } from '@flowstate/core';
import { cn } from '@/lib/cn';
import { triggerLabel } from './agent-meta';

interface Props {
  agents: Agent[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function AgentList({ agents, selectedId, onSelect }: Props) {
  return (
    <ul className="flex flex-col gap-px overflow-y-auto px-2 py-2">
      {agents.map((agent) => {
        const isSelected = agent.id === selectedId;
        const toolCount = agent.tools?.length ?? 0;
        const capCount = agent.needs?.length ?? 0;

        return (
          <li key={agent.id}>
            <button
              onClick={() => onSelect(agent.id)}
              className={cn(
                'group flex w-full flex-col items-start gap-1 rounded-md border px-3 py-2.5 text-left transition-all',
                isSelected
                  ? 'border-stone bg-paper-sunken'
                  : 'border-transparent hover:border-stone-subtle hover:bg-paper-sunken/60',
              )}
            >
              <div className="flex w-full items-center justify-between gap-2">
                <span className="truncate font-display text-sm text-ink">{agent.name}</span>
                <span
                  className={cn(
                    'shrink-0 rounded-sm border px-1 py-0 font-mono text-2xs uppercase tracking-code',
                    agent.source === 'markdown'
                      ? 'border-stone bg-paper text-ink-muted'
                      : 'border-cohere-purple-300 bg-cohere-purple-50 text-cohere-purple-700',
                  )}
                  title={agent.source === 'markdown' ? 'Markdown' : 'YAML'}
                >
                  {agent.source === 'markdown' ? 'MD' : 'YML'}
                </span>
              </div>

              <span className="font-mono text-2xs uppercase tracking-code text-ink-subtle">
                {triggerLabel(agent.trigger)}
              </span>

              {(toolCount > 0 || capCount > 0) && (
                <div className="mt-1 flex items-center gap-2 text-2xs text-ink-subtle">
                  {toolCount > 0 && <span>{toolCount} tool{toolCount === 1 ? '' : 's'}</span>}
                  {toolCount > 0 && capCount > 0 && <span className="opacity-50">·</span>}
                  {capCount > 0 && (
                    <span>
                      {capCount} capabilit{capCount === 1 ? 'y' : 'ies'}
                    </span>
                  )}
                </div>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
