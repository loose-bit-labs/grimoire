# Phase 78 — Automate the client DNS drop-in via setup-client; retire the /etc/hosts apply

**Authority:** hierophant, 2026-08-16 (user greenlight: "I already did it manually, I just want to automate it").
**Repo:** grimoire. **Track B cont. (dynamic resolution).** `requires: permission` — writes a sudo file on
every host + restarts a system service; commit locally, never push.

## Why

User stood up **dnsmasq on aid (`:5335`, domain `home.lan`)** and manually applied a systemd-resolved
drop-in to every fleet host:

```ini
# /etc/systemd/resolved.conf.d/99-lbl.conf
[Resolve]
DNS=192.168.0.202:5335
Domains=home.lan
```

Verified live 2026-08-16: `:5335` answers both `chonko.home.lan` and bare `chonko`; aid's
`# BEGIN grimoire-hosts` block is already gone. DNS now **supersedes** the per-host `/etc/hosts` block
(phase 43). This phase makes the manual step reproducible so new hosts (and re-runs) get it automatically,
and retires the now-vestigial `/etc/hosts` apply.

## The one legitimate hardcode (design note)

The resolver address **must be a literal IP** — it is the thing that resolves names, so it cannot itself be
resolved by name (bootstrap chicken-and-egg). This is the single irreducible static value. **Do not add a
second copy of it:** put it once in `config/lbl-config.json` as `endpoints.dns` (value `192.168.0.202:5335`)
and read it from there. The client already knows aid's address as its bootstrap grimoire host; `endpoints.dns`
is the same authority every other endpoint resolves through.

## What lands

- **`config/lbl-config.json`** — add `endpoints.dns: "192.168.0.202:5335"` and (if a domain knob is wanted)
  `dns_domain: "home.lan"`. Single source of truth.
- **`deploy/resolved/99-lbl.conf.tmpl`** — the drop-in template with `@DNS@` / `@DOMAIN@` placeholders.
- **`deploy/setup-client.sh`** — a new idempotent, `DRY_RUN`-aware function that: reads `endpoints.dns` +
  `dns_domain` (via `grim config get`, graceful if absent → skip with a warning), renders the template to
  `/etc/systemd/resolved.conf.d/99-lbl.conf` **only if changed**, and `systemctl restart systemd-resolved`
  **only on change**. Guard the sudo writes; print what it would do under `DRY_RUN`.
- **Retire the `/etc/hosts` apply:** stop `setup-client.sh` (and the catch-up path) from writing the
  `# BEGIN/END grimoire-hosts` block. Leave `grim host gen-hosts` itself intact (still useful to *feed*
  dnsmasq's `addn-hosts` on aid — that's the server side, out of scope here); just stop pushing the block to
  every client.

## Out of scope / do NOT

- No changes to aid's dnsmasq config or the server-side `addn-hosts` wiring (server side, separate).
- Do not remove `grim host gen-hosts` — only its per-client `--apply` in setup-client.
- Do not hardcode the resolver IP anywhere but `endpoints.dns`.

## Success checks

- On a client with no drop-in: running setup-client **creates** `/etc/systemd/resolved.conf.d/99-lbl.conf`
  matching the template (DNS + Domains from lbl-config), restarts resolved once, and the host then resolves a
  fleet name via `:5335` (`getent hosts chonko` / `resolvectl query chonko`).
- **Idempotent:** a second run detects no change → does **not** rewrite the file or restart resolved.
- `DRY_RUN=1` prints the intended write + restart without touching the system.
- setup-client no longer writes the `# BEGIN grimoire-hosts` block; an existing block is left alone (removal
  is manual/observational, not forced).
- Graceful: `endpoints.dns` absent → warn and skip, don't fail the whole setup.
