/**
 * Capability ontology — the controlled vocabulary agents declare against
 * via the `needs:` field.
 *
 * Why this matters:
 *   When an agent says `needs: [communication.email.send]`, it stays
 *   portable across users — the resolver picks Gmail for one user and
 *   Outlook for another, the agent doesn't need to know.
 *
 * Discipline:
 *   Capabilities are dotted paths, lowercase, plural-free at each segment,
 *   max 4 segments. New capabilities go through PR review against this
 *   file. The runtime warns on unknown capabilities but doesn't fail —
 *   community publishers may need new tags before the registry catches up.
 *
 * v1 covers ~80 tags across 10 domains. v2 is additive only.
 */

export const CAPABILITY_ONTOLOGY_VERSION = '1.0';

export const CAPABILITIES = {
  // ─── Communication ─────────────────────────────────────────────────
  communication: {
    email: ['send', 'read', 'search', 'draft', 'label', 'reply', 'forward'],
    chat: ['post', 'dm', 'channel.create', 'channel.archive', 'reaction.add'],
    sms: ['send', 'receive'],
    voice: ['call.start', 'call.end', 'transcribe'],
    notification: ['push', 'desktop', 'email.alert'],
  },

  // ─── Payment ───────────────────────────────────────────────────────
  payment: {
    charge: ['create', 'capture', 'void'],
    refund: ['create', 'partial'],
    customer: ['retrieve', 'upsert', 'delete'],
    subscription: ['create', 'cancel', 'update', 'pause'],
    invoice: ['create', 'send', 'mark_paid'],
    payout: ['create', 'list'],
  },

  // ─── Cloud / infra ─────────────────────────────────────────────────
  cloud: {
    deploy: ['container', 'serverless', 'static_site'],
    storage: ['read', 'write', 'list', 'delete', 'presign'],
    dns: ['record.create', 'record.update', 'record.delete'],
    secret: ['read', 'write', 'rotate'],
    iam: ['policy.read', 'policy.write', 'role.assume'],
    k8s: ['get', 'apply', 'delete', 'logs', 'exec'],
    db: ['provision', 'snapshot', 'restore'],
  },

  // ─── Code / source control ─────────────────────────────────────────
  code: {
    repo: ['read', 'write', 'clone'],
    pr: ['create', 'review', 'merge', 'close', 'list'],
    issue: ['create', 'comment', 'list', 'close', 'label'],
    branch: ['create', 'delete', 'list'],
    commit: ['write', 'list', 'cherry_pick'],
    workflow: ['run', 'dispatch', 'status'],
    review: ['comment', 'approve', 'request_changes'],
  },

  // ─── Data / analytics ──────────────────────────────────────────────
  data: {
    query: ['sql', 'graphql', 'aggregate'],
    schema: ['inspect', 'migrate'],
    row: ['insert', 'update', 'delete', 'upsert'],
    export: ['csv', 'json', 'parquet'],
    transform: ['etl', 'pivot', 'join'],
    embed: ['text', 'image'],
    search: ['vector', 'fulltext', 'hybrid'],
  },

  // ─── Project management / docs ─────────────────────────────────────
  project: {
    cycle: ['read', 'list'],
    milestone: ['create', 'update'],
    sprint: ['plan', 'close'],
    task: ['create', 'update', 'complete', 'assign'],
  },
  note: {
    page: ['create', 'update', 'search', 'delete'],
    database: ['query', 'insert', 'update'],
    block: ['append', 'delete'],
  },

  // ─── Calendar ──────────────────────────────────────────────────────
  calendar: {
    event: ['create', 'list', 'update', 'cancel'],
    availability: ['check', 'block'],
    invite: ['send', 'rsvp'],
  },

  // ─── CRM / sales ───────────────────────────────────────────────────
  crm: {
    contact: ['upsert', 'search', 'enrich', 'delete'],
    deal: ['create', 'update', 'stage_change'],
    note: ['add', 'search'],
    sequence: ['enroll', 'unenroll'],
  },

  // ─── Files / filesystem ────────────────────────────────────────────
  file: {
    read: ['text', 'binary'],
    write: ['text', 'binary', 'append'],
    search: ['glob', 'grep'],
    delete: [''],
    move: [''],
    archive: ['create', 'extract'],
  },

  // ─── Web / browser ─────────────────────────────────────────────────
  web: {
    fetch: [''],
    scrape: ['html', 'pdf'],
    browse: ['navigate', 'click', 'fill'],
    screenshot: [''],
  },

  // ─── ML / cognitive ────────────────────────────────────────────────
  ml: {
    summarize: [''],
    classify: [''],
    extract: ['entities', 'relations', 'structured'],
    translate: [''],
    transcribe: ['audio', 'video'],
    generate: ['image', 'speech'],
  },

  // ─── System ────────────────────────────────────────────────────────
  system: {
    shell: ['exec'],
    process: ['list', 'kill', 'spawn'],
    env: ['read', 'write'],
    notification: ['os'],
  },

  // ─── Workflow (recursive: skill orchestration) ─────────────────────
  workflow: {
    skill: ['invoke', 'delegate'],
    schedule: ['create', 'cancel'],
    state: ['get', 'set', 'lock'],
  },
} as const;

/** Flattened set of every valid capability tag — used by the validator. */
export const KNOWN_CAPABILITIES: ReadonlySet<string> = (() => {
  const flat = new Set<string>();
  for (const [domain, sub] of Object.entries(CAPABILITIES)) {
    for (const [resource, actions] of Object.entries(sub as Record<string, readonly string[]>)) {
      for (const action of actions) {
        flat.add(action ? `${domain}.${resource}.${action}` : `${domain}.${resource}`);
      }
    }
  }
  return flat;
})();

/** Returns the unknown capability tags from a list, for warning UIs. */
export function unknownCapabilities(needs: string[] | undefined): string[] {
  if (!needs) return [];
  return needs.filter((c) => !KNOWN_CAPABILITIES.has(c));
}

/** Group a list of capabilities by their top-level domain, for display. */
export function groupCapabilitiesByDomain(
  needs: string[],
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const c of needs) {
    const domain = c.split('.')[0] ?? 'unknown';
    (out[domain] ??= []).push(c);
  }
  return out;
}
