#!/usr/bin/env node
// Approach A (static): which flow tests are RELATED to a change impact.
//
// The mapping is one more nodePath join — the same key coir×copse meet on. A risk set from
// `coir impact -o json` lists the impacted buttons (nodePath, method); a flow test drives some
// nodePaths (its press `ref`s, its get/patch `sel`s, the `cc.find('…')`s in its `eval`s). A test
// is RELATED iff a nodePath it drives tail-matches an impacted button's nodePath. No game is run.
//
// Usage:  node related-tests.mjs <risk.json | -> [testsDir=tests] [--json]
//   risk = the JSON `coir impact` prints (impactedButtons[], impactedScenes[]).
//   Exit 0 always; the report is the output (the gate decides what to do with it).

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const segs = (p) => String(p || '').split('/').filter(Boolean).map((s) => s.replace(/\[\d+\]$/, ''));
// do a and b share a full tail (the shorter's segments are a suffix of the longer's)? Absorbs coir's
// scene-root prefix (`fixture/Canvas/Btn`) vs copse's runtime ref (`Canvas/Btn`). MIN tail = 2, or a
// full-length alignment — so a lone generic leaf can't false-match (mirrors the coverage join).
function tailMatch(a, b) {
  const s = segs(a), r = segs(b), n = Math.min(s.length, r.length);
  if (!n) return false;
  for (let k = 1; k <= n; k++) if (s[s.length - k] !== r[r.length - k]) return false;
  return n >= 2 || s.length === r.length;
}

// The nodePaths a test statically drives: press `ref`, get/patch `sel` (path before `:Comp.member`),
// and each `cc.find('path')` inside an `eval` expression (the tripwires reach nodes that way).
function drivenPaths(script) {
  const out = new Set();
  for (const st of script.steps || []) {
    if (st.ref) out.add(st.ref);
    if (st.sel) out.add(String(st.sel).split(':')[0]);
    if (st.expr) for (const m of String(st.expr).matchAll(/cc\.find\(\s*['"]([^'"]+)['"]/g)) out.add(m[1]);
  }
  return [...out];
}

const riskArg = process.argv[2];
const testsDir = process.argv.find((a, i) => i >= 3 && !a.startsWith('--')) || 'tests';
const asJson = process.argv.includes('--json');
if (!riskArg) { console.error('usage: related-tests.mjs <risk.json|-> [testsDir] [--json]'); process.exit(2); }

const risk = JSON.parse(riskArg === '-' ? readFileSync(0, 'utf8') : readFileSync(riskArg, 'utf8'));
const riskButtons = (risk.impactedButtons || []).map((b) => b.nodePath);
const sceneOnly = riskButtons.length === 0 && (risk.impactedScenes || []).length > 0; // a scene/prefab changed structurally but wired nothing specific → can't narrow, keep all

const files = readdirSync(testsDir).filter((f) => f.endsWith('.json')).sort();
const related = [], skipped = [];
for (const f of files) {
  const script = JSON.parse(readFileSync(join(testsDir, f), 'utf8'));
  const driven = drivenPaths(script);
  const hits = sceneOnly
    ? ['(scene changed — run all)']
    : [...new Set(driven.filter((d) => riskButtons.some((rp) => tailMatch(d, rp))))];
  if (hits.length) related.push({ file: f, name: script.name || f, hits });
  else skipped.push(f);
}

if (asJson) { console.log(JSON.stringify({ related, skipped, sceneOnly })); process.exit(0); }
console.log(`related tests — ${related.length}/${files.length} touch the risk set${sceneOnly ? '  (scene-level change → all kept)' : ''}`);
for (const r of related) console.log(`  ▶ ${r.file}   (${r.name})   ↔ ${r.hits.join(', ')}`);
for (const f of skipped) console.log(`  · skip ${f}`);
