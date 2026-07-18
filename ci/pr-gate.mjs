#!/usr/bin/env node
// F2 — the diff-gate (the layered trigger). Given a change set, decide whether there is any UI
// surface to test; if so, run ONLY the affected flow tests (approach A) plus the F3 coverage-
// regression gate. Empty risk → skip (a README / pure-logic PR pays nothing); non-empty → the
// deterministic checks, scoped to what changed. Zero LLM.
//
// Usage:  node pr-gate.mjs (--patch <file|-> | <changedPath…>)
// Env:    COIR_CLI, COPSE_CLI, GAME_URL (default http://127.0.0.1:8899/)
// Exit:   0 = green (or skipped) · 1 = a related test failed or coverage regressed.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, copyFileSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HERE = new URL('.', import.meta.url).pathname;
const ROOT = join(HERE, '..');
const COIR = process.env.COIR_CLI || join(ROOT, '../coir/src/cli.js');
const COPSE = process.env.COPSE_CLI || join(ROOT, '../copse/src/cli.js');
const URL_ = process.env.GAME_URL || 'http://127.0.0.1:8899/';
const argv = process.argv.slice(2);
const headed = argv.includes('--headed') ? ['--headed'] : []; // local convenience; CI runs headless
const sh = (args, opts = {}) => execFileSync('node', args, { encoding: 'utf8', ...opts });

// 1. impact → risk set (from a --patch diff, else positional changed paths)
const pi = argv.indexOf('--patch');
const impactArgs = [COIR, '-C', ROOT, 'impact'];
let input;
if (pi >= 0) { const src = argv[pi + 1]; impactArgs.push('--patch', '-'); input = src === '-' ? readFileSync(0, 'utf8') : readFileSync(src, 'utf8'); }
else impactArgs.push(...argv.filter((a) => !a.startsWith('--')));
impactArgs.push('-o', 'json');
const risk = JSON.parse(sh(impactArgs, input ? { input } : {}));
const nB = (risk.impactedButtons || []).length, nS = (risk.impactedScenes || []).length;
console.log(`impact — ${risk.changed.length} changed · ${nS} scene/prefab · ${nB} button(s) · risk ${risk.riskScore}`);

// 2. layered trigger: nothing wired-and-testable → skip the expensive checks
if (!nB && !nS) { console.log('\n✅ skip — this change touches no UI surface (no gate run)'); process.exit(0); }

// 3. affected tests (approach A — static nodePath intersection; `copse affected` is the runtime-format sibling of coir's `impact`)
const aff = JSON.parse(sh([COPSE, 'affected', '-', join(HERE, 'tests')], { input: JSON.stringify(risk) }));
console.log(`affected — ${aff.affected.length}/${aff.affected.length + aff.skipped.length} tests: ${aff.affected.map((r) => r.name).join(', ') || '(none)'}`);

let rc = 0;
// 4. run ONLY the affected flow tests (staged into a temp dir so one `copse run` emits JUnit)
if (aff.affected.length) {
  const stage = mkdtempSync(join(tmpdir(), 'pr-tests-'));
  for (const r of aff.affected) copyFileSync(join(HERE, 'tests', r.name), join(stage, r.name));
  mkdirSync(join(HERE, 'results'), { recursive: true });
  console.log('\n── related flow suite ─────────────────────────────');
  try { console.log(sh([COPSE, 'run', URL_, stage, '--junit', join(HERE, 'results/junit.xml'), ...headed])); }
  catch (e) { console.log((e.stdout || '') + (e.stderr || '')); rc = 1; }
}

// 5. F3 — coverage-regression gate (coir clickmap × copse coverage vs expected.json)
console.log('── coverage gate (F3) ─────────────────────────────');
try {
  writeFileSync(join(HERE, 'coir-rows.json'), sh([COIR, '-C', ROOT, 'clickmap', 'scene/fixture.scene', '-o', 'json']));
  console.log(sh([join(HERE, 'gate.mjs'), `--url=${URL_}`, ...headed], { env: { ...process.env, COPSE_CLI: COPSE } }));
} catch (e) { console.log((e.stdout || '') + (e.stderr || '')); rc = 1; }

console.log(rc ? '\n❌ gate failed' : '\n✅ gate green');
process.exit(rc);
