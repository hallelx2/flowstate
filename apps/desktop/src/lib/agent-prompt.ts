import type { Agent } from '@flowstate/core';

/**
 * Compose an agent's saved-file content into one prompt string the SDK
 * understands as the system prompt. Order matters — top-level intent first,
 * then narrative, then steps in declared order, then the rules a step needs
 * to honor, then on-failure handling.
 */
export function assembleSystemPrompt(agent: Agent): string {
  const parts: string[] = [];

  parts.push(`# ${agent.name}`);
  if (agent.description) parts.push(agent.description);

  if (agent.sections?.goal) {
    parts.push(`## Goal\n\n${agent.sections.goal.body.trim()}`);
  }

  if (agent.sections?.steps?.length) {
    const lines = agent.sections.steps
      .map((s, i) => `### Step ${i + 1} · ${s.title}\n\n${s.body.body.trim()}`)
      .join('\n\n');
    parts.push(`## Steps\n\n${lines}`);
  }

  if (agent.sections?.rules?.length) {
    const lines = agent.sections.rules
      .map((r) => {
        const applies = r.appliesTo?.length
          ? `\n\n_Applies to: ${r.appliesTo.join(', ')}_`
          : '';
        return `### ${r.title}${applies}\n\n${r.body.body.trim()}`;
      })
      .join('\n\n');
    parts.push(`## Rules\n\n${lines}`);
  }

  if (agent.sections?.onFailure) {
    parts.push(`## On failure\n\n${agent.sections.onFailure.body.trim()}`);
  }

  // Master file body (the prose written outside of declared sections — usually
  // an overview). Comes last so it doesn't drown out structured sections above.
  if (agent.body?.trim()) {
    parts.push(`## Overview\n\n${agent.body.trim()}`);
  }

  return parts.join('\n\n');
}

/**
 * Convenience: build the run-input prompt (the user message) for an agent.
 * For manual / saved-agent runs there's usually no user payload, so we
 * supply a brief "begin" cue. Webhook / event triggers will pass their
 * payload through here once those are wired.
 */
export function defaultUserPrompt(agent: Agent, override?: string): string {
  if (override?.trim()) return override.trim();
  switch (agent.trigger.kind) {
    case 'manual':
      return 'Begin executing the agent as described in the system prompt.';
    case 'webhook':
      return 'A webhook just fired. Process the payload according to your goal.';
    case 'cron':
      return 'Scheduled run. Execute the periodic work described in your goal.';
    case 'watch':
      return 'A watched source changed. Process the change according to your goal.';
    case 'event':
      return `Event "${agent.trigger.config.name}" fired. Handle it.`;
  }
}
