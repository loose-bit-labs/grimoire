#!/usr/bin/env node
'use strict'

/**
 * grim-cull.js — Portrait/image culling UI generator
 *
 * Ported from wantan's bin/cull.js. Scans a directory (or tree, with --all)
 * for generated PNGs, writes a self-contained cull.html next to them —
 * keep/cull/undo, drag-select, zone bulk actions, an rm-command generator
 * for the culled set, and an export list for the keepers.
 *
 * CLI:
 *   grim cull <dir> [--all] [--serve-root DIR] [--serve-url URL]
 *
 * SERVE_ROOT/SERVE_URL resolve as: flag → env (GRIM_CULL_SERVE_ROOT /
 * GRIM_CULL_SERVE_URL) → hardcoded default. They only affect the printed
 * cull.html URL (relative-path math) — cull.html itself works from any dir.
 */

const fs   = require('fs')
const path = require('path')

const DEFAULT_SERVE_ROOT = '/home/vgvm/public_html/wantan'
const DEFAULT_SERVE_URL  = 'http://aid/~vgvm/wantan'

class CullGen {
  constructor({ dir, multi = false, serveRoot, serveUrl }) {
    this.dir      = path.resolve(dir)
    this.multi    = multi
    this.serveRoot = serveRoot
    this.serveUrl  = serveUrl
    this.relPath  = path.relative(this.serveRoot, this.dir)
  }

  listImages() {
    if (this.multi) return this._listMulti()
    return fs.readdirSync(this.dir)
      .filter(f => /\.png$/i.test(f) && fs.statSync(path.join(this.dir, f)).size > 5000)
      .sort()
  }

  _listMulti() {
    // Walk this.dir recursively, collect all PNGs > 5KB, return absolute paths
    const results = []
    const walk = (d) => {
      for (const f of fs.readdirSync(d).sort()) {
        const full = path.join(d, f)
        const stat = fs.statSync(full)
        if (stat.isDirectory()) walk(full)
        else if (/\.png$/i.test(f) && stat.size > 5000) results.push(full)
      }
    }
    walk(this.dir)
    return results
  }

  generate() {
    const files  = this.listImages()
    const images = files.map(f => {
      const abs = path.isAbsolute(f) ? f : path.join(this.dir, f)
      return { file: this.multi ? f : f, abs, meta: this.readSidecar(this.multi ? f : path.join(this.dir, f)) }
    })
    const outPath = path.join(this.dir, 'cull.html')
    fs.writeFileSync(outPath, this.buildHtml(images))
    return outPath
  }

  readSidecar(absOrRel) {
    try { return JSON.parse(fs.readFileSync(absOrRel + '.json', 'utf8')) }
    catch { return null }
  }

  buildHtml(images) {
    const data    = JSON.stringify(images)
    const dirPath = this.dir
    const title   = path.basename(this.dir)
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>cull — ${title}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#0d0d0d;--bg2:#141414;--bg3:#1c1c1c;
  --border:#252525;--text:#c8c8c8;--muted:#4a4a4a;
  --accent:#00d4aa;--del:#d44a4a;--keep:#4ad465;--sel:#f0a020;
}
html,body{height:100%;overflow:hidden;background:var(--bg);color:var(--text);font-family:'Courier New',monospace;font-size:13px}
body{display:grid;grid-template-rows:118px 1fr 118px;height:100vh}

.thumb-zone{background:var(--bg2);display:flex;flex-direction:column;padding:6px 10px;overflow:hidden}
#zone-todo{border-bottom:1px solid var(--border)}
#zone-contenders{border-top:1px solid var(--border)}
.zone-label{display:flex;align-items:center;gap:6px;font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:5px;flex-shrink:0}
.zone-label .cnt{color:var(--text)}
.zone-btns{display:flex;gap:4px;margin-left:auto}
.zbtn{background:transparent;border:1px solid var(--border);color:var(--muted);padding:2px 7px;cursor:pointer;font-family:inherit;font-size:9px;border-radius:2px;transition:border-color .1s,color .1s}
.zbtn:hover{border-color:var(--muted);color:var(--text)}
.zbtn-del{border-color:rgba(212,74,74,.35);color:rgba(212,74,74,.6)}
.zbtn-del:hover{border-color:var(--del);color:var(--del)}
.zbtn:disabled{opacity:0.25;cursor:default;pointer-events:none}
.thumb-scroll{display:flex;gap:5px;overflow-x:auto;overflow-y:hidden;flex:1;align-items:center;scrollbar-width:thin;scrollbar-color:var(--border) transparent}
.thumb{flex-shrink:0;cursor:pointer;border:2px solid transparent;border-radius:3px;overflow:hidden;opacity:0.6;transition:opacity .1s,border-color .1s;height:76px;position:relative;user-select:none}
.thumb:hover{opacity:1;border-color:var(--muted)}
.thumb.active{opacity:1;border-color:var(--accent)}
.thumb.culled{opacity:0.25;border-color:var(--del)!important}
.thumb.selected{opacity:1;border-color:var(--sel);box-shadow:0 0 6px rgba(240,160,32,.3)}
.thumb img{height:76px;width:auto;display:block;pointer-events:none}

#zone-arena{display:flex;flex-direction:row;overflow:hidden;min-height:0}
#arena-main{flex:1;display:flex;flex-direction:column;align-items:center;overflow:hidden;padding:10px 12px 6px}
#arena-img-wrap{flex:1;display:flex;align-items:center;justify-content:center;width:100%;overflow:hidden;cursor:pointer}
#arena-img{max-height:100%;max-width:100%;object-fit:contain;display:block}
#arena-empty{color:var(--muted);font-size:15px}
#controls{display:flex;gap:8px;align-items:center;padding:6px 0 2px;flex-shrink:0;width:100%}
.btn{background:var(--bg3);border:1px solid var(--border);color:var(--text);padding:5px 12px;cursor:pointer;font-family:inherit;font-size:13px;border-radius:3px;transition:background .1s,border-color .1s;white-space:nowrap}
.btn:hover{background:#242424;border-color:var(--muted)}
.btn:disabled{opacity:0.25;cursor:default;pointer-events:none}
.btn-del{border-color:var(--del)!important;color:var(--del)}
.btn-del:hover{background:rgba(212,74,74,.12)!important}
.btn-keep{border-color:var(--keep)!important;color:var(--keep)}
.btn-keep:hover{background:rgba(74,212,101,.12)!important}
.btn-accent{border-color:var(--accent);color:var(--accent)}
.btn-accent:hover{background:rgba(0,212,170,.1)}
.btn-sel{border-color:var(--sel);color:var(--sel)}
.btn-sel:hover{background:rgba(240,160,32,.1)}
.btn-sm{padding:5px 8px}
#arena-counter{color:var(--muted);font-size:12px;min-width:60px;text-align:center;flex-shrink:0}
#arena-source{color:var(--muted);font-size:10px;text-transform:uppercase;letter-spacing:1px;flex-shrink:0}
#spacer{flex:1}

#info-panel{width:280px;background:var(--bg2);border-left:1px solid var(--border);display:none;flex-direction:column;overflow:hidden;flex-shrink:0}
#info-panel.open{display:flex}
#info-hdr{padding:7px 12px;border-bottom:1px solid var(--border);font-size:10px;color:var(--accent);text-transform:uppercase;letter-spacing:1px}
#info-body{flex:1;overflow-y:auto;padding:10px 12px;scrollbar-width:thin;scrollbar-color:var(--border) transparent}
.ifield{margin-bottom:9px}
.ikey{font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px}
.ival{color:var(--text);word-break:break-all;font-size:12px;line-height:1.4}
.ival.mono{font-size:11px;color:#aaa;max-height:90px;overflow-y:auto;scrollbar-width:thin;scrollbar-color:var(--border) transparent}
.ival.file{color:var(--accent);font-size:11px}

#rm-modal{display:none;position:fixed;inset:0;background:rgba(0,0,0,.8);z-index:100;align-items:center;justify-content:center}
#rm-modal.open{display:flex}
#rm-box{background:var(--bg2);border:1px solid var(--border);border-radius:4px;padding:20px;max-width:80vw;max-height:80vh;display:flex;flex-direction:column;gap:12px}
#rm-box h2{font-size:13px;color:var(--accent);text-transform:uppercase;letter-spacing:1px}
#rm-cmd{background:var(--bg);border:1px solid var(--border);color:#aaa;padding:10px;font-family:'Courier New',monospace;font-size:11px;flex:1;overflow:auto;white-space:pre;min-height:60px;max-height:40vh;border-radius:3px}
.rm-btns{display:flex;gap:8px;justify-content:flex-end}

#hint{position:fixed;bottom:5px;right:8px;color:var(--muted);font-size:10px;text-align:right;pointer-events:none;z-index:9;line-height:1.6}
</style>
</head>
<body>

<div class="thumb-zone" id="zone-todo">
  <div class="zone-label">todo — <span class="cnt" id="todo-count">0</span>
    <span class="zone-btns">
      <button class="zbtn" id="btn-todo-selall">sel all</button>
      <button class="zbtn zbtn-del" id="btn-todo-cullall">cull all</button>
    </span>
  </div>
  <div class="thumb-scroll" id="todo-scroll"></div>
</div>

<div id="zone-arena">
  <div id="arena-main">
    <div id="arena-img-wrap">
      <img id="arena-img" style="display:none" alt="">
      <div id="arena-empty">click a thumbnail to begin</div>
    </div>
    <div id="controls">
      <button class="btn btn-sm" id="btn-prev" disabled>◀</button>
      <button class="btn btn-del"  id="btn-del"  disabled>✗  cull</button>
      <span id="arena-counter">—</span>
      <button class="btn btn-keep" id="btn-keep" disabled>✓  keep</button>
      <button class="btn btn-sm" id="btn-next" disabled>▶</button>
      <button class="btn btn-sm" id="btn-undo" disabled title="undo (ctrl-z)">↩</button>
      <button class="btn btn-sel" id="btn-bulk-cull" style="display:none">✗ cull 0 sel</button>
      <span id="spacer"></span>
      <button class="btn btn-del" id="btn-rm" style="font-size:11px">☠ get rm cmd</button>
      <button class="btn btn-accent" id="btn-export" style="font-size:11px">📋 export list</button>
      <span id="arena-source"></span>
      <button class="btn btn-accent" id="btn-info">ℹ info</button>
    </div>
  </div>
  <div id="info-panel">
    <div id="info-hdr">image info</div>
    <div id="info-body">
      <div class="ifield"><div class="ikey">file</div><div class="ival file" id="iv-file">—</div></div>
      <div class="ifield"><div class="ikey">seed</div><div class="ival" id="iv-seed">—</div></div>
      <div class="ifield"><div class="ikey">model / pose</div><div class="ival" id="iv-model">—</div></div>
      <div class="ifield"><div class="ikey">dimensions</div><div class="ival" id="iv-dims">—</div></div>
      <div class="ifield"><div class="ikey">steps / cfg / sampler</div><div class="ival" id="iv-steps">—</div></div>
      <div class="ifield"><div class="ikey">prompt</div><div class="ival mono" id="iv-prompt">—</div></div>
    </div>
  </div>
</div>

<div class="thumb-zone" id="zone-contenders">
  <div class="zone-label">contenders — <span class="cnt" id="con-count">0</span>
    <span class="zone-btns">
      <button class="zbtn" id="btn-con-totodo">↑ to todo</button>
      <button class="zbtn zbtn-del" id="btn-con-cullall">cull all</button>
    </span>
  </div>
  <div class="thumb-scroll" id="con-scroll"></div>
</div>

<div id="rm-modal">
  <div id="rm-box">
    <h2>shell command to delete culled images</h2>
    <pre id="rm-cmd"></pre>
    <div class="rm-btns">
      <button class="btn btn-accent" id="btn-copy">copy</button>
      <button class="btn" id="btn-close-rm">close</button>
    </div>
  </div>
</div>

<div id="export-modal">
  <div id="rm-box">
    <h2>contenders — file paths</h2>
    <pre id="export-list"></pre>
    <div class="rm-btns">
      <button class="btn btn-accent" id="btn-export-copy">copy</button>
      <button class="btn" id="btn-close-export">close</button>
    </div>
  </div>
</div>

<div id="hint">← → navigate &nbsp;|&nbsp; K keep &nbsp; D cull &nbsp; I info &nbsp;|&nbsp; shift+click / drag: select &nbsp;|&nbsp; ctrl-z: undo</div>

<script>
const ALL_IMAGES = ${data};
const DIR = ${JSON.stringify(dirPath)};

const S = {
  todo: [...ALL_IMAGES], contenders: [], culled: [],
  current: null, from: 'todo', info: false,
  selected: new Set(), history: [],
  lastClicked: { todo: null, contenders: null }
};

const $todoScroll  = document.getElementById('todo-scroll');
const $conScroll   = document.getElementById('con-scroll');
const $img         = document.getElementById('arena-img');
const $empty       = document.getElementById('arena-empty');
const $counter     = document.getElementById('arena-counter');
const $source      = document.getElementById('arena-source');
const $btnPrev     = document.getElementById('btn-prev');
const $btnNext     = document.getElementById('btn-next');
const $btnDel      = document.getElementById('btn-del');
const $btnKeep     = document.getElementById('btn-keep');
const $btnInfo     = document.getElementById('btn-info');
const $btnRm       = document.getElementById('btn-rm');
const $btnUndo     = document.getElementById('btn-undo');
const $btnBulkCull = document.getElementById('btn-bulk-cull');
const $infoPanel   = document.getElementById('info-panel');
const $todoCount   = document.getElementById('todo-count');
const $conCount    = document.getElementById('con-count');
const $ivFile      = document.getElementById('iv-file');
const $ivSeed      = document.getElementById('iv-seed');
const $ivModel     = document.getElementById('iv-model');
const $ivDims      = document.getElementById('iv-dims');
const $ivSteps     = document.getElementById('iv-steps');
const $ivPrompt    = document.getElementById('iv-prompt');
const $rmModal     = document.getElementById('rm-modal');
const $rmCmd       = document.getElementById('rm-cmd');
const $exportModal = document.getElementById('export-modal');
const $exportList  = document.getElementById('export-list');
const $btnExport   = document.getElementById('btn-export');

// undo — full state snapshot, capped at 50
function pushHistory() {
  S.history.push({
    todo: [...S.todo], contenders: [...S.contenders], culled: [...S.culled],
    current: S.current, from: S.from, selected: new Set(S.selected)
  });
  if (S.history.length > 50) S.history.shift();
  $btnUndo.disabled = false;
}

function undo() {
  if (!S.history.length) return;
  const prev = S.history.pop();
  S.todo = prev.todo; S.contenders = prev.contenders; S.culled = prev.culled;
  S.current = prev.current; S.from = prev.from; S.selected = prev.selected;
  render();
  if (S.current) {
    $img.src = S.current.file; $img.style.display = ''; $empty.style.display = 'none';
  } else {
    clearArena();
  }
  updateControls(); updateInfo(); highlight(); updateBulkBar();
  $btnUndo.disabled = S.history.length === 0;
}

// drag-to-select: mousedown starts, mousemove detects drag, mouseenter on thumbs adds to selection
let _drag = { active: false, moved: false, startX: 0, startY: 0 };
document.addEventListener('mousemove', e => {
  if (!_drag.active || _drag.moved) return;
  if (Math.abs(e.clientX - _drag.startX) > 5 || Math.abs(e.clientY - _drag.startY) > 5)
    _drag.moved = true;
});
document.addEventListener('mouseup', () => {
  _drag = { active: false, moved: false, startX: 0, startY: 0 };
});

function render() {
  renderRow($todoScroll, S.todo, 'todo');
  renderRow($conScroll, S.contenders, 'contenders');
  $todoCount.textContent = S.todo.length;
  $conCount.textContent  = S.contenders.length;
  document.getElementById('btn-todo-selall').disabled  = S.todo.length === 0;
  document.getElementById('btn-todo-cullall').disabled = S.todo.length === 0;
  document.getElementById('btn-con-totodo').disabled   = S.contenders.length === 0;
  document.getElementById('btn-con-cullall').disabled  = S.contenders.length === 0;
}

function renderRow(container, list, from) {
  container.innerHTML = '';
  list.forEach((item, listIdx) => {
    const div = document.createElement('div');
    div.className = 'thumb' +
      (S.culled.some(x => x.file === item.file) ? ' culled' : '') +
      (S.selected.has(item.file) ? ' selected' : '') +
      (S.current?.file === item.file ? ' active' : '');
    div.dataset.file = item.file;
    const img = new Image();
    img.src = item.file; img.loading = 'lazy';
    div.appendChild(img);

    div.addEventListener('mousedown', e => {
      _drag = { active: true, moved: false, startX: e.clientX, startY: e.clientY };
    });
    div.addEventListener('mouseenter', () => {
      if (_drag.active && _drag.moved) {
        S.selected.add(item.file);
        div.classList.add('selected');
        updateBulkBar();
      }
    });
    div.addEventListener('click', e => {
      if (_drag.moved) { updateBulkBar(); return; }
      if (e.shiftKey) {
        const lastFile = S.lastClicked[from];
        if (lastFile && lastFile !== item.file) {
          const startIdx = list.findIndex(x => x.file === lastFile);
          const [lo, hi] = [Math.min(startIdx, listIdx), Math.max(startIdx, listIdx)];
          for (let i = lo; i <= hi; i++) S.selected.add(list[i].file);
        } else {
          if (S.selected.has(item.file)) S.selected.delete(item.file);
          else S.selected.add(item.file);
        }
        S.lastClicked[from] = item.file;
        render(); updateBulkBar(); return;
      }
      S.selected.clear(); updateBulkBar();
      S.lastClicked[from] = item.file;
      load(item, from);
    });
    container.appendChild(div);
  });
}

function updateBulkBar() {
  const n = S.selected.size;
  $btnBulkCull.style.display = n > 0 ? '' : 'none';
  $btnBulkCull.textContent   = '✗ cull ' + n + ' sel';
}

function load(item, from) {
  S.current = item; S.from = from;
  $img.src = item.file; $img.style.display = ''; $empty.style.display = 'none';
  updateControls(); updateInfo(); highlight(); scrollIntoView(item.file);
}

function updateControls() {
  const ok   = !!S.current;
  const list = S.from === 'todo' ? S.todo : S.contenders;
  const idx  = ok ? list.findIndex(x => x.file === S.current.file) : -1;
  $btnDel.disabled  = !ok;
  $btnKeep.disabled = !ok;
  $btnPrev.disabled = idx <= 0;
  $btnNext.disabled = idx < 0 || idx >= list.length - 1;
  $counter.textContent = idx >= 0 ? (idx + 1) + ' / ' + list.length : '—';
  $source.textContent  = ok ? S.from : '';
  $btnKeep.textContent = S.from === 'contenders' ? '↩ back' : '✓  keep';
}

function updateInfo() {
  if (!S.current) return;
  const { file, meta: m } = S.current;
  $ivFile.textContent   = file;
  $ivSeed.textContent   = m?.seed  ?? '—';
  $ivModel.textContent  = [m?.model, m?.pose].filter(Boolean).join(' / ') || '—';
  $ivDims.textContent   = m ? m.width + ' × ' + m.height : '—';
  $ivSteps.textContent  = m ? 'steps ' + m.steps + '  cfg ' + m.cfg + (m.sampler ? '  ' + m.sampler : '') : '—';
  $ivPrompt.textContent = m?.prompt ?? '—';
}

function highlight() {
  document.querySelectorAll('.thumb').forEach(el =>
    el.classList.toggle('active', el.dataset.file === S.current?.file));
}

function scrollIntoView(file) {
  const el = document.querySelector('.thumb[data-file="' + CSS.escape(file) + '"]');
  if (el) el.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
}

function nav(dir) {
  if (!S.current) return;
  const list = S.from === 'todo' ? S.todo : S.contenders;
  const idx  = list.findIndex(x => x.file === S.current.file);
  const next = list[idx + dir];
  if (next) load(next, S.from);
}

function doCull() {
  if (!S.current) return;
  pushHistory();
  const list = S.from === 'todo' ? S.todo : S.contenders;
  const idx  = list.findIndex(x => x.file === S.current.file);
  S.culled.push(list.splice(idx, 1)[0]);
  const next = list[idx] || list[idx - 1];
  render(); next ? load(next, S.from) : clearArena();
}

function doKeep() {
  if (!S.current) return;
  pushHistory();
  if (S.from === 'todo') {
    const idx  = S.todo.findIndex(x => x.file === S.current.file);
    S.contenders.push(S.todo.splice(idx, 1)[0]);
    render();
    const next = S.todo[idx] || S.todo[idx - 1];
    next ? load(next, 'todo') : clearArena();
  } else {
    const idx  = S.contenders.findIndex(x => x.file === S.current.file);
    const item = S.contenders.splice(idx, 1)[0];
    S.todo.push(item); render(); load(item, 'todo');
  }
}

function clearArena() {
  S.current = null;
  $img.style.display = 'none'; $empty.style.display = '';
  [$btnDel, $btnKeep, $btnPrev, $btnNext].forEach(b => b.disabled = true);
  $counter.textContent = '—'; $source.textContent = '';
}

function bulkCull() {
  if (!S.selected.size) return;
  pushHistory();
  for (const which of ['todo', 'contenders']) {
    const list = which === 'todo' ? S.todo : S.contenders;
    for (let i = list.length - 1; i >= 0; i--) {
      if (S.selected.has(list[i].file)) S.culled.push(list.splice(i, 1)[0]);
    }
  }
  S.selected.clear();
  if (S.current && !S.todo.concat(S.contenders).some(x => x.file === S.current.file))
    clearArena();
  render(); updateBulkBar(); updateControls();
}

function cullZone(which) {
  const list = which === 'todo' ? S.todo : S.contenders;
  if (!list.length) return;
  pushHistory();
  S.culled.push(...list.splice(0));
  if (S.current && S.from === which) clearArena();
  S.selected.clear(); render(); updateBulkBar(); updateControls();
}

function pushContendersToTodo() {
  if (!S.contenders.length) return;
  pushHistory();
  S.todo.push(...S.contenders.splice(0));
  if (S.current && S.from === 'contenders') S.from = 'todo';
  render(); updateControls();
}

function showRmCmd() {
  if (!S.culled.length) { alert('Nothing culled yet.'); return; }
  const files = S.culled.flatMap(x => [x.file, x.file + '.json']).join(' ');
  $rmCmd.textContent = 'cd ' + DIR + ' && rm -f ' + files;
  $rmModal.classList.add('open');
}

function showExportList() {
  if (!S.contenders.length) { alert('No contenders yet — keep some images first.'); return; }
  $exportList.textContent = S.contenders.map(x => x.abs || x.file).join('\\n');
  $exportModal.classList.add('open');
}

$btnPrev.addEventListener('click', () => nav(-1));
$btnNext.addEventListener('click', () => nav(+1));
$btnDel.addEventListener('click', doCull);
$btnKeep.addEventListener('click', doKeep);
$btnUndo.addEventListener('click', undo);
$btnBulkCull.addEventListener('click', bulkCull);
$btnInfo.addEventListener('click', () => {
  S.info = !S.info;
  $infoPanel.classList.toggle('open', S.info);
  $btnInfo.style.background = S.info ? 'rgba(0,212,170,.12)' : '';
});
$btnRm.addEventListener('click', showRmCmd);
$btnExport.addEventListener('click', showExportList);
document.getElementById('btn-export-copy').addEventListener('click', () => {
  navigator.clipboard.writeText($exportList.textContent).then(() => {
    document.getElementById('btn-export-copy').textContent = 'copied!';
    setTimeout(() => document.getElementById('btn-export-copy').textContent = 'copy', 1500);
  });
});
document.getElementById('btn-close-export').addEventListener('click', () => $exportModal.classList.remove('open'));
$exportModal.addEventListener('click', e => { if (e.target === $exportModal) $exportModal.classList.remove('open'); });
$img.addEventListener('click', () => nav(+1));

document.getElementById('btn-todo-selall').addEventListener('click', () => {
  S.todo.forEach(x => S.selected.add(x.file)); render(); updateBulkBar();
});
document.getElementById('btn-todo-cullall').addEventListener('click', () => cullZone('todo'));
document.getElementById('btn-con-totodo').addEventListener('click', pushContendersToTodo);
document.getElementById('btn-con-cullall').addEventListener('click', () => cullZone('contenders'));

document.getElementById('btn-copy').addEventListener('click', () => {
  navigator.clipboard.writeText($rmCmd.textContent).then(() => {
    document.getElementById('btn-copy').textContent = 'copied!';
    setTimeout(() => document.getElementById('btn-copy').textContent = 'copy', 1500);
  });
});
document.getElementById('btn-close-rm').addEventListener('click', () => $rmModal.classList.remove('open'));
$rmModal.addEventListener('click', e => { if (e.target === $rmModal) $rmModal.classList.remove('open'); });

document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (e.key === 'Escape') {
    $rmModal.classList.remove('open');
    S.selected.clear(); render(); updateBulkBar(); return;
  }
  if ($rmModal.classList.contains('open')) return;
  if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); undo(); return; }
  if (e.key === 'ArrowLeft')  { e.preventDefault(); nav(-1); }
  if (e.key === 'ArrowRight') { e.preventDefault(); nav(+1); }
  if (e.key === 'd' || e.key === 'D' || e.key === 'Delete') doCull();
  if (e.key === 'k' || e.key === 'K' || e.key === 'Enter')  doKeep();
  if (e.key === 'i' || e.key === 'I') $btnInfo.click();
});

render();
if (S.todo.length) load(S.todo[0], 'todo');
</script>
</body>
</html>`
  }

  main() {
    if (!fs.existsSync(this.dir)) {
      console.error(`ERROR: directory not found: ${this.dir}`)
      process.exit(1)
    }
    const imgs = this.listImages()
    if (!imgs.length) { console.error(`ERROR: no PNG images found in ${this.dir}`); process.exit(1) }

    const outPath = this.generate()
    const url = `${this.serveUrl}/${this.relPath}/cull.html`
    console.log(`==> Generated cull.html (${imgs.length} images${this.multi ? ', multi-dir' : ''})`)
    console.log(`    ${url}`)
  }
}

function parseArgs() {
  // argv[2] is the 'cull' command token injected by grim.js's dispatcher
  const args = process.argv.slice(3)
  let dir = null, multi = false, serveRoot = null, serveUrl = null
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--all') multi = true
    else if (args[i] === '--serve-root') serveRoot = args[++i]
    else if (args[i] === '--serve-url') serveUrl = args[++i]
    else if (!dir) dir = args[i]
  }
  if (!dir) { console.error('Usage: grim cull <dir> [--all] [--serve-root DIR] [--serve-url URL]'); process.exit(1) }

  serveRoot = serveRoot || process.env.GRIM_CULL_SERVE_ROOT || DEFAULT_SERVE_ROOT
  serveUrl  = serveUrl  || process.env.GRIM_CULL_SERVE_URL  || DEFAULT_SERVE_URL

  return { dir, multi, serveRoot, serveUrl }
}

if (require.main === module) {
  new CullGen(parseArgs()).main()
}

module.exports = { CullGen }
