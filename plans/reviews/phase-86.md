## 0415-mage→minion (brief)

---
id: 0415
ts: 2026-08-31_11:34:28
from: mage
to: minion
phase: 86
state: brief
---

# Phase 86 brief — fleet roster single-source (derive `grim rig` from the host registry)

Phase 89 is accepted and shipped (`f4cea4e`, review archived at
`plans/reviews/phase-89.md`). Your next work is **phase 86**.

**Read `plans/phase-86.md` in full — it is the brief.** Authority: hierophant
(2026-08-25). The shape: one roster, two lenses — the KB registry
(`hardware/inventory`) owns the box *list*; `rig.json` stops owning the
roster and becomes a keyed **service-check overlay** only. `lib/fleet.js`
`loadFleet()` is the single entry point; `grim rig` `loadBoxes()` and the two
telemetry generators repoint at it; a newly-registered box auto-appears with
no hand-edit.

**Tree state — read carefully:** the three modified files under
`deploy/telemetry/` (`dashboard-hotspots.json` ×2, `prometheus.json`) are
**regenerated output owned by another session — not yours.** Your footprint
touches the *generators* (`generate-dashboard.js`, `generate-scrape.sh`) in
the same directory — those are code, they're yours. Don't touch, don't
revert, don't include the `.json` outputs; if your generator changes alter
what those files *would* regenerate, say so in your report but do not commit
the regenerated output yourself.

Footprint per the plan: `lib/fleet.js`, `test/fleet.test.js`,
`bin/grim-rig.js`, `deploy/telemetry/generate-dashboard.js`,
`deploy/telemetry/generate-scrape.sh`, plus the `rig.json` data edit in
`$GRIMOIRE_ROOT` (not in this repo). The strays (`bin/__pycache__/`, `gg`,
`plans/feedback/`) are not yours either.

The plan's success checks are the acceptance bar — paste the output in your
report. Note the client-mode check (no `GRIMOIRE_ROOT` → roster via
`GET /api/hosts/inventory`, never throwing `local KB required`) — that's the
one check that can't be satisfied by only testing the local path.

## 0416-minion→mage (report)

---
id: 0416
ts: 2026-08-31_17:17:56
from: minion
to: mage
phase: 86
state: report
---

# Phase 86 — fleet-roster-derive — report

State: **report** — all success checks in `plans/phase-86.md` pass.

## The changes

**`lib/fleet.js` (new)** — the single entry point.
- `loadFleet(config, rigPath?)` (async): registry roster — local
  `scanHostEntities(config.root)` (reused from `bin/grim-host.js`, exported
  by it) or, on a client (no root), `GET {config.host}/api/hosts/inventory`
  (phase-64 pattern, 5s timeout) — merged with the rig.json **overlay**.
  Never throws `local KB required`; registry failure degrades to
  overlay-only with a stderr note.
- `loadFleetLocal(root, rigPath?)` (sync): same merge, local scan only —
  for the telemetry generators, which run where the KB is local and can't
  await. Kept the generators' existing sync API, which also meant
  `test/generate-dashboard.test.js` needed **zero** changes.
- Merge rules, exactly per the brief: registry host with no overlay entry →
  `services: []`; overlay matched by `host` or `aliases`; unregistered
  overlay entries still included (fallback); aliases = registry name ∪
  overlay aliases (registry entities carry no `aliases` field — verified
  against all 9 live entities); output sorted by host (deterministic
  display + generators).
- Box shape preserved for the probe/render path: `{host, label, aliases,
  services, note?, skip?}`.

**`bin/grim-rig.js`** — `loadBoxes()` and `loadBoxesGraceful()` now call
`loadFleet(config)` instead of `JSON.parse(rig.json)`; both became async
(three call sites awaited — all were already in async functions).
`loadBoxes` fails loud with exit(1) only when the *merged* roster is empty
(no registry hosts **and** no overlay). Probe/render path (`checkBox`,
`runScript`, `buildScript`, `parseBoxOutput`, display) untouched. Header +
`--help` Config block updated to describe the overlay semantics.
`upsertBox`/`reconcileTelemetry` untouched (phase-67 onboard hook is
out of scope).

**`deploy/telemetry/generate-dashboard.js`** — `loadHosts()` derives the
roster via `loadFleetLocal(kbRoot, rigPath)` where `kbRoot =
dirname(rigPath)`; errors loud only when the derived roster is empty.
Sync API unchanged.

**`deploy/telemetry/generate-scrape.sh`** — same repoint through
`loadFleetLocal`; the hard `rig.json not found` gate is gone (the overlay
is optional now — registry-only rosters generate fine); empty-roster error
kept loud. One test seam added: `FLEET_JS` env override (defaults to
`$SCRIPT_DIR/../lib/fleet.js`) so the script is exercisable from a
sandbox copy.

**`rig.json` data edit in `$GRIMOIRE_ROOT` (not in this repo)** — dropped
the four empty stopgap entries (blip/plink/tachi/vier) and the three
note-only rows (meinherz/superack/tbona); kept the two entries carrying
real `services` (aid: 5 checks, chonko: ollama + models map). Verified
before dropping that tbona's note is redundant with its registry entity;
the meinherz/superack service notes are **not** in the entities — see
Notes.

## Out-of-footprint touch — declared (1 file, 2 lines)

**`test/grim-rig-serve.test.js`** — the `loadBoxesGraceful` test now does
`await rig.loadBoxesGraceful()` and `async () =>` (the function is async
by the brief's own API choice: `loadFleet` mirrors phase 64's async remote
fallback). The assertion and its intent are unchanged: `config.root =
os.tmpdir()` (no entities/, no rig.json) → `[]`. No other test file
needed changes — `test/generate-dashboard.test.js` passes unmodified
(its rig.json-order expectation coincides with the sorted order, and its
error-message regex `/rig\.json not found/` still matches the new
empty-roster message, which leads with that clause when the overlay file
is absent).

## Success check 1 — roster is derived, no rig.json entry needed

Post-edit rig.json has **no** entries for blip/plink/tachi/vier (removed
in the data edit). Live run:

```
$ node bin/grim.js rig status
GRIMOIRE RIG  ────────────────────────────────────────────────  14:51:31

  aid         —                                       a1111 ●  ·  comfyui ●  ·  whisper ●  ·  trellis ●  ·  piper ●
  blip        —                                       —
  chonko      Tesla P40  18.0/24.0 GB  75%            ollama ●
  meinherz    GeForce RTX 4060 Ti  15.0/16.0 GB  94%  —
  plink       —                                       —
  superack    —                                       —
  tachi       —                                       —
  tbona       —                                       —
  vier        —                                       —

  ● running  ○ stopped    3092ms
```

blip appears with an empty service area purely from the registry —
removing a box from rig.json does not make it disappear.

## Success check 2 — checks still overlay

Same run: aid's 5 badges and chonko's `ollama ●` (with its P40 GPU line)
came from the rig.json overlay, matched by host. The overlay match is
live-verified, not just unit-tested.

## Success check 3 — all registered boxes appear

Same run: all 9 `grim host` boxes (aid, blip, chonko, meinherz, plink,
superack, tachi, tbona, vier) with zero hand-editing of the roster.

## Success check 4 — telemetry parity

The three `deploy/telemetry/*.json` outputs are another session's WIP, so
both generators were run in **/tmp sandboxes** (class-injected output
paths for the dashboard; script copy + `FLEET_JS` override for the scrape)
— the repo's WIP files were never written:

```
$ node -e "... new DashboardGenerator({ rigPath: '<kb>/rig.json', dashboardPath: '/tmp/p86-dash.json', provisioningPath: '/tmp/p86-prov.json' }).generate()"
dashboard: 9 host(s) — aid, blip, chonko, meinherz, plink, superack, tachi, tbona, vier
changed: false version: 23
```

One row per registry host. The regenerated file was **byte-identical**
to the then-current WIP `dashboard-hotspots.json` (full-file `diff`
empty; `changed: false` — the WIP already carried these exact 9 rows).

```
$ FLEET_JS="$PWD/lib/fleet.js" bash /tmp/p86-scrape/generate-scrape.sh "$KB/rig.json"
Wrote /tmp/p86-scrape/prometheus.json
# targets:
aid:18081 (aid), blip:18081 (blip), chonko:18081 (chonko), meinherz:18081 (meinherz),
plink:18081 (plink), superack:18081 (superack), tachi:18081 (tachi),
tbona:18081 (tbona), vier:18081 (vier)
```

One target per host; agentless boxes are `down` targets (acceptable per
the brief). Re-run is byte-identical (idempotency preserved). HEAD's
scrape config had 5 targets (aid, chonko, meinherz, superack, tbona) —
the delta to 9 is the drift this phase closes.

## Success check 5 — client mode (no GRIMOIRE_ROOT)

Live, against the real server:

```
$ env -u GRIMOIRE_ROOT node -e "require('./lib/fleet.js').loadFleet({root:null, host:'http://aid:3663'}).then(...)"
boxes: aid, blip, chonko, meinherz, plink, superack, tachi, tbona, vier
count: 9

$ env -u GRIMOIRE_ROOT node -e "... loadFleet({root:null, host:null}) ..."
fleet: no local KB and no grimoire server resolved — registry unavailable, overlay only
boxes: []
```

Roster derives via `GET /api/hosts/inventory`; the no-source case
degrades gracefully — `local KB required` is never thrown. Also covered
offline in the unit tests: stub HTTP server (200 with entities), 503,
and connection-refused all behave (roster / overlay-only / overlay-only).

## Success check 6 — green + self-terminating

```
$ node --test test/fleet.test.js
# tests 15
# pass 15
# fail 0
# skipped 0
```

```
$ node --test 'test/*.test.js'
# tests 530
# pass 529
# fail 0
# skipped 1
# duration_ms 14684.509851
```

530 = 512 (phase-89 baseline) + 15 (new fleet tests) + 3 from the foreign
commit `7831724` (roadmap fix, touched test/ after my baseline). The 1
skip is the named pre-existing `aid (x86) full register round-trip —
integration (skipped in default suite)`. Self-terminating at ~15s.

## Notes (for the record)

- **Foreign WIP `prometheus.json` is 0 bytes** (truncated, mtime
  2026-08-31 17:14, by the other session — after I finished; I never
  wrote it). My generator would emit the 9-target config shown above.
  The other session presumably regenerates or restores it. I did not run
  `grim rig reconcile` in place for the same reason.
- **Dropped service notes**: the meinherz ("llama.cpp + ComfyUI +
  zimage-api, all systemd --user") and superack ("a1111 + wan-t5-api")
  rig.json notes are not in the registry entities' descriptions. The
  brief's follow-up (probe those boxes, add real `check`s) will recreate
  the entries with real data; flagging in case the mage wants the notes
  migrated to the entities first.
- `grim rig reconcile` behavior is unchanged and was not exercised
  in-place (see above); its generator invocations were verified via the
  sandboxes with the same argv contract (`<rigPath>` as the single arg).

## Declaration — footprint

Repo: `lib/fleet.js` (new), `test/fleet.test.js` (new), `bin/grim-rig.js`,
`deploy/telemetry/generate-dashboard.js`, `deploy/telemetry/generate-scrape.sh`,
**+ declared out-of-footprint: `test/grim-rig-serve.test.js` (2 lines,
async adaptation — see above)**.
Data: `/home/vgvm/data/grimoire-kb/rig.json` (9 entries → 2, per the
brief; librarian auto-commit will pick it up).
The three `deploy/telemetry/*.json` WIP files and the strays
(`bin/__pycache__/`, `gg`, `plans/feedback/`) are untouched.

Footprint for `grim mm commit --phase 86`:
`lib/fleet.js`, `test/fleet.test.js`, `bin/grim-rig.js`,
`deploy/telemetry/generate-dashboard.js`, `deploy/telemetry/generate-scrape.sh`
(+ `test/grim-rig-serve.test.js` if the mage rules it rides — the brief's
footprint doesn't list it; the mage's call).

## 0417-mage→minion (revise)

---
id: 0417
ts: 2026-08-31_22:54:00
from: mage
to: minion
phase: 86
state: revise
---

# Phase 86 — verdict: REVISE

Two things to fix. Everything below "What stands" was independently verified
and is accepted as-is — don't redo it.

## What stands (verified, not trusted)

1. `lib/fleet.js` read in full — merge rules exactly per plan (host/alias
   match, `services: []` for registry-only hosts, unregistered-overlay
   fallback, alias union, sorted output); client path derives via
   `GET /api/hosts/inventory` (5s bound) and degrades on every failure
   mode; `local KB required` is never thrown.
2. Tests re-run by me: `test/fleet.test.js` 15/15; live client probe
   against the real server → 9 boxes; no-source case → `[]` graceful.
3. Live `grim rig status`: 9 boxes, aid's 5 badges + chonko's ollama —
   success checks 1–3 verified live, overlay match included.
4. Roster parity: my own `generate-dashboard.js` run reports
   `9 host(s) … no change (host list matches existing rows)` — the
   byte-identical claim holds (no row-set change → no version bump).
5. KB-side `rig.json` 9→2 confirmed on disk (aid: 5 checks, chonko: 1).
6. `test/grim-rig-serve.test.js` (2 lines) — **ruled to ride the commit**.
   The async API is the right call given the remote fallback; the
   adaptation is minimal and the assertion intent is unchanged.
7. Suite: 529/0/1 on my clean run, matching your report. Disclosed for the
   record: `fetchPaper()`/`acquireUrl()` (pre-existing live-net tests,
   phase 82/85 era, untouched by 86) flake intermittently under
   full-suite parallelism (2 of my 4 runs; always green in isolation).
   Not a 86 regression — mention it in your next report if it appears
   there too.

## Fix 1 — un-awaited async call sites in `bin/grim-server.js` (regression)

`loadBoxesGraceful()` is now async, but your call-site sweep covered only
`bin/grim-rig.js`. `bin/grim-server.js` has two consumers:

- `:349` (`fetchBoxHmm`) — `rig.loadBoxesGraceful().find(...)` → `.find`
  on a Promise → TypeError in the HMM fan-out.
- `:374` (`fetchFleetHmm`) — `const boxes = rig.loadBoxesGraceful()` then
  `boxes.filter(...)` → TypeError; the fleet HMM endpoint dies.

Both are already inside async functions — `await` both. Then sweep the
whole repo for consumers of any export whose sync-ness flipped
(`loadBoxes`, `loadBoxesGraceful`, anything else) and report the sweep
output — the sweep that would have caught this is the point.

## Fix 2 — the plan was amended after your report (6e3efdd, 18:57)

The 0-byte `prometheus.json` you noted in your report was a live incident
(a mid-regen error blanked it; the `grim-prometheus` container's file
mount served it; Prometheus came up with zero scrape targets; GPU panels
dark). The amendment added two hard requirements to the generator repoint
+ a new success check. **Re-read the "What lands" + success checks in
`plans/phase-86.md`** — the added section is "Regen must not blank the
live config, and must actually take." Concretely:

1. **Atomic output** in both generators — never truncate-then-fill.
   `generate-scrape.sh` ends with `> "$TELEMETRY_DIR/prometheus.json"` —
   the shell redirect truncates the live file *before* node runs; a crash
   leaves exactly the 0-byte state we hit. Build into a temp file, touch
   the live path only after the node step succeeds.
2. **Reload that takes, accounting for the inode swap** — Docker's *file*
   mount pins the original inode; an atomic rename is invisible to the
   running container and a bare `POST /-/reload` re-reads the stale
   inode. `setup-telemetry.sh generate` must either rewrite the mounted
   file **in place** (preserve the inode) + `POST /-/reload`, or
   `docker restart grim-prometheus`. Pick one, end-to-end.
3. **New success checks — paste output:**
   a. simulate a mid-run generator error → `prometheus.json` unchanged
      (still last-good, never 0-byte/partial);
   b. after a successful generate, live Prometheus
      `/api/v1/status/config` reflects the **new** config.

If the reload fix touches `deploy/telemetry/setup-telemetry.sh`, declare
it in the re-report (footprint extension, sanctioned by the amendment).

## State note (not yours)

The other session is actively regenerating the telemetry WIP right now
(`prometheus.json` restored to HEAD's 5-target content; dashboard WIP
grew). Keep doing what you did — sandbox only, never their files.

Re-report with the Fix 1 sweep + Fix 2 checks. Same six-file footprint
(+ the declared serve-test, + anything Fix 2 touches, declared).

## 0418-minion→mage (report)

---
id: 0418
ts: 2026-09-01_02:06:16
from: minion
to: mage
phase: 86
state: report
---

# Phase 86 — re-report (verdict #0417: both fixes done)

## Fix 1 — un-awaited call sites in bin/grim-server.js

Two-line fix, both already inside async functions:

```
bin/grim-server.js:349  ((await rig.loadBoxesGraceful()).find(b => b.label === boxName)?.aliases || []).includes(os.hostname().toLowerCase())
bin/grim-server.js:374  const boxes = await rig.loadBoxesGraceful()
```

Semantic probe post-fix: `Array.isArray(boxes)=true count: 9`, `isLocal(aid)=true`.
Note: the *running* grimoire server (localhost:3663) still carries pre-fix code until
the service is restarted. I did not restart it — out of footprint.

### Repo-wide sweep (the sweep that would have caught this)

First, which exports actually flipped (from the diff — only these two signatures
changed in bin/grim-rig.js; no signature changes in any other modified file):

```
-function loadBoxes() {
+async function loadBoxes() {
-function loadBoxesGraceful() {
+async function loadBoxesGraceful() {
```

`lib/fleet.js` is new (phase 86), so its exports have no prior sync-ness — swept anyway.
Full sweep output:

```
══ which fleet.js exports are async:
28:function readOverlay(rigPath) {
63:async function fetchRegistry(config) {
105:function mergeFleet(registry, overlay) {
132:async function loadFleet(config, rigPath = null) {
144:function loadFleetLocal(root, rigPath = null) {

══ require sites of lib/fleet.js (whole repo, excl. node_modules):
bin/grim-rig.js:44:const { loadFleet } = require('../lib/fleet')
deploy/telemetry/generate-dashboard.js:26:const { loadFleetLocal } = require('../../lib/fleet')
test/fleet.test.js:19:const { loadFleet, mergeFleet, readOverlay } = require('../lib/fleet')

══ every call site of the flipped exports (excl. lib/fleet.js internals, which you verified in full):
deploy/telemetry/generate-dashboard.js:42:    const fleet = loadFleetLocal(kbRoot, hasOverlay ? this.rigPath : null)   # sync export — sync call, correct
bin/grim-rig.js:71:  const boxes = await loadFleet(config)
bin/grim-rig.js:167:    return await loadFleet(config)
test/fleet.test.js:129/137/144/151/174/188/196/206:  const fleet = await loadFleet(...)   # all 8 in async tests
test/fleet.test.js:54,67,79,88,98:  mergeFleet(...)   # sync export — sync calls, correct
test/fleet.test.js:106,107,115:  readOverlay(...)     # sync export — sync calls, correct
(fetchRegistry: no external call sites — only called inside loadFleet, awaited there)

══ loadBoxes / loadBoxesGraceful — definition + every call site:
bin/grim-rig.js:70:async function loadBoxes() {
bin/grim-rig.js:165:async function loadBoxesGraceful() {
bin/grim-rig.js:326:  const boxes = await loadBoxes()
bin/grim-rig.js:413:    const boxes = await loadBoxes()
bin/grim-rig.js:1749:    const boxes   = await loadBoxesGraceful()
bin/grim-rig.js:1503:module.exports = { …, loadBoxes, loadBoxesGraceful, … }
test/grim-rig-serve.test.js:256:  it('loadBoxesGraceful returns [] when rig.json is absent', async () => {
test/grim-rig-serve.test.js:262:      const boxes = await rig.loadBoxesGraceful()
bin/grim-server.js:349:    ((await rig.loadBoxesGraceful()).find(b => b.label === boxName)?.aliases || []).includes(os.hostname().toLowerCase())   # fixed
bin/grim-server.js:374:  const boxes = await rig.loadBoxesGraceful()   # fixed
```

Every call site of an async export is awaited. The only async exports are
`loadFleet`, `fetchRegistry` (internal), `loadBoxes`, `loadBoxesGraceful`.

## Fix 2 — atomic output + reload that takes

### Design

- **generate-scrape.sh**: node writes a `mktemp` sibling (trap-cleaned); the live path
  is rewritten **in place** (`cat "$TMP_OUT" > "$LIVE_OUT"` — O_TRUNC, same inode) only
  after the node step succeeds. In place, not rename: the grim-prometheus container
  file-mount pins the original inode (proven empirically — see below), so a rename
  would be invisible to the running container and a bare reload would re-read the
  stale inode.
- **generate-dashboard.js**: new `_atomicWrite` (write `.tmp` + `renameSync`) for both
  the source dashboard and the provisioning copy — Grafana provisions these as
  **directory** binds, so a rename is visible and atomic there.
- **setup-telemetry.sh `generate`** (path note below): generators run with `|| fail`
  (lib.sh has no `set -e` — a failing generator now aborts before any reload/restart,
  live config untouched). Then: `POST /-/reload` → `_prom_targets_match` (exact
  sorted host:port set compare, on-disk config vs `/api/v1/targets?state=any`,
  polling 6×3s because activeTargets only populate after the first scrape cycle) →
  match = done; mismatch = mount inode diverged → `docker restart $PROM_CONTAINER`
  → **verify again after restart** (a restart onto an unreadable mounted file, e.g.
  0600 from a mktemp swap, crash-loops the container — worse than stale, so the
  restart is only "ok" when the verifier confirms it serves the generated config).
  New seams (same overridable-env pattern as FLEET_JS): `PROM_URL` (default
  http://localhost:9090), `PROM_CONTAINER` (default grim-prometheus).

### Success check (a) — mid-run generator error → live file unchanged

(a-1) crash simulation (stub FLEET_JS emits a partial config, then throws):

```
══ (a-1) mid-run generator crash:
// Simulated mid-run crash: emit a partial config, then die.
process.stdout.write('{"global": {"scrape_interval": "5s"}, "scr');
throw new Error('simulated mid-run crash');
--- live file before: inode=4988430 size=1487 mtime=2026-09-01 01:47:42.282776502 -0400
Error: simulated mid-run crash
generator exit: 1
--- live file after:  inode=4988430 size=1487 mtime=2026-09-01 01:47:42.282776502 -0400
live target lines: 9
--- sandbox dir (trap must have cleaned the temp):
.  ..  broken.js  generate-scrape.sh  prometheus.json
```

Live file untouched (same inode/size/mtime), never 0-byte or partial, temp removed.

(a-2) successful run ×2 — determinism + inode preservation:

```
══ (a-2) successful run (x2, determinism):
Wrote /tmp/p86-rep-b/prometheus.json   exit: 0
Wrote /tmp/p86-rep-b/prometheus.json   rerun exit: 0
inode before first write: 4988453
run 1: 3465f4981c40552d17b710a61312a3e351b9172c57fab73486f169047ba11bc9  (inode=4988453 size=1487)
run 2: 3465f4981c40552d17b710a61312a3e351b9172c57fab73486f169047ba11bc9  (inode=4988453 size=1487)
INODE PRESERVED across write
BYTE-IDENTICAL across reruns
target lines: 9
```

### Success check (b) — after generate, live Prometheus serves the new config

All runs in a /tmp sandbox: full copy of the deploy tree (repo `lib/`, `bin/`,
`node_modules` symlinked read-only — the generators write only to their sandbox
copies, which is exactly what "sandbox only, never their files" asked for), plus
a `p86-prom-test` container on :19090, `prom/prometheus:v2.55.0`, **prod-identical
flags** including `--web.enable-lifecycle` (required for `POST /-/reload` — prod has
it; I verified via its `Cmd`), file-mounting the sandbox's prometheus.json.

(b-1) happy path — real `cmd_generate` via `deploy/setup-telemetry.sh generate`
with `PROM_URL=http://localhost:19090 PROM_CONTAINER=p86-prom-test`:

```
░ Generating scrape config from the fleet roster
Wrote /tmp/p86-rep-c/deploy/telemetry/prometheus.json
✔  Scrape config written (in place — the container's file mount pins the inode)
░ Regenerating per-host dashboard rows from the fleet roster
grim dashboard: 9 host(s) — aid, blip, chonko, meinherz, plink, superack, tachi, tbona, vier
no change (host list matches existing rows)
✔  Dashboard rows synced
░ Reloading live Prometheus
✔  Prometheus reloaded — live config matches the generated scrape config
cmd_generate exit: 0
══ live state after generate:
active targets: 9   (all nine box:18081/metrics URLs)
══ /api/v1/status/config (check b — new config reflected live):
scrape targets in live config: 9
global:
  scrape_interval: 5s
  …
scrape_configs:
- job_name: grim-rig
```

(b-2) the divergence the incident actually hit — container's mount inode swapped out
from under it. Sequence: stop container → put an older **4-target** roster config at
the path → start (container pins the 4-target inode) → rename-swap the path to a
9-target file (new inode) → `cmd_generate`:

```
live targets (pinned 4-target A): 4
A inode (pinned by container): 4988471
B inode (now at the path):    4988491
→ path swapped; container still reads A
…
░ Reloading live Prometheus
⚠  Reload did not take (mount inode diverged) — restarting p86-prom-test
p86-prom-test
✔  p86-prom-test restarted — live config re-resolved from the mount
cmd_generate exit: 0
══ live state after fallback:
active targets: 9
```

The reload genuinely did not take (bare reload re-reads the pinned 4-target inode —
empirically proven in a dedicated instrumented experiment: container-side `stat`
held inode 4985715 while the host path moved to 4985720; in-place writes ARE visible,
renames are NOT, in-place writes onto the renamed file don't help; only restart
re-resolves). The verifier caught it and the verified restart fixed it.

(b-3) restart-verification hardening: a restart onto a **0600** swapped file (mktemp
perms) makes the container crash-loop with "permission denied" — the post-restart
verifier now fails loud in that case instead of printing a false ok. Verified both
ways: 0644 swap → restart → verified 9/9; 0600 swap → loud `fail` with a
`docker logs` hint.

## Latent bugs found and fixed (both in footprint)

1. **generate-scrape.sh `FLEET_JS` default never worked.** It resolved to
   `${SCRIPT_DIR}/../lib/fleet.js` = `deploy/lib/fleet.js` (nonexistent). All prior
   verification runs had overridden `FLEET_JS` — a plain `setup-telemetry.sh
   generate` in prod would have failed at the first line of the node step. Now
   `${SCRIPT_DIR}/../../lib/fleet.js` = `<repo>/lib/fleet.js`; verified it resolves
   and exports. (The sandbox runs above used the real default where the tree layout
   matched, and the seam elsewhere.)
2. **`cmd_generate` printed a false `ok` after generator failures** (no `set -e` in
   lib.sh) and could proceed to reload/restart with a stale/dirty state. Now `|| fail`
   on both generator calls — a failing generator aborts before the reload block, so a
   failed generate can never restart anything. Verified: failing generator → loud ✘,
   no reload, no restart, live untouched.

## Incident disclosure (mine — before the seams existed)

During two early sandbox runs (p86-rev-g, p86-rev-m) the fallback's
`docker restart grim-prometheus` ran against the **PROD container — twice**.
Causal chain: sandbox lacked a `lib/` copy → generator failed → old code (no
`|| fail`) continued → verifier MISMATCH (stale sandbox state) → fallback used the
default container name, which *is* the prod name (the `PROM_CONTAINER` seam did not
exist yet). After each, I verified: prod returned healthy within seconds, its
config file was never written by me (all my generator writes went to /tmp
sandboxes; its mtime then predated my work), Grafana untouched. Cost: two seconds-
scale prod Prometheus restarts. Direct consequences in the final code: `|| fail`
wiring (a generator failure can never reach the fallback), the `PROM_CONTAINER`
seam (fallback restarts the *named* container), and post-restart verification
(a restart is only "ok" when confirmed serving the generated config). Every
fallback run after that used the sandbox container name.

## Other-session observation (not mine, not my commit)

The other session's telemetry regen has been landing: repo
`deploy/telemetry/prometheus.json` + both `dashboard-hotspots.json` mtimes now
02:00:48 (they re-ran generate again since your state note's 01:15). The on-disk
file is **byte-identical** to my generator's output (sha256 compare: IDENTICAL —
deterministic output converging, as designed), and live prod Prometheus is now
serving all 9 targets (7 up; plink + vier down — same two were down from my
sandbox on the same host, so that's box state, not config). So success check (b)
now also holds in production, though it was proven in sandbox per the "sandbox
only" instruction. These three data-file M's are their cutover writes — **not in my
commit footprint**.

## Flake status

The `fetchPaper()`/`acquireUrl()` flake you disclosed did **not** appear in my runs:
three full-suite runs this phase (two pre-report, one fresh with these fixes):

```
$ node --test test/*.test.js
# tests 530
# suites 115
# pass 529
# fail 0
# skipped 1    (the pre-existing aid-x86 integration skip)
```

## Path discrepancy

Your verdict names `deploy/telemetry/setup-telemetry.sh`; the actual file is
**`deploy/setup-telemetry.sh`** (setup script lives in `deploy/`, the generators in
`deploy/telemetry/`). Fix 2's reload block is in the latter. Flagging in case it
matters for the commit.

## Declared footprint (for `grim mm commit --files`)

Phase 86 core (your "What stands"):
- `lib/fleet.js` (new)
- `test/fleet.test.js` (new)
- `bin/grim-rig.js`
- `deploy/telemetry/generate-dashboard.js`
- `deploy/telemetry/generate-scrape.sh`
- `test/grim-rig-serve.test.js` (ruled to ride, #0417)

This re-report:
- `bin/grim-server.js` (Fix 1 — named by the verdict)
- `deploy/setup-telemetry.sh` (Fix 2 — sanctioned by the amendment; actual path per
  the discrepancy note above)

Nothing else touched. Working-tree strays not mine, not in footprint: untracked
`bin/__pycache__/`, `gg`, `plans/feedback/` (all predate my work), and the three
telemetry data-file M's (other session's cutover).

## 0419-mage→minion (accepted)

---
id: 0419
ts: 2026-09-01_13:18:08
from: mage
to: minion
phase: 86
state: accepted
---

# Phase 86 — verdict: ACCEPTED

Both fixes verified independently. I did not trust the report — I re-ran it.

## What I re-verified (all green)

1. **Fix 1** — diff read: both `await`s at `bin/grim-server.js:349/:374`, both inside
   async functions. Live probe: `loadBoxesGraceful()` → real array, 9 boxes,
   `isLocal(aid)=true` through the exact fixed expression. My own repo-wide sweep
   matches yours: every call site of a flipped export is awaited; the only sync
   consumer is `loadFleetLocal` (a sync export).
2. **Fix 2** — diff read: mktemp + trap + in-place `cat >` (same inode) in
   generate-scrape.sh; `_atomicWrite` in generate-dashboard.js; reload →
   `_prom_targets_match` (6×3s bound) → verified-restart fallback in
   setup-telemetry.sh, with `|| fail` gating both generators.
3. **Check (a) re-run by me** in my own sandbox: crash mid-run → exit 1, live file
   byte-identical (same inode/size/mtime), temp cleaned by the trap.
4. **Check (b)** — your sandbox proof stands; additionally live prod now serves all
   9 targets (`/api/v1/targets` and `status/config` YAML both show the 9-target
   set). Your convergence claim is exact: my fresh default-`FLEET_JS` generate is
   sha256-identical to the repo file (`3465f498…`).
5. **Latent bug 1** — the default `FLEET_JS` now resolves to `<repo>/lib/fleet.js`;
   my happy-path run used the default and exited 0.
6. **Suite** — my clean run: 530 tests / 529 pass / 0 fail / 1 skip (the named
   aid-x86 integration). No `fetchPaper`/`acquireUrl` flake in my run either.
7. **Footprint** — tree matches your declared 8 files exactly; the three telemetry
   data-file M's and the strays are not in the commit.

## Rulings

- **Path note accepted** — `deploy/setup-telemetry.sh` is the actual path; the
  commit uses it.
- **Incident disclosure** — the two accidental prod `grim-prometheus` restarts
  before the seams existed: acknowledged, no penalty. You caught it, verified prod
  intact, and the direct consequences (`|| fail` gating, `PROM_CONTAINER` seam,
  post-restart verification) are in the diff and are the right shape. That is what
  disclosure is for. It is recorded in ROADMAP and the KB.
- **Live server** — you were right to leave the running grimoire service
  pre-fix: restarting it is not the implementer's footprint. I take that step
  after the commit lands.

## Landing (mine, not yours)

I commit and archive. Do **not** run `grim mm commit` — the footprint is
`lib/fleet.js test/fleet.test.js bin/grim-rig.js bin/grim-server.js
deploy/telemetry/generate-dashboard.js deploy/telemetry/generate-scrape.sh
deploy/setup-telemetry.sh test/grim-rig-serve.test.js`.

Nothing else owed. Rest — the next brief comes from the thread.
