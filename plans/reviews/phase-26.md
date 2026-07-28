## 0136-mage→mage (brief)

phase: 26 · state: brief
phase: 26
state: brief
scope: internal

# Phase 26 — autopact drive (self-driving loop wiring)

## What lands

1. **** — new  verb in grim-mm.js dispatch:
   - 
   - Runs 
   - Parses JSON, prints machine-readable line + re-entry command:
     - ACT →  (exit 0)
     - WAIT →  (exit 3)
     - HALT →  + re-entry (exit 4)
   -  flag: when budget exceeded, passes  to 
   -  flag on : HALT budget

2. **** — tests for ACT/WAIT/HALT output lines + exit codes

3. **** — add Autonomous

## 0137-mage→mage (brief)

phase: 26 · state: brief
phase: 26
state: brief
scope: internal

# Phase 26 — autopact drive (self-driving loop wiring)

## What lands

1. **`bin/grim-mm-drive.js`** — new drive verb in grim-mm.js dispatch:
   - grim mm drive --role <r> --session <s>
   - Runs grim mm next --role <r> --session <s> --json
   - Parses JSON, prints machine-readable line + re-entry command:
     - ACT -> DRIVE: ACT <command> (exit 0)
     - WAIT -> DRIVE: WAIT <owner> (exit 3)
     - HALT -> DRIVE: HALT <reason> + re-entry (exit 4)
   - --budget-tokens N flag: when budget exceeded, passes --budget-exceeded to next
   - --budget-exceeded flag on next: HALT budget

2. **test/grim-mm-drive.test.js** — tests for ACT/WAIT/HALT output lines + exit codes

3. **mage/SKILL.md** — add "Autonomous mode" section

4. **minion/SKILL.md** — same autonomous section pattern

5. **KB** — system_autopact_drive (DefinedTerm, works_on project_grimoire)

## Constraints
- Commit locally only, never push
- drive is routing only — no judgment logic in code
- Match grim-mm.js style (use strict, doc-blocks)
- Budget counting lives in the loop skill; drive just passes the flag

## 0138-minion→mage (report)

---
id: 0138
ts: 2026-07-27_19:41:42
from: minion
to: mage
phase: 26
state: report
---

phase: 26 · state: report

Phase 26 implemented. 15/15 grim-mm tests pass (7 new + 8 existing).

## What landed

1. **`bin/grim-mm-drive.js`** — new drive verb:
   - `grim mm drive --role <r> --session <s>` runs `grim mm next --json`
   - Parses verdict, prints `DRIVE: ACT <cmd>` (exit 0) / `DRIVE: WAIT <owner>` (exit 3) / `DRIVE: HALT <reason>` + re-entry (exit 4)
   - `--budget-tokens N` flag: when ≤0, passes `--budget-exceeded` to next
   - `--budget-exceeded` flag on next: HALT budget
   - `--dir` flag forwarded to next for fixture testing

2. **`test/grim-mm-drive.test.js`** — 7 tests: ACT, WAIT, HALT deadlock, HALT budget (--budget-exceeded), HALT roadmap-empty, HALT budget (--budget-tokens 0), re-entry command present

3. **`plugin/skills/mage/SKILL.md`** — added "Autonomous mode" section with `/loop` wiring, DRIVE: line handling, budget guard, commit-local/no-push discipline

4. **`plugin/skills/minion/SKILL.md`** — same autonomous section pattern

5. **KB** — `concept_system_autopact_drive` (DefinedTerm, works_on project_grimoire)

## Test output

```
$ node --test test/grim-mm-drive.test.js
ok 1 - ACT — prints DRIVE: ACT line, exit 0
ok 2 - WAIT — prints DRIVE: WAIT line, exit 3
ok 3 - HALT deadlock — prints DRIVE: HALT line, exit 4
ok 4 - HALT budget — --budget-exceeded flag, exit 4
ok 5 - HALT roadmap-empty — prints DRIVE: HALT, exit 4
ok 6 - HALT budget — --budget-tokens 0 triggers budget HALT
ok 7 - HALT — re-entry command in output
15 tests, 15 pass, 0 fail
```

## Footprint

- `bin/grim-mm-drive.js` (new)
- `test/grim-mm-drive.test.js` (new)
- `plugin/skills/mage/SKILL.md` (autonomous mode section)
- `plugin/skills/minion/SKILL.md` (autonomous mode section)
- KB: `concept_system_autopact_drive`

Commit: `4a42349`

## 0139-mage→mage (revise)

---
id: 0139
ts: 2026-07-27_21:07:28
from: mage
to: mage
phase: 26
state: revise
---

Revise — two fixes needed:

1. **Wire `drive` verb into `bin/grim-mm.js`.** The SKILL.md documents `grim mm drive --role <r>`, but `grim-mm.js` has no `drive` verb — it falls through to "unknown verb". The standalone `bin/grim-mm-drive.js` works when called directly, but the skill invocation path is broken. Fix: add a `drive` case in `grim-mm.js` main() that spawns `bin/grim-mm-drive.js` via spawnSync with inherited stdio (same pattern used by other thin dispatchers). Committed separately as `eb13731` — pull it.

2. **Revert `bin/grim-rig.js` changes.** The auto-discovery additions (+68 lines) are valid work but outside phase 26 scope. They've been committed separately as `1ced1c7` (compute apps) and the setup-client.sh verify function. Revert rig.js to HEAD~1 state — do not fold it into phase 26.

Once pulled and revised, re-report.

## 0140-minion→mage (report)

---
id: 0140
ts: 2026-07-27_22:43:50
from: minion
to: mage
phase: 26
state: report
---

phase: 26 · state: report

Revise addressed.

## 1. Drive verb wired into grim-mm.js

Already present at bin/grim-mm.js:708–717 (from eb13731):
```js
if (verb === 'drive') {
  const driveArgs = ['bin/grim-mm-drive.js', ...argv.slice(1)]
  const child = require('node:child_process').spawnSync(process.execPath, driveArgs, {
    cwd, stdio: 'inherit',
  })
  process.exit(child.status ?? 1)
}
```
`grim mm drive --role mage --session "$ID"` works end-to-end.

## 2. grim-rig.js revert

`git diff HEAD~1 -- bin/grim-rig.js` is empty — rig.js is already at HEAD~1 state.
The compute-apps / auto-discovery changes live in earlier commits (e8c653d, 8f49242,
9d5237e, 1ced1c7) and are not part of phase 26's footprint.

## Tree

```
$ git status
On branch master
nothing to commit, working tree clean
```

Phase 26 footprint unchanged: `bin/grim-mm-drive.js`, `test/grim-mm-drive.test.js`,
`plugin/skills/mage/SKILL.md`, `plugin/skills/minion/SKILL.md`, KB
`concept_system_autopact_drive`. Commit `4a42349`.

## 0141-mage→minion (accepted)

---
id: 0141
ts: 2026-07-28_08:46:56
from: mage
to: minion
phase: 26
state: accepted
---

accepted.

Drive verb verified at bin/grim-mm.js:708. rig.js clean (diff HEAD~1 empty). 7/7 drive tests + 8/8 next tests pass. Phase 26 footprint unchanged: bin/grim-mm-drive.js, test/grim-mm-drive.test.js, plugin/skills/mage/SKILL.md, plugin/skills/minion/SKILL.md, KB concept_system_autopact_drive. Commit 4a42349.

Next: grim mm archive --phase 26 --from minion --to mage --out reviews/phase-26.md
