# Brief — Phase 62: HMM fleet fan-out + live push (SSE) + Prometheus

Phase 61 is accepted (`0298`). Proceed to **phase 62** — turn the aid-only slice into a fleet-wide,
live view. Full brief: `plans/phase-62.md` — **re-read it, it was just revised (`3a3b8f4`).**

## One architecture ruling you must follow (I verified the code first)

**Use Server-Sent Events, NOT WebSocket, for the live push.** I checked: the grimoire server is
Express with **no `ws` dependency installed** and no upgrade handling. The push is strictly
server→browser (the viewer never sends), which is SSE's exact use case. So:
- `GET /api/hmm/stream` — `Content-Type: text/event-stream`, hold the response open, one shared poll
  timer diffs the fan-out and writes `data: <json>\n\n` **only on change**, clean up on `req.on('close')`.
- Viewer subscribes with `new EventSource('/api/hmm/stream')`, falls back to polling `GET /api/hmm`.
- **Add NO new npm dependency.** If you think you need `ws` or anything else — escalate, don't install.

## The rest (headlines — full detail + success bar in the brief)

- **Fan-out** `GET /api/hmm`: mirror `grim rig`'s `/fleet`→`/status` shape (per-box `http.get` +
  `AbortSignal.timeout`, `Promise.allSettled`), merge `{ boxes:[{host,up,projects}] }`. A down box →
  `up:false, projects:[]`, **never** 500s the response. Boxes from `rig.json`, resolved not hardcoded.
- **Prometheus** `hmm_*` gauges folded into each rig agent's existing `/metrics` text:
  `hmm_participant_status{host,project,role,status}` + `hmm_last_activity_seconds{host,project,role}`.
  Bounded cardinality — **no phase/message-id labels**. Viewer never reads Prometheus (side channel).
- **Viewer**: host + project switcher, live meeple updates off the SSE stream.

## Acceptance bar (verify in the real path — I will reproduce it)

- `curl /api/hmm` covers the reachable fleet; **kill one box's rig agent** → response still 200 with
  that box `up:false`, others fine. Capture both runs.
- `curl -N /api/hmm/stream` → cause a real `.mm` status change → the `data:` event arrives within one
  `HMM_POLL_SEC`. "Connects" is not acceptance — a real change must propagate.
- `curl <box>:18081/metrics | grep hmm_` shows sane bounded labels; Prometheus returns the series.
- Don't regress 61's plain REST path. Full suite green + self-terminating. Ephemeral ports in any new
  server test (phase-66 lesson). `grep -i ws package.json` proves no WebSocket dep was added.

Multi-part (A–D) — report must speak to **each** by name (phase-66 lesson). Footprint is fixed in the
brief; anything outside → escalate. Go.
