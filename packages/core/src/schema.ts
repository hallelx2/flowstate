/**
 * The flowstate Agent file format.
 *
 * Two surface forms — Markdown with YAML frontmatter, and pure YAML —
 * both compile to the same canonical AST defined here.
 *
 * This is the contract every loader, validator, runtime, and UI consumes.
 */

import { z } from 'zod';

// ─── Trigger ──────────────────────────────────────────────────────────────
// Discriminated union — runtime can pattern-match on `kind`.

export const TriggerSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('manual') }),
  z.object({
    kind: z.literal('webhook'),
    config: z
      .object({
        path: z.string().regex(/^\//, 'Webhook path must start with /'),
        method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).optional(),
      })
      .optional(),
  }),
  z.object({
    kind: z.literal('cron'),
    config: z.object({
      schedule: z.string().min(1),
      timezone: z.string().optional(),
    }),
  }),
  z.object({
    kind: z.literal('watch'),
    config: z.object({
      source: z.string().min(1), // e.g. "fs:./inbox", "drive:folder/abc"
    }),
  }),
  z.object({
    kind: z.literal('event'),
    config: z.object({ name: z.string().min(1) }),
  }),
]);

// ─── Budget ───────────────────────────────────────────────────────────────
// Hard caps. Runtime kills the agent at the limit.

export const BudgetSchema = z.object({
  tokens: z.number().int().positive().optional(),
  usd: z.number().positive().optional(),
  runtimeMs: z.number().int().positive().optional(),
});

// ─── Permissions ──────────────────────────────────────────────────────────
// Runtime enforces these at tool-resolution time. Default-deny.

export const PermissionsSchema = z.object({
  network: z.array(z.string()).optional(),
  fs: z
    .object({
      read: z.array(z.string()).optional(),
      write: z.array(z.string()).optional(),
    })
    .optional(),
  env: z.array(z.string()).optional(),
  /**
   * Tool refs that always require human approval before invocation.
   * Surfaces in the marketplace install screen + the run-time HITL banner.
   */
  approvalRequired: z.array(z.string()).optional(),
});

// ─── Inputs ──────────────────────────────────────────────────────────────
// Typed input declaration — runtime validates the trigger payload (or
// the user-supplied input on manual runs) against this schema before
// the agent starts. Keeps the contract honest.

export const InputDefSchema = z.object({
  type: z.enum(['string', 'integer', 'number', 'boolean', 'object', 'array']),
  required: z.boolean().optional(),
  default: z.unknown().optional(),
  description: z.string().optional(),
  enum: z.array(z.unknown()).optional(),
});

export const InputsSchema = z.record(z.string(), InputDefSchema);

// ─── Guardrails — Claude Agent SDK options the agent locks in ────────────

export const GuardrailsSchema = z.object({
  /** Maps to SDK's permissionMode — controls how tool calls are gated. */
  permissionMode: z
    .enum(['default', 'acceptEdits', 'plan', 'bypassPermissions'])
    .optional(),
  /** Hard cap on agentic turns before the SDK stops. */
  maxTurns: z.number().int().positive().optional(),
  /** Explicit allowlist of SDK-known tool names (overrides the SDK default set). */
  allowedTools: z.array(z.string()).optional(),
  /** Tool names this agent is NEVER allowed to invoke, even if allowed by mode. */
  disallowedTools: z.array(z.string()).optional(),
  /** SDK reasoning effort hint — accepts named level OR integer. */
  effort: z
    .union([z.enum(['low', 'medium', 'high', 'xhigh', 'max']), z.number().int().positive()])
    .optional(),
});

// ─── Dependencies — sub-skills imported by ref ───────────────────────────

export const DependencySchema = z.object({
  /**
   * Reference. Either a local skill (`./skills/notify.md`) or a
   * marketplace ref (`github:publisher/agent-id`).
   */
  ref: z.string().min(1),
  /** Semver range — e.g. ^1.0, ~1.2.3, or "*" for any. */
  version: z.string().optional(),
});

// ─── Tool reference ───────────────────────────────────────────────────────
// `provider:id` — e.g. `mcp:gmail.send`, `cli:gcloud.run.deploy`, `skill:notify`.

const TOOL_REF_RE = /^(mcp|cli|http|composio|skill|shell|sdk):[a-z0-9_.-]+$/i;
export const ToolRefSchema = z.string().regex(TOOL_REF_RE, 'Expected `provider:id` format');

// ─── Capability tag ───────────────────────────────────────────────────────
// Dotted path — e.g. `communication.email.send`, `payment.refund.create`.

const CAPABILITY_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
export const CapabilitySchema = z.string().regex(CAPABILITY_RE, 'Expected dotted capability path');

// ─── Sections · the linked-file structure ─────────────────────────────────
// A master agent file can either inline its sections or reference external
// markdown files (one rule per file, one step per file, etc.). The loader
// resolves `include:` paths against the parent agent's directory and inlines
// the content into the canonical AST.

/** A section's source — inline string OR `{ include: "./path/to/file.md" }`. */
export const SectionSourceSchema = z.union([
  z.string(),
  z.object({ include: z.string().min(1) }),
]);

export const RuleSchema = z.object({
  title: z.string().min(1),
  body: SectionSourceSchema,
  /** Tool refs or capabilities this rule governs (optional, for filtering). */
  appliesTo: z.array(z.string()).optional(),
});

export const StepSchema = z.object({
  id: z.string().optional(),
  title: z.string().min(1),
  body: SectionSourceSchema,
});

export const SectionsSchema = z.object({
  goal: SectionSourceSchema.optional(),
  rules: z.array(RuleSchema).optional(),
  steps: z.array(StepSchema).optional(),
  onFailure: SectionSourceSchema.optional(),
});

// ─── Agent metadata · spec v1.0 ───────────────────────────────────────────
// What lives in YAML frontmatter (md) or at the top level (yaml).
//
// Backward-compat: spec_version defaults to "1.0" for older files. New
// fields are all optional so v0.x agents (the bundled examples) keep
// loading without changes.

export const SemverSchema = z
  .string()
  .regex(/^\d+\.\d+\.\d+(?:-[\w.]+)?$/, 'version must be valid semver (1.2.3)');

export const PublisherSchema = z
  .string()
  .min(1)
  .regex(/^[a-z][a-z0-9_-]*$/, 'publisher must be kebab-case (lowercase + dashes/underscores)');

export const AgentMetaSchema = z.object({
  /** Spec version — gates parser behavior. v1.0 is the marketplace baseline. */
  specVersion: z.string().default('1.0'),

  id: z
    .string()
    .min(1)
    .regex(/^[a-z][a-z0-9-]*$/, 'id must be kebab-case (lowercase + dashes)'),
  name: z.string().min(1),
  description: z.string().optional(),

  /** ─── Marketplace metadata (optional in v1.0, required to publish) ─── */
  publisher: PublisherSchema.optional(),
  version: SemverSchema.optional(),
  license: z.string().optional(),
  homepage: z.string().url().optional(),
  /** github:user/repo or full git URL */
  repository: z.string().optional(),
  /** Free-form tags for marketplace filtering. */
  tags: z.array(z.string()).optional(),

  trigger: TriggerSchema,

  /** Explicit tool references (deterministic) */
  tools: z.array(ToolRefSchema).default([]),
  /** Capability tags — resolver picks tools at bind time (semantic) */
  needs: z.array(CapabilitySchema).optional(),

  /** Typed input contract — runtime validates payloads against this. */
  inputs: InputsSchema.optional(),
  /** Secret names this agent reads (env vars or keychain entries). */
  secrets: z.array(z.string()).optional(),
  /** Sub-skill dependencies (local refs or marketplace refs). */
  dependencies: z.array(DependencySchema).optional(),

  budget: BudgetSchema.optional(),
  permissions: PermissionsSchema.optional(),
  guardrails: GuardrailsSchema.optional(),

  /** Linked-file structure — goal, rules, steps, on_failure */
  sections: SectionsSchema.optional(),
});

export type AgentMeta = z.infer<typeof AgentMetaSchema>;
export type Trigger = z.infer<typeof TriggerSchema>;
export type Budget = z.infer<typeof BudgetSchema>;
export type Permissions = z.infer<typeof PermissionsSchema>;
export type SectionSource = z.infer<typeof SectionSourceSchema>;
export type Rule = z.infer<typeof RuleSchema>;
export type Step = z.infer<typeof StepSchema>;
export type Sections = z.infer<typeof SectionsSchema>;
export type Inputs = z.infer<typeof InputsSchema>;
export type InputDef = z.infer<typeof InputDefSchema>;
export type Guardrails = z.infer<typeof GuardrailsSchema>;
export type Dependency = z.infer<typeof DependencySchema>;
