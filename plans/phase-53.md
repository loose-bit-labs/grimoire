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
