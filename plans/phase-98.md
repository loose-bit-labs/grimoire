# Phase 98 — Secret-read denial hook (first slice of the safe-AI-workspace sandbox)

**Authority:** hierophant, 2026-09-29. **Repo:** grimoire. **Track: Safe AI Workspace (new).**
**Depends on:** nothing.

## Why

`concept_bounty_safe_ai_workspace_sandbox_for_unattended_automode` is the flagship
"safe AI workspace" bounty (user, 2026-08-29) — but it's one big paragraph covering four
threat classes (filesystem, secrets, egress, audit) with no concrete phase-shaped slice.
Re-triaged 2026-09-29 (`concept_backlog_triage_jev_2026_09_29_5_candidates_safesandbox_decom`):
the parent item scored lowest-readiness (0.06/2) of the whole backlog — too vague to brief
as one phase, matching Rule 2 (nothing speculative). Decomposed into its 4 named sub-pieces
and re-scored: `fsJail` and `egressAllowlist` both landed "large/open-ended, needs its own
design spec" (effort 2.88/2.33 of 3, readiness 0.02/0.18 of 2) — still too vague to brief.
**`secretDeny` is the one concrete, small slice** — effort 0.84 ("small, fits one
well-scoped phase"), readiness 0.58, and won the decomposition's own first-pick Choice
(0.55 vs `auditTrail`'s 0.45).

**Honesty note (unlike this session's other briefs, which were written after reading the
exact code they touch):** this repo has **no existing Claude Code hooks configuration**
(`.claude/settings.json` doesn't exist yet, only a local, unshared `settings.local.json`
with no `hooks` key) — there is no prior convention in this repo to mirror. This brief
describes the intended *behavior*; whoever implements it should confirm the exact
`PreToolUse` hook JSON contract (matcher shape, blocking exit code) against the current
Claude Code hooks documentation before coding, rather than trusting this brief's
recollection of the schema. Reference prior art (KB): `system_claude_autoresearch_skill`'s
`privacy-block` hook does the same job for a different agent framework — same idea, not the
same schema.

## What lands

- **`.claude/settings.json`** (new, repo-level, committed — not `settings.local.json`): a
  `PreToolUse` hook entry matching the `Read` tool, invoking a small guard script.
- **A guard script** (e.g. `bin/grim-secret-guard.js`, class-based per this repo's Node
  convention) that: reads the tool-call info the hook receives on stdin, extracts the file
  path `Read` was asked to open, checks it against a short, explicit deny-list of patterns
  (`~/.ssh/**`, `~/.config/api-keys/**`, `~/.aws/**`, any path containing `.env` — start
  narrow, this is a v1 slice, not a general secrets-scanner), and if it matches, blocks the
  read (exit code per the confirmed hook contract) with a clear stderr message naming which
  pattern matched. No match → allow silently (exit 0), no false-positive noise on ordinary
  reads.
- **Explicitly NOT covered by this phase** (say so in the implementation, don't silently
  drop it): `Bash` commands that read the same paths via `cat`/`grep`/etc. — blocking those
  safely requires distinguishing "cat the raw secret" from "run a script that legitimately
  reads it internally" (e.g. `lib/jev.js` itself reads `~/.config/api-keys/keys.json` on
  every `grim jev ask` call — a naive path-based Bash blocklist would break the tool this
  session just shipped). That's a harder, semantic gate — parked with `fsJail`/
  `egressAllowlist` as still-too-vague, not solved here.

## Footprint

`.claude/settings.json` (new), `bin/grim-secret-guard.js` (new), a test file for the guard
script's pure logic (path-matching function, testable without invoking the real hook
machinery — extract that into an exported function per Rule 13).

## Success checks

- The guard script's path-matching function is unit-testable in isolation: given a set of
  paths, correctly classifies which match the deny-list and which don't (including near-miss
  cases — a file merely named `keys.json.bak` in an unrelated directory should NOT match).
- A live demonstration: configure the hook, have Claude attempt `Read` on `~/.ssh/id_rsa`
  (or a safe fixture path under the same pattern) and confirm the tool call is actually
  blocked with the stderr message — not just that the guard script runs standalone. Per the
  ROADMAP's own acceptance-bar rule: "a guard passing review while dead is not acceptance"
  (phase 58's circular-dep lesson) — prove it *triggers*, don't just prove the function
  exists.
- An ordinary `Read` of a non-matching path (e.g. a file in this repo) still succeeds
  normally — no regression, no over-broad blocking.
- `node --test` on the new test file green; full suite green + self-terminating.

## Out of scope

`Bash`-based reads of the same paths (see above — a harder, deferred problem). `fsJail`,
`egressAllowlist`, `auditTrail` — the other three sandbox sub-pieces, still too vague to
brief. No integration with the Bounty Board's hunter loop specifically — this hook applies
to any Claude Code session in this repo, hunters included, but isn't hunter-specific code.
