/**
 * Inline prompt-card — rendered above the composer when the Conductor
 * needs a free-form answer (`ask_user`) or a destructive-tool approval.
 *
 * Two flavors:
 *   - approval: shows tool name + input preview + Approve/Deny buttons
 *   - input: shows question + text field (masked when secret) + Send/Cancel
 */

import { useState } from 'react';
import { Check, X, KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { conductorStore } from '@/lib/conductor-store';

interface ApprovalProps {
  toolName: string;
  input: Record<string, unknown>;
}

export function ApprovalCard({ toolName, input }: ApprovalProps) {
  return (
    <div className="rounded-xl border border-warn/40 bg-warn/5 px-4 py-3">
      <div className="flex items-start gap-3">
        <KeyRound size={14} className="mt-0.5 shrink-0 text-warn" />
        <div className="min-w-0 flex-1">
          <p className="font-mono text-2xs uppercase tracking-code text-ink-subtle">
            destructive tool — approve?
          </p>
          <p className="mt-1 font-mono text-xs text-ink">{toolName.replace(/^mcp__flowstate__/, '')}</p>
          <pre className="mt-2 max-h-32 overflow-y-auto rounded bg-paper-sunken p-2 font-mono text-2xs text-ink-muted">
            {JSON.stringify(input, null, 2)}
          </pre>
        </div>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => conductorStore.respondApproval(false, 'Denied by user')}
        >
          <X size={11} /> Deny
        </Button>
        <Button size="sm" onClick={() => conductorStore.respondApproval(true)}>
          <Check size={11} /> Approve
        </Button>
      </div>
    </div>
  );
}

interface UserInputProps {
  question: string;
  placeholder?: string;
  secret?: boolean;
}

export function UserInputCard({ question, placeholder, secret }: UserInputProps) {
  const [value, setValue] = useState('');
  return (
    <div className="rounded-xl border border-cohere-purple-300 bg-cohere-purple-50 px-4 py-3">
      <p className="font-mono text-2xs uppercase tracking-code text-cohere-purple-700">
        {secret ? 'secret · stays out of chat' : 'conductor needs input'}
      </p>
      <p className="mt-1 text-sm text-ink">{question}</p>
      <div className="mt-2 flex items-center gap-2">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          type={secret ? 'password' : 'text'}
          placeholder={placeholder}
          className={cn(
            'w-full rounded-md border border-stone bg-paper px-3 py-1.5 text-sm text-ink placeholder:text-ink-subtle',
            'focus:border-cohere-purple-focus focus:outline-none',
          )}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && value.trim()) {
              conductorStore.respondUserInput(value);
              setValue('');
            } else if (e.key === 'Escape') {
              conductorStore.respondUserInput(null);
              setValue('');
            }
          }}
          autoFocus
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() => conductorStore.respondUserInput(null)}
        >
          Cancel
        </Button>
        <Button
          size="sm"
          disabled={!value.trim()}
          onClick={() => {
            conductorStore.respondUserInput(value);
            setValue('');
          }}
        >
          Send
        </Button>
      </div>
    </div>
  );
}
