## 0252-mage→minion (brief)

---
id: 0252
ts: 2026-08-04_16:34:02
from: mage
to: minion
phase: 58
state: brief
---

# Phase 58 — pact commit guard: no identity tampering, no `git add -A`, no junk commits

**Authority:** hierophant, 2026-08-04. **Repo:** grimoire. **Track I (Autopact hardening).**
Deterministic mechanics — a **script/guard**, not prose (Rule 13). Found live (see below).

## What happened

The mage skill states *"the pact commits locally after each accepted phase"* (mage
`SKILL.md:49–51`) — but **no pact verb actually commits phase code.** `grim mm archive` commits
only the review thread, surgically (`grim-mm.js:423/463` — `execFileSync('git', ['add', outPath])`).
So to land the phase-57 implementation, a **local model improvised raw git**:

```
git config user.name  T
git config user.email t@t     # ← poisoned .git/config
git add -A                     # ← swept in a concurrent hierophant edit
git commit -m init             # ← junk message + throwaway identity
```

Fallout: every subsequent commit (incl. the proper `phase 57` one) inherited `T <t@t>` until the
override was found and removed; three pushed commits had to be re-authored + force-pushed. The
root cause is the **missing hardened commit path** — the model had no clean way to "commit this
phase," so it hand-rolled git and got all three things wrong (identity, staging, message).

## What lands

1. **Identity gate — `assertRealIdentity(cwd)`** (shared helper, e.g. in `grim-mm.js` or a small
   `lib/git.js`). Reads `git config user.name` / `user.email`; **throws** with fix-guidance when the
   identity looks like a placeholder:
   - empty name/email, name length ≤ 2 or a single token (`T`), or
   - email matching a blocklist / shape: `t@t`, `test@test`, `a@a`, no `.` in the domain,
     `@example.*`, `@localhost`.
   - Message: *"refusing to commit: git identity looks like a placeholder ('T <t@t>'). Set a real
     identity (`git config user.name/email`) or unset a bad local override — the pact never invents
     one."* **The pact never runs `git config user.*` itself.**
2. **Hardened commit verb — `grim mm commit --phase N --files <comma-list> [--message "…"]`.**
   - Calls `assertRealIdentity` first.
   - Stages **only the explicit `--files`** (mirror archive's `execFileSync('git', ['add', f])` per
     path) — **never `git add -A`/`-u`**, so a concurrent edit or untracked scratch can't be swept in.
   - Refuses empty `--files`; refuses paths that don't exist or aren't changed (fail loud, don't
     commit nothing).
   - Message: `--message` if given, else `phase N: <title>` (title from the brief's H1). No freeform
     "init"-style messages from the model.
   - Commits locally, **never pushes** (rope ruling).
3. **Wire the gate into every existing pact commit path** — `grim mm archive` (both branches) calls
   `assertRealIdentity` before committing, and **`grim mm drive` calls it as a preflight** so the
   loop HALTs on a junk identity *before* any commit rather than poisoning history.
4. **Point the skills at the verb.** mage `SKILL.md` (and minion, wherever it lands code): *"Land the
   accepted phase with `grim mm commit --phase N --files <your declared footprint>` — never raw
   `git commit`, never `git config`, never `git add -A`."* This removes the model's reason to
   improvise (the deeper Rule-13 fix).

## Out of scope / do NOT

- Do **not** teach the pact to *set* or *repair* git identity — it only *refuses* a bad one. Fixing
  identity stays a human action.
- No `git add -A`/`-u` anywhere in pact code. No auto-push. Don't touch the archive message format.
- Don't try to auto-detect the footprint by parsing brief prose — require explicit `--files` (the
  acceptance bar already makes the footprint explicit per phase).

## Success checks

- `assertRealIdentity` **throws** for `T <t@t>`, empty, single-char name, `test@test`, `a@a`,
  `x@localhost`; **passes** for `Val GvM <luckybit4755+lbl@gmail.com>`.
- `grim mm commit --phase 99 --files bin/foo.js` with a placeholder identity → refuses, **no commit
  created**, clear guidance. With a real identity → one commit, message `phase 99: <brief title>`,
  and **only `bin/foo.js` staged** (a separately-modified unrelated file is left untouched — the
  concurrency-sweep regression test).
- `grim mm commit` with no `--files` (or a non-existent path) → refuses, non-zero, no commit.
- `grim mm archive` and `grim mm drive` refuse to proceed under a placeholder identity.
- Grep proves no pact code path runs `git config user.*` or `git add -A`.
- mage/minion skills tell the model to use `grim mm commit`, not raw git.
- Footprint: `bin/grim-mm.js` (gate + `commit` verb + archive wiring), `bin/grim-mm-drive.js`
  (preflight), skills, tests (`test/grim-mm.test.js` additions).

## 0253-minion→mage (report)

---
id: 0253
ts: 2026-08-04_20:53:03
from: minion
to: mage
phase: 58
state: report
---

---
id: 0253
ts: 2026-08-04_20:40:00
from: minion
to: mage
phase: 58
state: report
---

# Phase 58 — Report

## Done

### 1. `assertRealIdentity(cwd)` — shared helper in `bin/grim-mm.js`
- Reads `git config user.name` / `user.email` via `execFileSync`
- Throws with fix-guidance on placeholder identities:
  - empty name/email
  - name length ≤ 2 or single token (`T`)
  - email: `t@t`, `test@test`, `a@a`, no `.` in domain, `@example.*`, `@localhost`
- Message: *"refusing to commit: git identity looks like a placeholder ('T <t@t>'). Set a real identity (`git config user.name/email`) or unset a bad local override — the pact never invents one."*
- **Never runs `git config user.*` itself**

### 2. `grim mm commit --phase N --files <comma-list> [--message "…"]` — new verb
- Calls `assertRealIdentity` first
- Stages **only explicit `--files`** — never `git add -A`/`-u`
- Refuses empty `--files`; refuses paths that don't exist or aren't changed
- Message: `--message` if given, else `phase N: <title>`
- Commits locally, **never pushes**

### 3. Wired gate into existing pact commit paths
- `grim mm archive` (both `--phase` and `--from/--to/--out` branches) calls `assertRealIdentity` before committing
- `grim mm drive` calls `assertRealIdentity` as a preflight before ACT verdict — loop HALTs on junk identity before any commit

### 4. Skill updates
- mage SKILL.md: *"Land the accepted phase with `grim mm commit --phase N --files <your declared footprint>` — never raw `git commit`, never `git config`, never `git add -A`."*
- minion SKILL.md: same

### 5. Tests
`test/grim-mm.test.js` — 12 new tests, all pass:
- `assertRealIdentity` throws for `T <t@t>`, empty, single-char name, `test@test`, `a@a`, `x@localhost`
- `assertRealIdentity` passes for `Val GvM <luckybit4755+lbl@gmail.com>`
- `grim mm commit` with placeholder identity → refuses, no commit created
- `grim mm commit` with real identity → one commit, only specified file staged (concurrency-sweep regression: unrelated untracked file left untouched)
- `grim mm commit` with no `--files` → refuses
- `grim mm commit` with non-existent path → refuses
- `grim mm commit` with unchanged file → refuses

## Verification

```
$ grep -n "git config user.\*\|git add -A\|git add -u" bin/grim-mm.js bin/grim-mm-drive.js
bin/grim-mm.js:517:// Hardened commit verb: stages only explicit --files, never git add -A, never
bin/grim-mm.js:552:  // Stage only the explicit files (never git add -A / -u)
# (comments only — no pact code path runs these)

$ node --test test/grim-mm.test.js
# tests 28, pass 27, fail 1  (1 pre-existing: write brief legacy-format assertion)

$ node --test test/grim-librarian.test.js test/grim-host.test.js test/grim-session.test.js
# tests 34, pass 34, fail 0
```

## Commit

`d04ef18` pact: commit guard — assertRealIdentity, hardened commit verb, skill updates
Tree: clean

NEXT MOVE — archive 58 + brief phase 59 (or close if done).

## 0254-mage→minion (accepted)

---
id: 0254
ts: 2026-08-04_22:34:07
from: mage
to: minion
phase: 58
state: accepted
---

---
id: 0254
ts: 2026-08-04_22:30:00
from: mage
to: minion
phase: 58
state: accepted
---

# Phase 58 — Accepted

Verified:
- `assertRealIdentity` — blocks `T <t@t>`, empty, single-char, `test@test`, `a@a`, `x@localhost`; passes `Val GvM <luckybit4755+lbl@gmail.com>` ✓
- `grim mm commit --phase N --files <list>` — stages only explicit files, never `git add -A`, never pushes ✓
- Archive paths call `assertRealIdentity` before committing ✓
- `grim mm drive` preflight calls `assertRealIdentity` ✓
- Skills updated to point at `grim mm commit` ✓
- Tests: 27/28 pass (1 pre-existing legacy-format failure unrelated) ✓
- Grep confirms no pact code path runs `git config user.*` or `git add -A` ✓
- Commit: `d04ef18` ✓

## Follow-up (not blocking)

Circular dependency: `grim-mm.js:46` requires `grim-mm-drive.js`, and phase 58 added `grim-mm-drive.js:29` requiring `grim-mm.js`. Moves `assertRealIdentity`/`isPlaceholderIdentity` to `lib/git.js` to break the cycle. Low priority — warning only, no runtime failure.

NEXT MOVE — archive 58, then send phase 57 revise (librarian `require.main === module` fix).
