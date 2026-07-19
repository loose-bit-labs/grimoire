'use strict';

/**
 * comfy-watch.js — Shared watch/download logic for ComfyUI jobs.
 *
 * Ports a ComfyUI WebSocket/HTTP job watcher with output download.
 * Drops the old hosts.js dependency; watchJob(promptId, opts) takes an
 * optional knownHosts array (default []) for the candidate-host search list.
 */

const http = require('http');
const net = require('net');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function parseHost(host) {
  const [hostname, port] = host.split(':');
  return { hostname, port: parseInt(port) || 13031 };
}

function elapsed(startMs) {
  const s = Math.floor((Date.now() - startMs) / 1000);
  return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`;
}

function httpGet(host, urlPath) {
  return new Promise((resolve, reject) => {
    const { hostname, port } = parseHost(host);
    http.get({ hostname, port, path: urlPath }, res => {
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
}

function download(host, filename, subfolder, outDir, destOverride) {
  return new Promise((resolve, reject) => {
    const qs = new URLSearchParams({ filename, subfolder: subfolder || '', type: 'output' });
    const { hostname, port } = parseHost(host);
    const dest = destOverride ?? path.join(outDir, filename);
    http.get({ hostname, port, path: `/view?${qs}` }, res => {
      if (res.statusCode !== 200)
        return reject(new Error(`/view returned ${res.statusCode} for ${filename}`));
      const out = fs.createWriteStream(dest);
      res.pipe(out);
      out.on('finish', () => resolve(dest));
      out.on('error', reject);
    }).on('error', reject);
  });
}

// Minimal WebSocket client — receive-only, no external deps.
// onMessage(obj) called for each JSON text frame.
// Returns { close() }.
function connectWS(host, wsPath, onMessage, onClose) {
  const { hostname, port } = parseHost(host);
  const key    = crypto.randomBytes(16).toString('base64');
  const socket = net.connect(port, hostname);
  let upgraded = false;
  let buf      = Buffer.alloc(0);

  socket.on('connect', () => {
    socket.write(
      `GET ${wsPath} HTTP/1.1\r\nHost: ${hostname}:${port}\r\n` +
      `Upgrade: websocket\r\nConnection: Upgrade\r\n` +
      `Sec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`
    );
  });

  socket.on('data', chunk => {
    buf = Buffer.concat([buf, chunk]);
    if (!upgraded) {
      const end = buf.indexOf('\r\n\r\n');
      if (end === -1) return;
      if (!buf.slice(0, end).toString().includes('101')) { socket.destroy(); return; }
      upgraded = true;
      buf = buf.slice(end + 4);
    }
    // Parse frames
    while (buf.length >= 2) {
      const opcode = buf[0] & 0x0f;
      let   len    = buf[1] & 0x7f;
      let   off    = 2;
      if (len === 126) { if (buf.length < 4) break; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) break; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      if (buf.length < off + len) break;
      const payload = buf.slice(off, off + len);
      buf = buf.slice(off + len);
      if (opcode === 0x1) { try { onMessage(JSON.parse(payload.toString())); } catch {} }
      else if (opcode === 0x8) { socket.destroy(); }
    }
  });

  socket.on('close', onClose);
  socket.on('error', onClose);
  return { close: () => socket.destroy() };
}

// Returns 'history', 'running', 'pending', or null
async function jobStatusOnHost(h, promptId) {
  try {
    const hist = JSON.parse((await httpGet(h, `/history/${promptId}`)).body.toString());
    if (hist[promptId]) return 'history';
    const q = JSON.parse((await httpGet(h, '/queue')).body.toString());
    if ((q.queue_running ?? []).some(e => e[1] === promptId)) return 'running';
    if ((q.queue_pending ?? []).some(e => e[1] === promptId)) return 'pending';
  } catch {}
  return null;
}

async function jobExistsOnHost(h, promptId) {
  return (await jobStatusOnHost(h, promptId)) !== null;
}

async function findHost(promptId, preferredHost, knownHosts) {
  const candidates = preferredHost
    ? [preferredHost, ...knownHosts.filter(h => h !== preferredHost)]
    : knownHosts;
  for (const h of candidates) {
    if (await jobExistsOnHost(h, promptId)) return h;
  }
  return null;
}

async function downloadOutputs(activeHost, entry, outDir) {
  const files = [];
  for (const node of Object.values(entry.outputs ?? {}))
    for (const key of ['images', 'videos', 'audio', 'gifs'])
      for (const f of node[key] ?? [])
        if (f.type === 'output') files.push(f);

  if (!files.length) { console.log('No output files in job history.'); return []; }

  // outDir may be a explicit file path (has extension) or a directory
  const isFilePath = path.extname(outDir) !== '';
  const downloaded = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    let dest;
    if (isFilePath) {
      // Single file: use as-is; if multiple outputs, suffix with index
      dest = files.length === 1 ? outDir
        : path.join(path.dirname(outDir), path.basename(outDir, path.extname(outDir)) + `_${i}` + path.extname(outDir));
      fs.mkdirSync(path.dirname(dest), { recursive: true });
    } else {
      fs.mkdirSync(outDir, { recursive: true });
      dest = null; // resolved inside download()
    }
    process.stdout.write(`  ↓ ${f.filename} ... `);
    const result = await download(activeHost, f.filename, f.subfolder, outDir, dest);
    const kb = Math.round(fs.statSync(result).size / 1024);
    console.log(`${result} (${kb} KB)`);
    downloaded.push(result);
  }
  return downloaded;
}

// Watch via WebSocket for real-time progress. Falls back to HTTP polling on error.
// Returns downloaded file paths.
async function watchJob(promptId, opts = {}) {
  const { host = null, outDir = '.', intervalSec = 5, knownHosts = [] } = opts;
  const start = Date.now();

  // Locate host if not given
  let activeHost = host ?? null;
  if (!activeHost) {
    process.stdout.write(`Locating ${promptId} ...`);
    activeHost = await findHost(promptId, null, knownHosts);
    process.stdout.write(activeHost ? ` found on ${activeHost}\n` : ` not found yet, searching ...\n`);
  }

  // Wait until we find the host
  while (!activeHost) {
    await new Promise(r => setTimeout(r, intervalSec * 1000));
    activeHost = await findHost(promptId, host, knownHosts);
    if (activeHost) process.stdout.write(`\n  found on ${activeHost}\n`);
    else process.stdout.write(`\r  [${elapsed(start)}] searching all hosts ...`);
  }

  // Check if already done (re-watch of completed job)
  {
    const hist = JSON.parse((await httpGet(activeHost, `/history/${promptId}`)).body.toString());
    if (hist[promptId]) {
      const s = hist[promptId].status?.status_str;
      if (s === 'success') {
        process.stdout.write(`✓ Already done — downloading\n`);
        return downloadOutputs(activeHost, hist[promptId], outDir);
      }
      if (s === 'error') {
        const msgs = hist[promptId].status?.messages ?? [];
        const msg  = msgs.find(m => m[0] === 'execution_error')?.[1]?.exception_message ?? 'unknown';
        throw new Error(`Job failed: ${msg.trim()}`);
      }
    }
  }

  // Fetch node ID→type map from the queued prompt for readable status lines
  let nodeNames = {};
  try {
    const q = JSON.parse((await httpGet(activeHost, '/queue')).body.toString());
    const entry = [...(q.queue_running ?? []), ...(q.queue_pending ?? [])]
      .find(e => e[1] === promptId);
    if (entry?.[2]) {
      for (const [id, node] of Object.entries(entry[2]))
        nodeNames[id] = node.class_type ?? id;
    }
  } catch {}

  // Show initial queue state before WS events arrive
  try {
    const q = JSON.parse((await httpGet(activeHost, '/queue')).body.toString());
    const running = (q.queue_running ?? []).find(e => e[1] === promptId);
    const pending = (q.queue_pending ?? []);
    const pendingIdx = pending.findIndex(e => e[1] === promptId);
    if (running)         process.stdout.write(`  queued: running  on ${activeHost}\n`);
    else if (pendingIdx >= 0) process.stdout.write(`  queued: pending #${pendingIdx + 1} of ${pending.length}  on ${activeHost}\n`);
  } catch {}

  // Watch via WebSocket
  return new Promise((resolve, reject) => {
    const clientId = crypto.randomUUID();
    let   step = 0, stepMax = 0, nodeType = '';
    let   queuePos = null; // null=running, N=pending position
    let   done = false;
    let   pollTimer = null;
    let   ws;

    const finish = (fn) => {
      if (done) return;
      done = true;
      if (pollTimer) clearInterval(pollTimer);
      fn();
    };

    let lastLine = '';
    const statusLine = (force = false) => {
      const parts = [`[${elapsed(start)}]`];
      if (queuePos !== null) parts.push(`pending #${queuePos}`);
      else if (nodeType)     parts.push(nodeType);
      else                   parts.push('running');
      if (stepMax)           parts.push(`step ${step}/${stepMax}`);
      parts.push(`on ${activeHost}`);
      const line = parts.join('  ');
      if (force || line !== lastLine) {
        console.log(`  ${line}`);
        lastLine = line;
      }
    };

    const resolveFromHistory = async () => {
      try {
        const hist  = JSON.parse((await httpGet(activeHost, `/history/${promptId}`)).body.toString());
        const entry = hist[promptId];
        if (!entry) { reject(new Error('No history after completion')); return; }
        const s = entry.status?.status_str;
        if (s === 'error') {
          const msgs = entry.status?.messages ?? [];
          const msg  = msgs.find(m => m[0] === 'execution_error')?.[1]?.exception_message ?? 'unknown';
          finish(() => reject(new Error(`Job failed: ${msg.trim()}`)));
        } else {
          console.log(`✓ Done in ${elapsed(start)}`);
          finish(() => resolve(downloadOutputs(activeHost, entry, outDir)));
        }
      } catch (e) { finish(() => reject(e)); }
    };

    let pollTicks = 0;
    // Background poll — catches jobs that finish before/after WS connects, and refreshes queue position
    pollTimer = setInterval(async () => {
      if (done) return;
      try {
        const q = JSON.parse((await httpGet(activeHost, '/queue')).body.toString());
        const isRunning = (q.queue_running ?? []).some(e => e[1] === promptId);
        const pendingIdx = (q.queue_pending ?? []).findIndex(e => e[1] === promptId);
        if (isRunning) {
          if (queuePos !== null) { queuePos = null; statusLine(true); }
        } else if (pendingIdx >= 0) {
          const newPos = pendingIdx + 1;
          if (queuePos !== newPos) { queuePos = newPos; statusLine(true); }
        } else {
          // Not in queue — must be in history
          ws?.close();
          await resolveFromHistory();
          return;
        }
      } catch {}
      if (++pollTicks % 6 === 0) statusLine(true); // heartbeat every ~30s
    }, intervalSec * 1000);

    ws = connectWS(activeHost, `/ws?clientId=${clientId}`, async msg => {
      if (done) return;
      if (msg.data?.prompt_id && msg.data.prompt_id !== promptId) return;

      switch (msg.type) {
        case 'progress': {
          const pct = stepMax ? Math.floor(step / stepMax * 10) : -1;
          step    = msg.data.value;
          stepMax = msg.data.max;
          // print on every 10% boundary
          const newPct = stepMax ? Math.floor(step / stepMax * 10) : -1;
          if (newPct !== pct) statusLine();
          break;
        }

        case 'executing':
          nodeType = msg.data.node ? (nodeNames[msg.data.node] ?? `node ${msg.data.node}`) : 'waiting';
          step = 0; stepMax = 0;
          statusLine(true); // always print node transitions
          break;

        case 'execution_cached':
          nodeType = 'cached';
          statusLine(true);
          break;

        case 'execution_success':
          ws.close();
          await resolveFromHistory();
          break;

        case 'execution_error':
          finish(() => reject(new Error(`Job failed: ${(msg.data?.exception_message ?? 'unknown').trim()}`)));
          break;
      }
    }, () => {
      // WS closed — poll will catch completion if not already done
    });
  });
}

module.exports = { watchJob, connectWS };
