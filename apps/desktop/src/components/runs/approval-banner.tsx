import { motion } from 'motion/react';
import { ShieldAlert, Check, X } from 'lucide-react';
import { runStore, type PendingApproval } from '@/lib/run-store';
import { cn } from '@/lib/cn';

interface Props {
  runId: string;
  approval: PendingApproval;
}

/**
 * The human-in-the-loop approval prompt.
 *
 * Surfaces above the flow canvas when an agent wants to invoke a
 * "destructive" tool (refunds, sends, deletes, deploys). Approve continues
 * the run; Deny cancels it. The runStore.requestApproval() Promise the
 * runner is awaiting resolves either way.
 */
export function ApprovalBanner({ runId, approval }: Props) {
  return (
    <motion.div
      initial={{ y: -8, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: -8, opacity: 0 }}
      transition={{ duration: 0.25, ease: [0.2, 0.8, 0.2, 1] }}
      className="border-b border-cohere-purple-300 bg-cohere-purple-50"
    >
      <div className="px-10 py-4">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-md border border-cohere-purple-300 bg-paper p-1.5">
            <ShieldAlert size={14} className="text-cohere-purple-700" strokeWidth={1.7} />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-mono text-2xs uppercase tracking-code-wide text-cohere-purple-700">
                APPROVAL REQUIRED
              </span>
              <span className="font-mono text-2xs text-ink-subtle">
                · waiting since{' '}
                {new Date(approval.requestedAt).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                })}
              </span>
            </div>

            <h3 className="mt-1 font-display text-lg text-ink leading-snug">
              {approval.message}
            </h3>

            <div className="mt-2 flex items-center gap-2">
              <span className="rounded-sm border border-stone-subtle bg-paper px-1.5 py-0.5 font-mono text-2xs text-ink">
                {approval.toolId}
                {approval.toolAction ? `.${approval.toolAction}` : ''}
              </span>
            </div>

            {approval.inputs && Object.keys(approval.inputs).length > 0 && (
              <details className="mt-3 group">
                <summary className="flex cursor-pointer items-center gap-1.5 font-mono text-2xs uppercase tracking-code text-ink-muted hover:text-ink">
                  <span className="transition-transform group-open:rotate-90">▶</span>
                  inputs · {Object.keys(approval.inputs).length}
                </summary>
                <pre className="mt-2 overflow-x-auto rounded-md border border-stone-subtle bg-paper p-3 font-mono text-2xs leading-relaxed text-ink">
                  {JSON.stringify(approval.inputs, null, 2)}
                </pre>
              </details>
            )}
          </div>

          <div className="flex shrink-0 flex-col gap-2">
            <button
              onClick={() => runStore.resolveApproval(runId, true)}
              className={cn(
                'inline-flex items-center justify-center gap-1.5 rounded-md bg-ink px-3 py-1.5 text-xs font-medium text-paper transition-all',
                'hover:bg-accent-600 hover:shadow-glow',
              )}
            >
              <Check size={11} />
              approve
            </button>
            <button
              onClick={() => runStore.resolveApproval(runId, false)}
              className="inline-flex items-center justify-center gap-1.5 rounded-md border border-stone bg-paper px-3 py-1.5 text-xs text-ink-muted transition-colors hover:border-err hover:text-err"
            >
              <X size={11} />
              deny
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
