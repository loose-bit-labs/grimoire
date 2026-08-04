# Phase 57 — `grim librarian`: the KB durability cadence

**Authority:** hierophant, 2026-08-04. **Repo:** grimoire. **Track O (grimoire HA / no-SPOF), piece 1.**
Deterministic mechanics — this is a **script**, not a skill (Rule 13). No model judgment needed.

## What happened

aid is a single point of failure for the whole fleet, and its **data-loss** mode was found
live: the KB (`/home/vgvm/data/grimoire-kb`, resolved via `config.root`) had **513 uncommitted
files** (501 brand-new entities + 12 updates) and the code repo had 20 unpushed commits — because
nobody ever set a push cadence, so it defaulted to *never*. A one-shot manual commit can't hold
the line either: within ~30s of committing, the running server wrote a **new entity** and rebuilt
`indexes/graph.json`. The KB is a *continuously-written* store, so durability has to be a
**cadence**, not a heroic manual sweep.

The 513-file backlog is already committed + pushed by hand (2026-08-04). This phase makes it never
happen again.

## Scope discipline (read first)

**v1 is durability ONLY.** Commit + push the KB on a cadence. The word "librarian" invites
*curation* (prune stale/failed dream entities, dedup, fix stale paths — all real, all visible in
the KB's `chore:` history) — **do not build that here.** Durability must not depend on riskier
curation logic. Curation is a separate v2 pass under the same command later. v1's one job:
*the KB is never more than one cycle behind its remote.*

## What lands

1. **`bin/grim-librarian.js`**, dispatched from `bin/grim.js` as `grim librarian` (subcommand
   `commit`, default). Pure mechanics:
   - Resolve the KB path from `config.root` (via `lib/env.js`) — **never hardcode** the path.
   - `git status --porcelain` the KB. If nothing meaningful changed → exit 0 quietly (**no empty
     commits**).
   - Else: `git add -A`, commit with a **code-generated** message — count `^??` (new) and `^ M`
     (updated) lines: `kb: N new, M updated (librarian YYYY-MM-DD)`. No model call.
   - `git push`. On failure (aid offline / no network / auth) → **log a warning, exit non-zero but
     do not throw/crash**; the next cycle retries. **Never `git push --force`.**
   - KB repo only. **Do not touch the grimoire code repo** — code rides the pact/review push flow,
     not a robot.
2. **Nightly user systemd timer on aid** — `deploy/` gets `grim-librarian.service` (Type=oneshot,
   runs `%h/.grimoire/bin/node bin/grim-librarian.js commit`) + `grim-librarian.timer`
   (`OnCalendar=*-*-* 03:00`, `Persistent=true`). House convention: pinned `%h/.grimoire/bin/node`
   + `~/.grimoire` symlink (mirror `grim-rig`/telemetry units). A `deploy/setup-librarian.sh` (or a
   hook in the existing client/telemetry setup) installs + enables it. **aid only** — that's where
   the KB lives; clients have no `config.root`.
3. **`grim save` hook** — at the end of the SAVESTATE lifecycle (`bin/grim-session.js`), call the
   librarian commit **best-effort, non-fatal** (a failed push must never break `grim save`). Nightly
   is the floor; session-end is when new knowledge actually lands, so this closes most of the loss
   window for near-zero cost.
4. **Decide `indexes/graph.json`.** It's derivable (rebuilt by `scribe`, like the already-ignored
   `indexes/vectors/`) and it churns on every write. **Preferred: add it to the KB `.gitignore`**
   so the librarian stops committing pure churn; `scribe` rebuilds it on load. If there's a load-time
   reason it must be tracked, keep committing it but note why. Small call — make it and say which.

## Out of scope / do NOT

- **No curation** (no pruning, dedup, path-fixing, re-describe) — v2, separate.
- **No live/debounced-on-write replication** — nightly + on-save is plenty at this scale; don't
  build a filesystem watcher.
- **No warm-standby / failover-locator** — those are Track O pieces 2 & 3, separate phases.
- Don't auto-push the **code** repo. Don't `--force`. Don't invent a new lock protocol; if a commit
  occasionally catches a mid-rebuild `graph.json`, that's harmless and self-heals next cycle.

## Success checks

- `grim librarian commit` on aid with a dirty KB → one commit with an accurate `N new, M updated`
  message, pushed; working tree clean afterward. With a clean KB → exits 0, **no commit created**.
- Push failure path (simulate: unreachable remote) → warns, non-zero exit, **no crash, no
  `--force`**, KB left committed locally for next-cycle retry.
- Timer installed + enabled on aid (`systemctl --user list-timers` shows `grim-librarian.timer`);
  a manual `systemctl --user start grim-librarian.service` runs the commit.
- `grim save` triggers a best-effort librarian commit; a forced push failure does **not** fail the
  save.
- `indexes/graph.json` decision made and reflected (either in `.gitignore` or a one-line note).
- Footprint: `bin/grim-librarian.js`, `bin/grim.js` dispatch, `deploy/grim-librarian.{service,timer}`
  + setup wiring, `bin/grim-session.js` save hook, a test for the commit-message counter + the
  skip-when-clean + push-failure-non-fatal behavior, KB note.
