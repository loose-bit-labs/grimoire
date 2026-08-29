# Phase 89 — Dig clone hardening: non-interactive + SSH, never hang the drain

**Authority:** hierophant, 2026-08-29. **Repo:** grimoire. **Track: G cont. (research dig).**
**Depends on:** nothing. Reliability fix for the phase-84 drain.

## Why

2026-08-29: the phase-85 backfill drain sat blocked ~12h. Root cause: `digRepo` (bin/grim-research.js)
shells `git clone` **inside a non-interactive worker**, and a discovered repo that needs auth (private,
or link-scan junk like `cmc_internal/api`, `github/collect`) makes `git clone` **prompt** for
credentials / host-key. With the drain running `--timeout 0` (fire-and-forget, no cap), that prompt
**blocks the serial worker indefinitely** — nothing advances until a human approves the permission. The
human-in-the-loop became the bottleneck for an autonomous loop. User direction (2026-08-29): make the
clone **non-interactive** and **prefer SSH transport**. (Narrow instance of the broader
`Wanted: safe AI workspace` bounty — automode must not be able to hang or prompt.)

## What lands

- **`bin/grim-research.js` `digRepo`** — clone can never prompt or hang:
  - Run `git clone` with `GIT_TERMINAL_PROMPT=0` and
    `GIT_SSH_COMMAND='ssh -oBatchMode=yes -oStrictHostKeyChecking=accept-new'` in the child env, so an
    auth-required repo **fails fast** instead of prompting.
  - Keep the existing `execSync` `timeout` but make it a **hard bound** (const, e.g. 60_000 ms) that
    applies regardless of the research-level `--timeout 0` — a clone must never outlive it.
  - **Prefer SSH transport:** rewrite `https://github.com/OWNER/REPO(.git)?` → `git@github.com:OWNER/REPO.git`
    before cloning (uses the operator's key; repos they can reach clone, others fail fast). If the SSH
    clone fails non-interactively, that's a graceful dig-failure — do **not** retry over interactive HTTPS.
  - **Skip junk before cloning:** validate the discovered repo shape (`parseRepoUrl` already exists) and
    skip owners/repos that are obviously malformed or non-resolvable link-scan noise, so we don't spend a
    clone attempt on them.
- Failure stays graceful (already does): a failed dig folds into the digest as "dig failed", the dive
  still completes and files its entity.

## Footprint

`bin/grim-research.js` (`digRepo` + a small URL-normalize helper), `test/grim-research.test.js`.

## Success checks

- **Never hangs:** a discovered repo that requires auth (simulate: a URL whose clone would prompt) →
  `digRepo` returns a failure **within the clone-timeout bound**, non-interactively (assert
  `GIT_TERMINAL_PROMPT=0` in the child env; timing-bounded assertion, no hang).
- **SSH rewrite:** `https://github.com/foo/bar` and `…/bar.git` both normalize to
  `git@github.com:foo/bar.git` before clone (assert the command/arg).
- **Junk skipped:** a malformed discovered repo URL is skipped before any `git clone` is spawned.
- **Graceful:** on dig failure the dive still completes and files an entity (existing behavior preserved).
- `node --test test/grim-research.test.js` green; full suite green + self-terminating.

## Out of scope

- Cloning to `~/src/3rd` (the acquisition-rules' persistent-checkout idea) — separate; this phase keeps
  the temp-dir clone, only makes it safe.
- The uncapped final judge (`--timeout 0`) — separate watch-item.
- The broader sandbox / egress-filter safety work — that's the `Wanted: safe AI workspace` bounty, of
  which this is one concrete slice.
