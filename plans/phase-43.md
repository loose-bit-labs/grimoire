# Phase 43 — hostname resolution operational: clean `grim host gen-hosts` + idempotent apply

**Authority:** hierophant, 2026-08-02. **Repo:** grimoire. **Track K** (hostname-based
resolution, post-`grimoire.local`). The mesh ruling defers DNS — so the fleet resolves each
other by **bare hostname via `/etc/hosts`**, generated from the KB host registry. Today that
generator emits dirty data and nothing applies it. This makes it real.

## Problem (observed 2026-08-02)

`grim host gen-hosts` (KB-sourced, bare names — the canonical scheme; lbl-config endpoints and
all code use bare `aid`/`chonko`/…) currently prints **duplicates and junk**:

```
192.168.0.181  blip
192.168.0.141  blip          # stale second IP
192.168.0.242  chonko
169.254.1.2    chonko         # link-local garbage
192.168.0.55   plink
192.168.0.44   plink          # stale second IP
```

Duplicate host lines make resolution ambiguous. And **nothing applies the output** —
`setup-client.sh` only hand-ensures `aid` (step 4) and punts the rest ("run gen-hosts later,
apply manually"). aid's own `/etc/hosts` is hand-maintained (carries the same stale `blip` dup).

## What lands

1. **One canonical IP per host.** `grim host gen-hosts` must emit exactly one line per host:
   the **LAN address** (`192.168.0.0/24`). Drop link-local (`169.254.x`), loopback, and any
   non-LAN interface; if a host has multiple LAN IPs, pick deterministically (lowest, or the
   one matching the fleet subnet) and note the choice. Root-cause the dupes: the KB host
   registry (via `grim-register-host.sh`) is accumulating multiple IPs/interfaces per host —
   either dedupe at registration (store one canonical LAN IP) or at generation. Prefer fixing
   registration so the KB itself is clean; dedupe at gen as a backstop.
2. **Idempotent apply.** Add `grim host gen-hosts --apply` (needs sudo) that writes a **managed
   block** into `/etc/hosts`:
   ```
   # BEGIN grimoire-hosts (managed by 'grim host gen-hosts --apply' — do not edit)
   …lines…
   # END grimoire-hosts
   ```
   Re-running replaces the block in place (never appends duplicates, never touches lines outside
   the markers). Without `--apply` it prints to stdout as today (safe default).
3. **Wire into client catch-up.** `setup-client.sh` (and the `/update-host` catch-up path)
   calls `grim host gen-hosts --apply` instead of the ad-hoc single-`aid` step — so every box
   self-heals its fleet resolution on each run. Keep it graceful (warn, don't fail, if sudo
   unavailable).

## Out of scope / do NOT

- No DNS/dnsmasq/resolver (mesh ruling). This is `/etc/hosts` generation only.
- Don't touch lines outside the managed block in anyone's `/etc/hosts`.
- Don't change lbl-config endpoint names (bare hostnames stay the contract).
- The `.grim` duplication and `grimoire.local` code remnants are **phase 44**, not here.

## Success checks

- `grim host gen-hosts` prints exactly one LAN line per host, no link-local, no dupes
  (blip/chonko/plink each once).
- `grim host gen-hosts --apply` writes a managed block; re-running is idempotent (diff-clean);
  lines outside the markers are untouched.
- After apply on aid, `getent hosts <each fleet host>` resolves to the LAN IP; the stale
  `blip .141` is gone.
- `setup-client.sh` applies the block on a client (or warns gracefully without sudo).
- Test: gen-hosts dedupe/link-local filtering (unit), managed-block replace idempotency.
- Footprint: `bin/grim-host.js`, maybe `deploy/grim-register-host.sh` (canonical-IP at
  registration), `deploy/setup-client.sh`, tests, KB note.
