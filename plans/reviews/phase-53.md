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
