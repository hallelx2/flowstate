---
id: release-notes
name: Weekly release notes
description: Compile release notes from the last 7 days of merged PRs every Monday morning.

trigger:
  kind: cron
  config:
    schedule: "0 9 * * MON"
    timezone: "America/Los_Angeles"

tools:
  - cli:gh.pr.list
  - cli:gh.pr.view
  - mcp:linear.issues.list
  - mcp:notion.pages.create

needs:
  - code.repo.read
  - project.cycle.read
  - note.page.create

budget:
  tokens: 80000
  usd: 0.80
---

## Goal

Every Monday at 9am Pacific, write release notes for everything that shipped
the previous week. Publish to the team Notion page.

## Steps

### 1. Gather merged PRs
`gh pr list --state merged --search "merged:>=$(date -d '7 days ago' --iso-8601)"`

For each PR, pull the title, body, and linked issues.

### 2. Cross-reference Linear
For each linked Linear issue, grab the project name and the cycle it belongs
to. Group PRs by Linear project.

### 3. Write the notes
For each project, write 2-4 sentences in plain English summarizing what
shipped. No bullet-point dumps of PR titles — write it like an editor would,
focused on user-visible impact.

### 4. Publish
Create a new Notion page under "Engineering / Release Notes" with the title
`Release notes · week of {{week_start}}`. Tag the relevant team leads.

## Tone

Editorial, not technical. Write for a product manager, not a release engineer.
If a PR is purely refactor / internal, only mention it if it unblocks
something user-facing.
