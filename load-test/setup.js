#!/usr/bin/env node
'use strict';

/**
 * setup.js — register N disposable test users and print one JWT per line.
 *
 * Usage:
 *   node setup.js [--users=30] [--base=http://localhost:3001] > tokens.txt
 *
 * The generated users have email hammer-<i>@loadtest.invalid and password
 * Hammer1234! — they are real accounts in the database; wipe the
 * collab_loadtest database afterwards if you don't want them to persist.
 */

const http  = require('http');
const https = require('https');
const { URL } = require('url');

function parseArgs(argv) {
  const out = {};
  for (const arg of argv) {
    const m = arg.match(/^--([^=]+)=(.+)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const args    = parseArgs(process.argv.slice(2));
const N       = parseInt(args.users ?? '30', 10);
const BASE    = args.base ?? 'http://localhost:3001';

async function post(path, body) {
  return new Promise((resolve, reject) => {
    const url    = new URL(path, BASE);
    const data   = JSON.stringify(body);
    const client = url.protocol === 'https:' ? https : http;

    const req = client.request(url, {
      method:  'POST',
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    }, (res) => {
      const chunks = [];
      // collect Set-Cookie for the token
      const setCookie = res.headers['set-cookie'] ?? [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const body = JSON.parse(Buffer.concat(chunks).toString());
        // extract token from cookie header
        let token = null;
        for (const cookie of setCookie) {
          const m = cookie.match(/(?:^|;\s*)token=([^;]+)/);
          if (m) { token = m[1]; break; }
        }
        resolve({ status: res.statusCode, body, token });
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

(async () => {
  process.stderr.write(`Registering ${N} test users against ${BASE}...\n`);

  const tokens = [];

  for (let i = 0; i < N; i++) {
    const email    = `hammer-${i}@loadtest.invalid`;
    const password = 'Hammer1234!';
    const name     = `Hammer${i}`;

    // Try register; if already exists, log in instead
    let res = await post('/api/auth/register', { email, password, displayName: name });
    if (res.status !== 201) {
      res = await post('/api/auth/login', { email, password });
    }

    if (!res.token) {
      process.stderr.write(`  ✗ user ${i}: no token (status ${res.status})\n`);
      process.exit(1);
    }

    tokens.push(res.token);
    process.stderr.write(`  ✓ user ${i}: ${name}\n`);
  }

  // Print tokens to stdout (one per line) for redirection into a file
  process.stdout.write(tokens.join('\n') + '\n');
  process.stderr.write(`Done. ${tokens.length} tokens written to stdout.\n`);
})();
