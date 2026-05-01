/**
 * Backend smoke test — runs the orchestration logic outside Electron.
 *
 * Verifies, end-to-end and without spinning up the UI:
 *   1. The Claude Agent SDK is reachable with the current auth.
 *   2. checkPermissions() denies, allows, and routes to HITL correctly.
 *   3. resolveCliTools() builds a sound bash allowlist from `cli:*` refs.
 *   4. resolveMcpServers() builds the SDK mcpServers map from `mcp:*` refs.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-… node apps/desktop/scripts/test-backend.mjs
 *
 * Set TEST_LIVE=1 to also fire a real one-token query() call against the
 * SDK. Otherwise we skip that step (fast offline run, no token spend).
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
// @flowstate/core's package main points at src/index.ts so the IDE +
// vite see source. We use tsx (`pnpm test:backend`) so this script can
// import the same source path the app uses, without a separate build.
import {
  checkPermissions,
  resolveCliTools,
  resolveMcpServers,
} from '@flowstate/core';

let pass = 0;
let fail = 0;

function check(name, ok, detail = '') {
  if (ok) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function section(title) {
  console.log(`\n→ ${title}`);
}

// ─── 1. Permission gate ────────────────────────────────────────────────────
section('checkPermissions');

{
  const d = checkPermissions(
    'Bash',
    { command: 'rm -rf /' },
    undefined,
    { disallowedTools: ['Bash'] },
    [],
  );
  check('disallowed → deny', d.decision === 'deny', d.reason);
}

{
  const d = checkPermissions('WebFetch', { url: 'https://evil.example/x' }, {
    network: ['anthropic.com'],
  });
  check('off-allowlist host → deny', d.decision === 'deny', d.reason);
}

{
  const d = checkPermissions('WebFetch', { url: 'https://api.anthropic.com/v1' }, {
    network: ['anthropic.com'],
  });
  check('on-allowlist host → allow', d.decision === 'allow');
}

{
  const d = checkPermissions(
    'Bash',
    { command: 'gh pr list --state open --limit 20 --json number,title,author,state,createdAt' },
    undefined,
    undefined,
    resolveCliTools(['cli:gh.pr.list']).bashAllowPatterns,
  );
  check('bash matches cli template → allow', d.decision === 'allow', d.reason);
}

{
  const d = checkPermissions(
    'Bash',
    { command: 'curl http://evil.example' },
    undefined,
    undefined,
    resolveCliTools(['cli:gh.pr.list']).bashAllowPatterns,
  );
  check('bash off-template → deny', d.decision === 'deny');
}

{
  const d = checkPermissions(
    'Write',
    { file_path: '/tmp/safe.txt' },
    { approvalRequired: ['Write'] },
  );
  check('approvalRequired → requires_approval', d.decision === 'requires_approval');
}

// ─── 2. CLI resolver ───────────────────────────────────────────────────────
section('resolveCliTools');

{
  const r = resolveCliTools(['cli:gh.pr.create', 'cli:git.status', 'cli:nope.invalid']);
  check('resolves known refs', r.resolved.length === 2);
  check('flags unknown refs', r.unresolved.includes('cli:nope.invalid'));
  check('produces bash patterns', r.bashAllowPatterns.length === 2);
  check('addendum mentions cli', r.systemPromptAddendum.includes('shell commands'));
}

// ─── 3. MCP resolver ───────────────────────────────────────────────────────
section('resolveMcpServers');

{
  const r = resolveMcpServers(['mcp:github', 'mcp:slack.chat_postMessage', 'mcp:nonexistent']);
  check('resolves stdio servers', !!r.sdkServers['github']);
  check('flags unknown servers', r.unresolved.includes('mcp:nonexistent'));
  check('emits scoped tool names', r.allowedToolNames.some((n) => n.startsWith('mcp__slack__')));
  check(
    'github bare ref → no allowed-tool restriction',
    !r.allowedToolNames.some((n) => n.startsWith('mcp__github__')),
  );
}

// ─── 4. Live SDK call (opt-in) ─────────────────────────────────────────────
if (process.env.TEST_LIVE === '1') {
  section('SDK live call');

  if (!process.env.ANTHROPIC_API_KEY && !process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    console.log('  ! skipped — set ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN');
  } else {
    let saw = 0;
    let lastError;
    try {
      const iter = query({
        prompt: 'Reply with the single word "ok".',
        options: {
          maxTurns: 1,
          allowedTools: [],
          disallowedTools: ['Bash', 'Write', 'Edit', 'Read'],
        },
      });
      for await (const msg of iter) {
        saw++;
        if (msg.type === 'result' && 'is_error' in msg && msg.is_error) {
          lastError = JSON.stringify(msg).slice(0, 200);
        }
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    check(`SDK streamed ≥ 1 message`, saw >= 1, lastError ?? '');
  }
} else {
  console.log('\n→ SDK live call (skipped — set TEST_LIVE=1 to run)');
}

// ─── Summary ───────────────────────────────────────────────────────────────
console.log(`\n${pass + fail} checks · ${pass} passed · ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
