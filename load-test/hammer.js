#!/usr/bin/env node
'use strict';

/**
 * hammer.js — WebSocket load tester for the collaborative editor.
 *
 * Usage:
 *   node hammer.js --session=<sessionId> --token=<guestJwt> \
 *                  [--users=30] [--duration=60] [--host=ws://localhost:3001]
 *
 * Requires:  npm install  (installs the ws package in this directory)
 */

const { WebSocket } = require('ws');
const { performance } = require('perf_hooks');

// ── CLI ─────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = {};
  for (const arg of argv) {
    const m = arg.match(/^--([^=]+)=(.+)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

const NUM_USERS  = parseInt(args.users    ?? '30',                  10);
const SESSION_ID = args.session;
const TOKEN      = args.token;
const DURATION_S = parseInt(args.duration ?? '60',                  10);
const WS_BASE    = args.host              ?? 'ws://localhost:3001';

if (!SESSION_ID || !TOKEN) {
  console.error(
    '\nUsage: node hammer.js --session=<sessionId> --token=<jwt>\n' +
    '                      [--users=30] [--duration=60] [--host=ws://localhost:3001]\n'
  );
  process.exit(1);
}

// ── Per-client stats ─────────────────────────────────────────────────────────

class ClientStats {
  constructor(id) {
    this.id         = id;
    this.sent       = 0;
    this.acked      = 0;
    this.dropped    = 0;     // pending ops still unacked when client stopped
    this.rtts       = [];    // raw RTT samples in ms
    this.drops      = 0;     // unexpected connection closes
    this.reconnects = 0;
    // FIFO queue of performance.now() values, one per sent op
    this._pendingTimes = [];
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const CHARS = 'abcdefghijklmnopqrstuvwxyz ';

function randomChar() {
  return CHARS[Math.floor(Math.random() * CHARS.length)];
}

// ── Client factory ───────────────────────────────────────────────────────────

const SEND_INTERVAL_MS = 500;
const BACKOFF_BASE_MS  = 500;
const BACKOFF_MAX_MS   = 15_000;

function spawnClient(stats) {
  let ws;
  let revision    = 0;
  let docLen      = 0;     // estimated local doc length (inserts only, no OT)
  let sendTimer   = null;
  let stopped     = false;
  let attempt     = 0;

  function clearSendTimer() {
    if (sendTimer !== null) {
      clearInterval(sendTimer);
      sendTimer = null;
    }
  }

  function connect() {
    if (stopped) return;

    ws = new WebSocket(`${WS_BASE}/sessions/${SESSION_ID}?token=${TOKEN}`);

    ws.on('open', () => {
      if (attempt > 0) stats.reconnects++;
      attempt = 0;

      sendTimer = setInterval(() => {
        if (stopped || ws.readyState !== WebSocket.OPEN) return;

        // Random insert at a valid position in our estimated doc
        const pos  = Math.floor(Math.random() * (docLen + 1));
        const text = randomChar();
        docLen++;

        const sendTime = performance.now();
        stats._pendingTimes.push(sendTime);
        stats.sent++;

        ws.send(JSON.stringify({
          type:    'op',
          payload: { revision, ops: [{ type: 'insert', position: pos, text }] },
        }));
      }, SEND_INTERVAL_MS);
    });

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }

      switch (msg.type) {
        case 'ping':
          ws.send(JSON.stringify({ type: 'pong' }));
          break;

        case 'ack': {
          const sendTime = stats._pendingTimes.shift();
          if (sendTime != null) {
            stats.rtts.push(performance.now() - sendTime);
            stats.acked++;
          }
          if (msg.payload?.revision != null) revision = msg.payload.revision;
          break;
        }

        case 'op':
          // Remote op from another client — advance revision, ignore doc delta
          if (msg.payload?.revision != null) revision = msg.payload.revision;
          break;

        // presence, cursor, reload, error — no action needed for load testing
      }
    });

    ws.on('close', () => {
      clearSendTimer();
      if (!stopped) {
        stats.drops++;
        const delay = Math.min(BACKOFF_BASE_MS * Math.pow(2, attempt), BACKOFF_MAX_MS);
        attempt++;
        setTimeout(connect, delay);
      }
    });

    ws.on('error', () => {
      // 'close' fires immediately after 'error'; reconnect logic lives there
    });
  }

  connect();

  return {
    stop() {
      stopped = true;
      clearSendTimer();
      // All ops still in the pending queue were never acked → count as dropped
      stats.dropped    += stats._pendingTimes.length;
      stats._pendingTimes = [];
      if (ws && ws.readyState === WebSocket.OPEN) ws.close(1000, 'done');
    },
  };
}

// ── Statistics helpers ────────────────────────────────────────────────────────

/** Return the p-th percentile of a sorted array. */
function pct(sorted, p) {
  if (sorted.length === 0) return NaN;
  const idx = Math.min(
    Math.floor((sorted.length * p) / 100),
    sorted.length - 1
  );
  return sorted[idx];
}

function fmtMs(n) {
  return Number.isNaN(n) ? '   —  ' : `${n.toFixed(1)} ms`;
}

function pad(s, w) {
  return String(s).padStart(w);
}

// ── Report ────────────────────────────────────────────────────────────────────

function printReport(allStats, elapsedMs) {
  const totalSent     = allStats.reduce((s, c) => s + c.sent,       0);
  const totalAcked    = allStats.reduce((s, c) => s + c.acked,      0);
  const totalDropped  = allStats.reduce((s, c) => s + c.dropped,    0);
  const totalDrops    = allStats.reduce((s, c) => s + c.drops,      0);
  const totalReconns  = allStats.reduce((s, c) => s + c.reconnects, 0);

  const allRtts   = allStats.flatMap((c) => c.rtts).sort((a, b) => a - b);
  const elapsedS  = elapsedMs / 1000;
  const throughput = totalAcked / elapsedS;

  const W = 14; // value column width

  console.log('\n╔══════════════════════════════════════╗');
  console.log('║        HAMMER  LOAD  TEST  REPORT    ║');
  console.log('╚══════════════════════════════════════╝\n');
  console.log(`  Session        : ${SESSION_ID}`);
  console.log(`  Users          : ${NUM_USERS}`);
  console.log(`  Duration       : ${elapsedS.toFixed(1)} s\n`);

  console.log('  ── Operations ──────────────────────────');
  console.log(`  Sent           :${pad(totalSent,     W)}`);
  console.log(`  Acked          :${pad(totalAcked,    W)}`);
  console.log(`  Dropped        :${pad(totalDropped,  W)}`);
  console.log(`  Throughput     :${pad(throughput.toFixed(1) + ' ops/s', W)}\n`);

  console.log('  ── Round-trip time ─────────────────────');
  console.log(`  Samples        :${pad(allRtts.length, W)}`);
  console.log(`  p50            :${pad(fmtMs(pct(allRtts, 50)), W)}`);
  console.log(`  p95            :${pad(fmtMs(pct(allRtts, 95)), W)}`);
  console.log(`  p99            :${pad(fmtMs(pct(allRtts, 99)), W)}`);
  console.log(`  min            :${pad(fmtMs(allRtts[0]),                 W)}`);
  console.log(`  max            :${pad(fmtMs(allRtts[allRtts.length - 1]), W)}\n`);

  console.log('  ── Connections ─────────────────────────');
  console.log(`  Unexpected drops :${pad(totalDrops,   W - 2)}`);
  console.log(`  Reconnects       :${pad(totalReconns, W - 2)}`);
  console.log('');
}

// ── Main ─────────────────────────────────────────────────────────────────────

console.log(`\nHammer — ${NUM_USERS} users · session=${SESSION_ID} · duration=${DURATION_S}s\n`);

const allStats      = Array.from({ length: NUM_USERS }, (_, i) => new ClientStats(i));
const clientHandles = [];

// Stagger connects by 30 ms each to avoid a thundering herd on accept()
allStats.forEach((stats, i) => {
  setTimeout(() => clientHandles.push(spawnClient(stats)), i * 30);
});

const startTime = performance.now();

// Live progress line
const tickInterval = setInterval(() => {
  const sent    = allStats.reduce((s, c) => s + c.sent,  0);
  const acked   = allStats.reduce((s, c) => s + c.acked, 0);
  const drops   = allStats.reduce((s, c) => s + c.drops, 0);
  const elapsed = ((performance.now() - startTime) / 1000).toFixed(0);
  process.stdout.write(
    `\r  [${String(elapsed).padStart(3)}s]  sent=${sent}  acked=${acked}  drops=${drops}   `
  );
}, 1000);

setTimeout(() => {
  clearInterval(tickInterval);
  process.stdout.write('\n');

  // Signal all clients to stop; give 1.5 s for any in-flight acks to land
  clientHandles.forEach((h) => h.stop());

  setTimeout(() => {
    printReport(allStats, performance.now() - startTime);
    process.exit(0);
  }, 1500);
}, DURATION_S * 1000);
