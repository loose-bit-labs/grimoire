'use strict';

/**
 * comfy-client.js — ComfyUI workflow queue client
 *
 * Queues workflow JSON via /prompt API, uploads files, parses --set overrides.
 * Uses node stdlib only (fs, http, path) — no external deps.
 */

const fs = require('fs');
const http = require('http');
const path = require('path');

const DEFAULT_HOST = 'aid:13031';
const COMFY_HOST = process.env.GRIMOIRE_COMFY_HOST || DEFAULT_HOST;

// Per-request agent with keepAlive:false — prevents connection-pool leak
// in long-lived daemons (free-watchdog accumulates ESTAB conns otherwise).
const REQ_AGENT = new http.Agent({ keepAlive: false });

const WIDGET_TYPES = new Set(['STRING', 'INT', 'FLOAT', 'BOOLEAN']);
const SEED_CONTROL = new Set(['fixed', 'randomize', 'increment', 'decrement']);

class ComfyQueue {
  constructor(host = COMFY_HOST) {
    this.host = host;
    this.schemas = null;
  }

  get(p) {
    return new Promise((resolve, reject) => {
      const [hostname, port] = this.host.split(':');
      http.get({ hostname, port: parseInt(port), path: p, agent: REQ_AGENT }, res => {
        let buf = '';
        res.on('data', d => buf += d);
        res.on('end', () => resolve(JSON.parse(buf)));
      }).on('error', reject);
    });
  }

  post(p, body) {
    return new Promise((resolve, reject) => {
      const data = JSON.stringify(body);
      const [hostname, port] = this.host.split(':');
      const req = http.request({
        hostname, port: parseInt(port), path: p, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
        agent: REQ_AGENT
      }, res => {
        let buf = '';
        res.on('data', d => buf += d);
        res.on('end', () => resolve({ status: res.statusCode, body: buf ? JSON.parse(buf) : null }));
      });
      req.on('error', reject);
      req.write(data);
      req.end();
    });
  }

  isWidget(typeSpec) {
    if (typeSpec[0] === 'COMBO' || Array.isArray(typeSpec[0])) return true;
    return WIDGET_TYPES.has(typeSpec[0]);
  }

  schemaWidgets(schema) {
    const all = [
      ...Object.entries(schema.input?.required || {}),
      ...Object.entries(schema.input?.optional || {})
    ];
    return all.filter(([, spec]) => this.isWidget(spec));
  }

  buildPrompt(workflow) {
    const links = {};
    for (const link of (workflow.links || [])) {
      // Standard ComfyUI: [link_id, srcNode, srcSlot, dstNode, dstSlot, TYPE]  (TYPE at index 5)
      // Wantan hand-authored: [srcNode, srcSlot, dstNode, dstSlot, TYPE, sub]  (TYPE at index 4)
      let srcNode, srcSlot, dstNode, dstSlot;
      if (typeof link[5] === 'string') {
        [, srcNode, srcSlot, dstNode, dstSlot] = link;
      } else {
        [srcNode, srcSlot, dstNode, dstSlot] = link;
      }
      if (!links[dstNode]) links[dstNode] = {};
      links[dstNode][dstSlot] = [String(srcNode), srcSlot];
    }

    const prompt = {};
    for (const node of (workflow.nodes || [])) {
      const id = String(node.id);
      const schema = this.schemas?.[node.type];
      const widgetValues = node.widgets_values || [];
      const nodeLinks = links[node.id] || {};
      const inputs = {};

      const hasInlineWidgets = (node.inputs || []).some(i => i.widget);

      if (hasInlineWidgets) {
        const linkedSlots = new Set(Object.keys(nodeLinks).map(Number));
        let widgetIdx = 0;
        for (let s = 0; s < (node.inputs || []).length; s++) {
          const inp = node.inputs[s];
          if (linkedSlots.has(s)) {
            inputs[inp.name] = nodeLinks[s];
          } else if (inp.widget) {
            let val = widgetValues[widgetIdx++];
            if (inp.name === 'seed' && SEED_CONTROL.has(widgetValues[widgetIdx])) widgetIdx++;
            inputs[inp.name] = val;
          }
        }
      } else {
        for (const inp of (node.inputs || [])) {
          const slot = inp.slot_index ?? (node.inputs || []).indexOf(inp);
          if (nodeLinks[slot] !== undefined) inputs[inp.name] = nodeLinks[slot];
        }

        if (schema) {
          let widgetIdx = 0;
          for (const [name, spec] of this.schemaWidgets(schema)) {
            if (widgetIdx >= widgetValues.length) break;
            if (inputs[name] !== undefined) continue;
            let val = widgetValues[widgetIdx++];
            if ((name === 'seed' || name === 'noise_seed') && SEED_CONTROL.has(widgetValues[widgetIdx])) widgetIdx++;
            inputs[name] = val;
          }
        } else if (widgetValues.length > 0) {
          console.warn(`  ⚠ No schema for ${node.type} (id ${id}), ${widgetValues.length} widget values unmapped`);
        }
      }

      prompt[id] = { class_type: node.type, inputs };
    }
    return prompt;
  }

  // Parse --set args: NodeType.key=value or NodeID.key=value
  // Special value "random" → random uint32 seed
  parseOverrides(args) {
    const overrides = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] !== '--set' || !args[i + 1]) continue;
      const raw = args[++i];
      const dot = raw.indexOf('.');
      const eq  = raw.indexOf('=');
      if (dot < 0 || eq <= dot) {
        console.error(`⚠ --set needs Type.key=value or ID.key=value, got: ${raw}`);
        continue;
      }
      const target = raw.slice(0, dot);
      const key    = raw.slice(dot + 1, eq);
      const rawVal = raw.slice(eq + 1);
      let value;
      if (rawVal === 'random') {
        value = Math.floor(Math.random() * 2 ** 32);
      } else {
        try { value = JSON.parse(rawVal); } catch { value = rawVal; }
      }
      overrides.push({ target, key, value });
    }
    return overrides;
  }

  // Apply overrides to a built prompt in-place
  applyOverrides(prompt, overrides) {
    for (const { target, key, value } of overrides) {
      let hits = 0;
      for (const [id, node] of Object.entries(prompt)) {
        if (node.class_type === target || id === target) {
          node.inputs[key] = value;
          hits++;
        }
      }
      const display = String(JSON.stringify(value));
      const preview = display.length > 64 ? display.slice(0, 61) + '...' : display;
      if (hits) console.log(`  → ${target}.${key} = ${preview}${hits > 1 ? ` (×${hits})` : ''}`);
      else       console.warn(`  ⚠ --set: no node matching "${target}"`);
    }
  }

  // Upload a local file to ComfyUI's input folder.
  // Returns the server-side filename to use in workflow nodes.
  upload(localPath) {
    return new Promise((resolve, reject) => {
      const filename = path.basename(localPath);
      const fileData = fs.readFileSync(localPath);
      const boundary = '----WantanBoundary' + Math.random().toString(36).slice(2);
      // All files go through /upload/image — audio nodes (LoadAudio) scan input/,
      // which is where this endpoint lands files. /upload/audio puts files in a
      // subfolder that LoadAudio doesn't enumerate.
      const field    = 'image';
      const endpoint = '/upload/image';

      const body = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`),
        fileData,
        Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="type"\r\n\r\ninput\r\n--${boundary}--\r\n`),
      ]);

      const [hostname, port] = this.host.split(':');
      const req = http.request({
        hostname, port: parseInt(port), path: endpoint, method: 'POST',
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': body.length },
        agent: REQ_AGENT
      }, res => {
        let buf = '';
        res.on('data', d => buf += d);
        res.on('end', () => {
          try { resolve(JSON.parse(buf).name ?? filename); }
          catch { resolve(filename); }
        });
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  // If localPath exists on disk, upload it and return the server filename.
  // Otherwise assume it's already in ComfyUI's input folder and return as-is.
  async maybeUpload(filePath) {
    if (!filePath) return filePath;
    const abs = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
    if (!fs.existsSync(abs)) return filePath;
    const serverName = await this.upload(abs);
    console.log(`  → uploaded ${path.basename(abs)} → ${serverName}`);
    return serverName;
  }

  async loadSchemas() {
    if (!this.schemas) {
      process.stdout.write(`Fetching schemas from http://${this.host}/object_info ... `);
      this.schemas = await this.get('/object_info');
      console.log(`${Object.keys(this.schemas).length} node types loaded`);
    }
  }

  // Parse a single "Type.key=value" or "ID.key=value" string into { target, key, value }
  parseOneOverride(raw) {
    const dot = raw.indexOf('.');
    const eq  = raw.indexOf('=');
    if (dot < 0 || eq <= dot) {
      console.error(`⚠ override needs Type.key=value or ID.key=value, got: ${raw}`);
      return null;
    }
    const target = raw.slice(0, dot);
    const key    = raw.slice(dot + 1, eq);
    const rawVal = raw.slice(eq + 1);
    let value;
    if (rawVal === 'random') {
      value = Math.floor(Math.random() * 2 ** 32);
    } else {
      try { value = JSON.parse(rawVal); } catch { value = rawVal; }
    }
    return { target, key, value };
  }

  // Core queue method — usable from skill scripts
  // overrides: array of "Type.key=value" strings OR { target, key, value } objects
  async queue(workflowPathOrObj, overrides = []) {
    const workflow = typeof workflowPathOrObj === 'string'
      ? JSON.parse(fs.readFileSync(workflowPathOrObj, 'utf8'))
      : workflowPathOrObj;

    await this.loadSchemas();
    const prompt = this.buildPrompt(workflow);
    if (overrides.length) {
      const parsed = overrides
        .map(o => typeof o === 'string' ? this.parseOneOverride(o) : o)
        .filter(Boolean);
      this.applyOverrides(prompt, parsed);
    }

    const res = await this.post('/prompt', { prompt, client_id: 'wantan-cli' });
    if (res.status === 200 && res.body.prompt_id) {
      console.log(`✓ Queued — prompt_id: ${res.body.prompt_id}`);
      return res.body.prompt_id;
    }
    throw new Error(JSON.stringify(res.body, null, 2));
  }

  // Force ComfyUI to drop cached models/LoRA patches so the next queue() reloads
  // clean weights from disk. See call site in i2v.js for why this exists.
  async freeMemory() {
    return this.post('/free', { unload_models: true, free_memory: true });
  }

  // Abort whatever prompt is currently executing. Used by free-watchdog.js to
  // stop a running job early once it knows that job is using the same
  // drifted weights as one that just came out fried — no point burning the
  // rest of that GPU time on guaranteed-bad output.
  async interrupt() {
    return this.post('/interrupt', {});
  }

  async main() {
    const args = process.argv.slice(2);

    // Find --host value
    const hostIdx = args.findIndex(a => a === '--host');
    if (hostIdx !== -1) this.host = args[hostIdx + 1];

    const dryRun = args.includes('--dry-run');

    // Find workflow path: first non-flag arg not consumed by --host/--set
    const consumed = new Set();
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--host' || args[i] === '--set') { consumed.add(i); consumed.add(i + 1); i++; }
      if (args[i] === '--dry-run') consumed.add(i);
    }
    const workflowPath = args.find((a, i) => !consumed.has(i) && !a.startsWith('--'));

    if (!workflowPath) {
      console.error('Usage: comfy-queue.js <workflow.json> [--host HOST] [--set Type.key=val ...] [--dry-run]');
      process.exit(1);
    }

    const overrides = this.parseOverrides(args);
    console.log(`Queuing ${workflowPath} → http://${this.host}/prompt`);

    if (dryRun) {
      const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
      await this.loadSchemas();
      const prompt = this.buildPrompt(workflow);
      if (overrides.length) this.applyOverrides(prompt, overrides);
      console.log('\n-- DRY RUN --');
      console.log(JSON.stringify(prompt, null, 2));
      return;
    }

    await this.queue(workflowPath, overrides);
  }
}

if (require.main === module) {
  new ComfyQueue().main().catch(e => { console.error(e.message || e); process.exit(1); });
}

module.exports = { ComfyQueue };
