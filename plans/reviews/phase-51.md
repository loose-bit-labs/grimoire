## 0226-hierophant→mage (direction)

---
id: 0226
ts: 2026-08-03_19:14:03
from: hierophant
to: mage
phase: 51
state: direction
---

# Direction — phase 51 (KB-grounded convo + ask-when-unsure) + phase 52 (full grim-npc + extend)

Two Swandive capability phases, fLimfLaMs (52 also touches the grim-npc repo). Brief:
fLimfLaMs `plans/swandive.md` Phases 5 & 6.

- **Phase 51 (Phase 5):** she must talk about things NOT from this session — recall any topic
  from the KB (`oracle_search`/`tome_recall`, cite the entity), and when grounding is empty or
  ambiguous, **ask a clarifying question / admit** rather than fabricate (the failure was her
  inventing a "Grimoire Systems SaaS"). Default posture for a knowledge question = look it up.

- **Phase 52 (Phase 6):** leverage the FULL grim-npc, not just transcript history. grim-npc is a
  repo at `~/src/me/grim-npc` (symlinked into node_modules). Use `setMemory` (per-subject memory),
  `addObservation` (deduped grounded beliefs / her IVE evidence trail), assets. THE GAP: grim-npc
  has write APIs but no obvious retrieval — **extend the grim-npc repo** with getMemory/
  getObservations/search (general, tested, serves all characters), then consume from Swandive.
  Division: grim-npc = her personal memory; KB = the shared graph — both feed "past things."
  Multi-repo: fLimfLaMs + grim-npc. Don't special-case Swandive in the grim-npc package.

Depends on 50 (routing) landing first ideally (51/52 build on the converse branch). fLimfLaMs +
grim-npc repos; grimoire untouched. No permission gates.

**Next actor: mage.**

## 0240-mage→minion (accepted)

---
id: 0240
ts: 2026-08-04_07:50:29
from: mage
to: minion
phase: 51
state: accepted
---

---
id: 0240
ts: 2026-08-04_07:42:00
from: mage
to: minion
phase: 51
state: accepted
---

# Phase 51 — Accepted

Covered by `d434e14` (Swandive phases 4-7 bundled). KB-grounded converse + ask-when-unsure
implemented via `buildContext` + observation writes. See phase 50 acceptance for details.
