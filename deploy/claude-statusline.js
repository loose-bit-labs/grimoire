#!/usr/bin/env node
'use strict';

/**
 * Grimoire status line for Claude Code — a grim dungeon HUD.
 *
 * Reads the session JSON on stdin and prints a single styled line:
 *   <repo> <role> │ 🌿 (branch) │ <depth> <gradient bar> NN% │ +adds -dels │ 🤖 model │ <dungeon>
 *
 * Left → right: bold-yellow repo + a session-role glyph (🧎‍♂️ minion /
 * 🧙‍♂️ mage / 🔮 hierophant / 🗡️ lone adventurer when unaligned), cyan
 * branch, an RGB green→yellow→red context bar (% of the 200K window,
 * derived from the transcript since Claude Code does not pass it on stdin)
 * with a dungeon-depth emoji (🕯️→⚔️→💀→☠️), green/red code velocity,
 * magenta model, and a live animated dungeon corridor: a critter scuttling
 * under a cycling moon by flickering torchlight. Frames advance off the
 * wall clock.
 *
 * Role comes from GRIM_ROLE (mage|minion|hierophant) — set it at launch,
 * the only path for the skill-less hierophant — or a session-keyed marker
 * the /mage and /minion skills drop at .mm/.role-$CLAUDE_CODE_SESSION_ID.
 *
 * INSTALL (any box with this repo checked out):
 *   ln -s "$PWD/deploy/claude-statusline.js" ~/.claude/statusline.js
 *   # then in ~/.claude/settings.json:
 *   #   "statusLine": { "type": "command", "command": "node ~/.claude/statusline.js" }
 *
 * Zero dependencies. Needs a truecolor terminal for the gradient.
 */

const fs = require('fs');

// ---- ANSI helpers ----------------------------------------------------------
const ESC = '\x1b[';
const RESET = `${ESC}0m`;
const bold = (s) => `${ESC}1m${s}${RESET}`;
const dim = (s) => `${ESC}2m${s}${RESET}`;
const fg = (r, g, b) => `${ESC}38;2;${r};${g};${b}m`;
const c256 = {
  yellow: `${ESC}38;2;235;203;67m`,
  cyan: `${ESC}38;2;86;204;221m`,
  green: `${ESC}38;2;87;217;121m`,
  red: `${ESC}38;2;233;86;86m`,
  magenta: `${ESC}38;2;199;120;221m`,
};
const paint = (color, s) => `${color}${s}${RESET}`;

// ---- context window --------------------------------------------------------
const CONTEXT_WINDOW = 200000;
const BAR_WIDTH = 20;

// green (low) -> yellow (mid) -> red (high), interpolated by position t in [0,1]
function gradient(t) {
  if (t < 0.5) {
    const k = t / 0.5; // 0..1 across green->yellow
    return [Math.round(255 * k), 255, 0];
  }
  const k = (t - 0.5) / 0.5; // 0..1 across yellow->red
  return [255, Math.round(255 * (1 - k)), 0];
}

// dungeon depth: the deeper the context, the deadlier it gets
function contextEmoji(pct) {
  if (pct < 20) return '🕯️'; // candlelit — plenty of torch left
  if (pct < 70) return '⚔️'; // in the thick of it
  if (pct < 90) return '💀'; // mortal danger
  return '☠️'; // death — the compaction reaper approaches
}

// ---- animated dungeon corridor (right side) -------------------------------
// Frames advance off the wall clock; Claude Code re-renders the line
// periodically, so the scene comes alive on its own.
const MOONS = ['🌑', '🌒', '🌓', '🌔', '🌕', '🌖', '🌗', '🌘'];
const CRITTERS = ['🦇', '🕷️', '🐀', '🐍', '𓆏']; // things that lurk in the dark (+ the frog)
const LOOT = ['💰', '🏆', '👑', '💎', '🎲']; // treasure at the end of the hall
const TRACK = 5;
// ornamental reed-and-star frame (hieroglyphs — needs a font that has them;
// set to '' '' to disable if your terminal shows tofu boxes)
const FRAME_L = '☆𓋼';
const FRAME_R = '𓋼☆';

// flickering torchlight on the walls — jittered dim amber
function torchlight() {
  const j = Math.round(Math.sin(Date.now() / 90) * 35 + Math.random() * 12);
  return fg(120 + j, 60 + Math.round(j / 2), 15);
}

function dungeonScene() {
  const now = Date.now();
  // ping-pong the critter back and forth along the corridor
  const span = TRACK * 2 - 2;
  let pos = Math.floor(now / 220) % span;
  if (pos >= TRACK) pos = span - pos;

  const critter = CRITTERS[Math.floor(now / 2600) % CRITTERS.length];
  const moon = MOONS[Math.floor(now / 900) % MOONS.length];
  const loot = LOOT[Math.floor(now / 3300) % LOOT.length];

  let corridor = '';
  for (let i = 0; i < TRACK; i++) {
    corridor += i === pos ? critter : `${torchlight()}·${RESET}`;
  }
  // torch at the adventurer's back, treasure glinting at the hall's end,
  // the whole tableau framed by reeds and stars
  const frame = (s) => (s ? dim(s) : '');
  return `${moon} ${frame(FRAME_L)}🔥${corridor}${loot}${frame(FRAME_R)}`;
}

function contextBar(pct) {
  const filled = Math.min(BAR_WIDTH, Math.round((pct / 100) * BAR_WIDTH));
  let bar = '';
  for (let i = 0; i < BAR_WIDTH; i++) {
    if (i < filled) {
      const t = BAR_WIDTH > 1 ? i / (BAR_WIDTH - 1) : 0;
      const [r, g, b] = gradient(t);
      bar += `${fg(r, g, b)}█`;
    } else {
      bar += `${ESC}2m${ESC}38;2;90;90;90m░`;
    }
  }
  return bar + RESET;
}

// ---- transcript -> tokens used --------------------------------------------
function usedTokens(transcriptPath) {
  if (!transcriptPath || !fs.existsSync(transcriptPath)) return 0;
  let lines;
  try {
    lines = fs.readFileSync(transcriptPath, 'utf8').split('\n');
  } catch {
    return 0;
  }
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    if (row.isSidechain) continue;
    const u = row.message && row.message.usage;
    if (row.type === 'assistant' && u) {
      return (
        (u.input_tokens || 0) +
        (u.cache_creation_input_tokens || 0) +
        (u.cache_read_input_tokens || 0)
      );
    }
  }
  return 0;
}

// ---- git -------------------------------------------------------------------
const { execSync } = require('child_process');
function git(args, cwd) {
  try {
    return execSync(`git ${args}`, {
      cwd,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
  } catch {
    return '';
  }
}

// ---- session role (minion / mage / hierophant) ----------------------------
// The three-layer pact: minion (local, the hands) → mage (builds & reviews) →
// hierophant (the authority that descends to mediate a stalled loop or hand
// down the grand plan). Detected from GRIM_ROLE — explicit, and the only path
// for the skill-less hierophant — or a session-keyed marker the /mage and
// /minion skills drop in .mm/.
const ROLE_ICONS = {
  minion: '🧎‍♂️',
  mage: '🧙‍♂️',
  hierophant: '🔮',
};
const LONE_ADVENTURER = '🗡️'; // no pact / role unknown

function detectRole(cwd, sessionId) {
  let role = (process.env.GRIM_ROLE || '').trim().toLowerCase();
  if (!role && sessionId) {
    try {
      role = fs
        .readFileSync(`${cwd}/.mm/.role-${sessionId}`, 'utf8')
        .trim()
        .toLowerCase();
    } catch {
      /* no marker — a lone adventurer */
    }
  }
  return ROLE_ICONS[role] || LONE_ADVENTURER;
}

// ---- main ------------------------------------------------------------------
function main(input) {
  let data = {};
  try {
    data = JSON.parse(input || '{}');
  } catch {
    /* fall through with defaults */
  }

  const cwd =
    (data.workspace && data.workspace.current_dir) || data.cwd || process.cwd();

  // repo name: git toplevel basename, else cwd basename
  const top = git('rev-parse --show-toplevel', cwd);
  const repo = (top || cwd).split('/').filter(Boolean).pop() || '~';

  // session role icon (🧎‍♂️ minion / 🧙‍♂️ mage / 🔮 hierophant), beside the repo
  const roleIcon = detectRole(cwd, data.session_id);

  // branch (or short sha if detached)
  let branch = git('rev-parse --abbrev-ref HEAD', cwd);
  if (branch === 'HEAD') branch = git('rev-parse --short HEAD', cwd) || 'detached';

  // context
  const tokens = usedTokens(data.transcript_path);
  const pct = Math.min(100, Math.round((tokens / CONTEXT_WINDOW) * 100));

  // code velocity
  const cost = data.cost || {};
  const adds = cost.total_lines_added || 0;
  const dels = cost.total_lines_removed || 0;

  // model
  const model = (data.model && data.model.display_name) || 'Claude';

  // assemble
  const sep = dim(' │ ');
  const parts = [];

  parts.push(`${paint(c256.yellow, bold(repo))} ${roleIcon}`);

  if (branch) parts.push(paint(c256.cyan, bold(`🌿 (${branch})`)));

  parts.push(
    `${contextEmoji(pct)} ${contextBar(pct)} ${paint(c256.yellow, pct + '%')}`
  );

  if (adds || dels) {
    parts.push(
      `${paint(c256.green, '+' + adds)} ${paint(c256.red, '-' + dels)}`
    );
  }

  parts.push(paint(c256.magenta, `🤖 ${model}`));

  process.stdout.write(parts.join(sep) + sep + dungeonScene());
}

let stdin = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => (stdin += d));
process.stdin.on('end', () => main(stdin));
