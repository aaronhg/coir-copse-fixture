#!/usr/bin/env node
// Proves the gate can actually FAIL. A gate nobody has seen go red is not a gate —
// it's a no-op you trust by accident. (cf. copse 2026-06-29 "close the audit's
// false-confidence gaps".)
//
// Seeds two regressions into a COPY of the baseline and asserts a non-zero exit:
//   1. a known finding removed  -> must be reported as NEW
//   2. a covered button claimed -> must be reported as REGRESSED
//
// Usage: node selftest.mjs [--headed]

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, copyFileSync, unlinkSync } from 'node:fs';

const BASELINE = new URL('./expected.json', import.meta.url).pathname;
const BAK = BASELINE + '.selftest-bak';
const HEADED = process.argv.includes('--headed') ? ['--headed'] : [];
const URL_ = (process.argv.find(a => a.startsWith('--url=')) || '').split('=')[1];   // CI omits it → gate's :8899 default
const URLARG = URL_ ? [`--url=${URL_}`] : [];

const runGate = () => {
    try {
        execFileSync('node', [new URL('./gate.mjs', import.meta.url).pathname, ...URLARG, ...HEADED],
            { encoding: 'utf8', stdio: 'pipe' });
        return 0;
    } catch (e) { return e.status ?? 1; }
};

copyFileSync(BASELINE, BAK);
let pass = true;
try {
    const base = JSON.parse(readFileSync(BAK, 'utf8'));

    // 1. drop an accepted finding -> the gate must surface it as NEW
    const dropped = { ...base, findings: base.findings.slice(1) };
    writeFileSync(BASELINE, JSON.stringify(dropped, null, 2));
    const a = runGate();
    console.log(`  [1] accepted finding removed   -> gate exit ${a}  ${a === 1 ? '✓ caught' : '✗ MISSED'}`);
    if (a !== 1) pass = false;

    // 2. claim a button is covered that isn't -> must be surfaced as REGRESSED
    const claimed = { ...base, coveredIds: [...base.coveredIds, 'home/Canvas/NotAReal/btn_ghost::ghost'] };
    writeFileSync(BASELINE, JSON.stringify(claimed, null, 2));
    const b = runGate();
    console.log(`  [2] phantom covered button      -> gate exit ${b}  ${b === 1 ? '✓ caught' : '✗ MISSED'}`);
    if (b !== 1) pass = false;

    // 3. control: the pristine baseline must PASS (else the gate is red-always)
    copyFileSync(BAK, BASELINE);
    const c = runGate();
    console.log(`  [3] pristine baseline (control) -> gate exit ${c}  ${c === 0 ? '✓ green' : '✗ RED-ALWAYS'}`);
    if (c !== 0) pass = false;
} finally {
    copyFileSync(BAK, BASELINE);
    unlinkSync(BAK);
}

console.log(pass ? '\nselftest: PASS — the gate fails when it should, passes when it should'
                 : '\nselftest: FAIL — the gate is not trustworthy');
process.exit(pass ? 0 : 1);
