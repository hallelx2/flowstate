import type { ReactNode } from 'react';
import { Home, Bot, Wrench, Workflow, History, Settings } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { View } from '@/App';
import { FlowstateMark } from '@/components/brand/flowstate-mark';

const NAV: Array<{ id: View | 'runs' | 'settings'; label: string; icon: typeof Home }> = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'agents', label: 'Agents', icon: Bot },
  { id: 'tools', label: 'Tools', icon: Wrench },
  { id: 'flow', label: 'Flow', icon: Workflow },
  { id: 'runs', label: 'Runs', icon: History },
  { id: 'settings', label: 'Settings', icon: Settings },
];

interface ShellProps {
  active: View;
  onNavigate: (v: View) => void;
  children: ReactNode;
}

export function Shell({ active, onNavigate, children }: ShellProps) {
  return (
    <div className="flex h-full w-full flex-col">
      {/* Title bar — pure white, hairline border */}
      <header className="app-drag flex h-9 shrink-0 items-center justify-between border-b border-stone-subtle bg-paper px-4">
        <div className="flex items-center gap-2 pl-16 sm:pl-20">
          <FlowstateMark size={16} className="rounded-[3.5px]" />
          <span className="font-display text-sm tracking-tight text-ink">
            <span className="italic font-light">flow</span>state
          </span>
          <span className="font-mono text-2xs uppercase tracking-code text-ink-subtle">
            / untitled workspace
          </span>
        </div>
        <div className="app-no-drag flex items-center gap-3">
          <StatusPill label="Claude · Sonnet" tone="active" />
          <span className="font-mono text-2xs uppercase tracking-code text-ink-subtle">⌘K</span>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Left rail */}
        <nav className="flex w-16 shrink-0 flex-col items-center gap-1 border-r border-stone-subtle bg-paper-sunken py-3">
          {NAV.map(({ id, label, icon: Icon }) => {
            const isActive = id === active;
            const isImplemented = id === 'home' || id === 'agents' || id === 'tools' || id === 'flow';
            return (
              <button
                key={id}
                onClick={() => isImplemented && onNavigate(id as View)}
                title={label}
                className={cn(
                  'group relative flex h-10 w-10 items-center justify-center rounded-md transition-all',
                  'text-ink-subtle hover:bg-paper hover:text-ink',
                  isActive && 'bg-paper text-ink border border-stone-subtle',
                  !isImplemented && 'opacity-40 cursor-not-allowed',
                )}
              >
                {isActive && (
                  <span className="absolute -left-2 top-1/2 h-5 w-0.5 -translate-y-1/2 bg-ink" />
                )}
                <Icon size={16} strokeWidth={1.6} />
              </button>
            );
          })}
        </nav>

        {/* Main content */}
        <main className="relative flex-1 overflow-hidden">{children}</main>
      </div>
    </div>
  );
}

function StatusPill({ label, tone }: { label: string; tone: 'active' | 'idle' }) {
  return (
    <div className="flex items-center gap-1.5 rounded-full border border-stone bg-paper px-2.5 py-0.5">
      <span
        className={cn(
          'h-1.5 w-1.5 rounded-full',
          tone === 'active' ? 'bg-ok animate-pulseBlue' : 'bg-ink-subtle',
        )}
      />
      <span className="font-mono text-2xs uppercase tracking-code text-ink-muted">{label}</span>
    </div>
  );
}
