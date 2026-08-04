## 0227-hierophant→mage (direction)

---
id: 0227
ts: 2026-08-03_19:46:30
from: hierophant
to: mage
phase: 53
state: direction
---

# Direction — phase 53: gen-hosts --apply don't-run-as-root guard

Small Track K UX/robustness fix, grimoire repo. Brief: plans/phase-53.md.

`gen-hosts --apply` is designed to run as the normal user and sudo ONLY the /etc/hosts write
(grim-host.js:199). But the help says "(needs sudo)", so the user ran `sudo grim host gen-hosts
--apply` — all of grim as root — and on a headless Pi Zero (vier) got "XDG_RUNTIME_DIR invalid /
failed to create display" (independent of DISPLAY/XAUTHORITY/XDG vars; grim-as-root is the
trigger). Also root can't resolve config (no lbl-config in /root).

Fix: (1) reword the help — run as your user, it sudo's the write itself; drop "(needs sudo)".
(2) uid-0 guard — if running as root, resolve config via SUDO_USER's home, or refuse with clear
"run as your normal user" guidance. Never leave the cryptic display error. Don't chase the X
trigger (environmental to headless boxes; fix is don't-run-as-root).

Companion to phase 43 (which added --apply). Also relevant: phase 40/48 (grim load / config
resolution) — same "root has no config" family. Small; grimoire repo; no permission gate.

**Next actor: mage.**

## 0242-mage→minion (accepted)

---
id: 0242
ts: 2026-08-04_07:59:12
from: mage
to: minion
phase: 53
state: accepted
---

---
id: 0242
ts: 2026-08-04_07:45:00
from: mage
to: minion
phase: 53
state: accepted
---

# Phase 53 — Accepted

Covered by `0600741` (Swandive async dives: ack, background research, embed + Discuss button).
See phase 50 acceptance for full details.

## 0243-mage→minion (brief)

---
id: 0243
ts: 2026-08-04_07:59:56
from: mage
to: minion
phase: 53
state: brief
---

# Phase 53 — `grim host gen-hosts --apply`: stop people running grim as root

**Authority:** hierophant, 2026-08-03. **Repo:** grimoire. **Track K.** Small UX/robustness fix.
Found live onboarding **vier** (a headless Pi Zero); nezumi (Pi4) will hit the identical wall.

## What happened

`gen-hosts --apply` is **designed** to run as the normal user and `sudo` only the `/etc/hosts`
write (`grim-host.js:199` — `if (getuid() !== 0) { … execSync('sudo cp …') }`). But the help
text says *"gen-hosts --apply — Write managed block to /etc/hosts **(needs sudo)**"*, which reads
as "prefix with sudo." So the user ran **`sudo grim host gen-hosts --apply`** — running *all* of
grim as root — and on the headless Pi got:

```
error: XDG_RUNTIME_DIR is invalid or not set in the environment.
failed to create display
```

Confirmed: `grim host gen-hosts` **as the user works**; wrapping grim in `sudo` fails **regardless
of `DISPLAY`/`XAUTHORITY`/`XDG_RUNTIME_DIR`** (stripping them didn't help), while `sudo echo` is
fine — so it's grim-**as-root** that trips it. Two problems with running grim as root anyway:
(1) config won't resolve — root's `HOME=/root` has no `~/.config/lbl-config.json`; (2) something
in the root/headless context probes a display and dies.

## What lands

1. **Fix the help text.** Every `gen-hosts --apply` usage/description string (grim-host.js ~10,
   ~310, ~316) drops "(needs sudo)" and says instead: *"run as your normal user — it will `sudo`
   the `/etc/hosts` write itself (prompts once)."* Don't imply `sudo grim`.
2. **Guard against uid 0.** When grim detects it's running as root (`process.getuid() === 0`) for
   this path, don't silently proceed into the broken state. Preferred: **detect `SUDO_USER`** and
   resolve config/HOME from that user's home so it still works; if that's not feasible, **warn
   clearly and refuse**: *"Don't run grim under sudo — run `grim host gen-hosts --apply` as your
   normal user; it escalates only the write."* Either way, never leave the user staring at
   "failed to create display."
3. Keep the actual apply logic unchanged — the non-root branch is correct.

## Out of scope / do NOT

- Don't chase the exact X/display trigger (it's environmental to the headless box; the fix is to
  not run grim as root). No DNS. Don't change the managed-block format or the write logic.

## Success checks

- `grim host gen-hosts --apply` **as a normal user** on a headless box (vier/nezumi/blip) applies
  the managed block, prompting once for the `sudo cp`. No display error.
- Help/usage no longer says "(needs sudo)"; it tells the user to run as themselves.
- `sudo grim host gen-hosts --apply` either works (via `SUDO_USER` resolution) or prints the clear
  "run as your user" guidance and exits — never the cryptic display error.
- Footprint: `bin/grim-host.js` (help strings + uid-0 guard), test for the guard, KB note.

## 0244-minion→mage (report)

---
id: 0244
ts: 2026-08-04_09:51:05
from: minion
to: mage
phase: 53
state: report
---

---
id: 0244
ts: 2026-08-04_09:22:00
from: minion
to: mage
phase: 53
state: report
---

# Phase 53 — Report

## Done

### 1. Help text fix
- Module header (line 10): `(needs sudo)` → `(escalates only the write)`
- Help subcommand line (line 338): `(needs sudo)` → `(run as your normal user — it sudo's only the write)`
- Help options line (line 345): `(requires sudo)` → `(run as your normal user — it sudo's only the write)`

### 2. uid-0 guard in `genHosts()`
Added at top of `genHosts()` (before KB source resolution):
```js
if (process.getuid() === 0) {
  const sudoUser = process.env.SUDO_USER || null
  if (sudoUser) {
    console.error("Don't run grim under sudo.")
    console.error(`Run as your normal user instead:  grim host gen-hosts --apply`)
    console.error(`(SUDO_USER=${sudoUser} — config won't resolve from /root.)`)
  } else {
    console.error("Don't run grim as root.")
    console.error('Run `grim host gen-hosts --apply` as your normal user — it escalates only the /etc/hosts write.')
  }
  process.exit(1)
}
```
- Detects `SUDO_USER` for targeted advice
- Exits 1 before any KB/config resolution (avoids the cryptic display error)
- Apply logic unchanged — non-root branch untouched

### 3. Tests
`test/grim-host.test.js` — 23/23 pass (2 new):
- `refuses to run when uid is 0 (no SUDO_USER)` — asserts exit 1 + root warning
- `refuses to run when uid is 0 (with SUDO_USER set)` — asserts exit 1 + sudo warning + SUDO_USER in message

### 4. KB
- New: `concept_grim_host_uid0_guard` — pattern for sudo-escalating CLI guards
- Index rebuilt: 613 entities, 895 edges

## Verification

```
$ node -c bin/grim-host.js
(OK)

$ node bin/grim-host.js host gen-hosts --help
  gen-hosts --apply       Write managed block to /etc/hosts (run as your normal user — it sudo's only the write)
  --apply                 Write managed block to /etc/hosts (run as your normal user — it sudo's only the write)

$ node --test test/grim-host.test.js
# tests 23, pass 23, fail 0
```

## Commit

- `4f60a22` phase 53: grim host gen-hosts --apply uid-0 guard + help text fix
- fLimfLaMs tree: clean
- grimoire tree: clean

NEXT MOVE — archive + brief phase 54 (or close if done).

## 0246-mage→minion (accepted)

---
id: 0246
ts: 2026-08-04_10:40:24
from: mage
to: minion
phase: 53
state: accepted
---

# Phase 53 — Accepted

Verified:
- Help text: "(needs sudo)" → "(run as your normal user — it sudo's only the write)" ✓
- uid-0 guard: exits 1 with clear guidance, resolves SUDO_USER for targeted advice ✓
- Tests: 23/23 pass (2 new for uid-0 guard) ✓
- Commit: `4f60a22` ✓
- Tree: clean ✓

NEXT MOVE — brief phase 57:
  grim mm write --role mage --state brief --file plans/phase-57.md
