#!/usr/bin/env node
// THE GATE — the CI-able join.
//
//   coir  (static: what the editor WIRED)  ─┐
//                                           ├─▶ copse coverage ─▶ buckets ─▶ exit 0/1
//   copse (runtime: what a player can HIT) ─┘
//
// The problem this solves, that neither tool solves alone:
//   "You wired a button in the editor. Can a player actually reach it in the build?"
//     coir  knows it's wired, but never runs the game -> can't know if it's reachable.
//     copse knows what's reachable, but not what SHOULD have been wired.
//   Only the join can say: this button is wired AND unreachable -> a real defect.
//
// Green normally, red on REGRESSION: findings are diffed against expected.json
// (policy committed to the repo, same idea as coir.rules.json).
//
// Usage: node gate.mjs [--url http://127.0.0.1:8899/] [--headed] [--update]

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

// point COPSE_CLI at your copse checkout; the default assumes copse is a sibling of this repo
const COPSE = process.env.COPSE_CLI || new URL('../../copse/src/cli.js', import.meta.url).pathname;
const arg = (k, d) => (process.argv.find(a => a.startsWith(`--${k}=`)) || `--${k}=${d}`).split('=').slice(1).join('=');
const URL_ = arg('url', 'http://127.0.0.1:8899/');
const HEADED = process.argv.includes('--headed');
const UPDATE = process.argv.includes('--update');
const ROWS = new URL('./coir-rows.json', import.meta.url).pathname;
const BASELINE = new URL('./expected.json', import.meta.url).pathname;

// ── run the shipped join ────────────────────────────────────────────────────
const args = [COPSE, 'coverage', URL_, ROWS, ...(HEADED ? ['--headed'] : [])];
const cov = JSON.parse(execFileSync('node', args, { encoding: 'utf8', maxBuffer: 64 << 20 }));

// ── reduce to a stable finding set ──────────────────────────────────────────
const id = (o) => `${o.nodePath || o.ref}::${o.method ?? 'null'}`;
const findings = [
    ...cov.blocked.map(o => ({ kind: 'wired-but-unreachable', id: id(o), blockedBy: o.runtime?.blockedBy })),
    ...cov.ambiguous.map(o => ({ kind: 'ambiguous', id: id(o), reason: o.reason })),
    ...cov.uncertain.map(o => ({ kind: 'uncertain', id: id(o) })),
    ...cov.codeOnly.map(o => ({ kind: 'dead-button', id: id(o) })),
].sort((a, b) => (a.kind + a.id).localeCompare(b.kind + b.id));

const coveredIds = cov.covered.map(id).sort();

if (UPDATE) {
    writeFileSync(BASELINE, JSON.stringify({ findings, coveredIds }, null, 2));
    console.log(`baseline written: ${findings.length} accepted findings, ${coveredIds.length} covered`);
    process.exit(0);
}

const base = existsSync(BASELINE)
    ? JSON.parse(readFileSync(BASELINE, 'utf8'))
    : { findings: [], coveredIds: [] };

const baseIds = new Set(base.findings.map(f => `${f.kind}|${f.id}`));
const newFindings = findings.filter(f => !baseIds.has(`${f.kind}|${f.id}`));
const regressed = base.coveredIds.filter(c => !coveredIds.includes(c));

// ── report ──────────────────────────────────────────────────────────────────
const L = '─'.repeat(72);
console.log(`\n${L}\n coir × copse gate  ·  ${URL_}\n${L}`);
console.log(` wired (coir)      : ${JSON.parse(readFileSync(ROWS, 'utf8')).length}`);
console.log(` covered           : ${cov.covered.length}`);
console.log(` unreached         : ${cov.unreached.length}   (needs navigation — not a failure)`);
console.log(` accepted findings : ${base.findings.length}   (see expected.json)\n`);

for (const f of findings) {
    const known = baseIds.has(`${f.kind}|${f.id}`);
    console.log(`  ${known ? '·' : '✗ NEW'}  [${f.kind}] ${f.id}${f.blockedBy ? `  blockedBy=${f.blockedBy}` : ''}`);
}

let fail = false;
if (newFindings.length) {
    console.log(`\n ✗ ${newFindings.length} NEW finding(s) not in expected.json`);
    fail = true;
}
if (regressed.length) {
    console.log(`\n ✗ ${regressed.length} previously-covered button(s) REGRESSED (no longer reachable):`);
    for (const r of regressed) console.log(`     ${r}`);
    fail = true;
}
if (!fail) console.log(`\n ✓ matches expected.json — no regression`);
console.log(`\n${L}\n`);
process.exit(fail ? 1 : 0);
