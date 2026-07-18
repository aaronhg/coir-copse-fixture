// Zero-LLM tests for the AI-QA harness's PURE halves: F7 aggregation (stable/flaky over N runs)
// and F5 serialization (a finding → a deterministic `copse run` tripwire). The live plan/judge
// path is exercised separately (node ai-qa.mjs <url>); these lock the logic that gates on it.
//   run:  node --test ci/ai-qa.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregate, toScript } from './ai-qa.mjs';

test('aggregate (F7): majority vote over N → stable / flaky / missed', () => {
  const runs = [
    // bug A: 3/3 → stable
    { id: 'a', bug: '#3', kind: 'semantic', detected: true, by: 'judge', reason: 'label lies' },
    { id: 'a', bug: '#3', kind: 'semantic', detected: true, by: 'judge', reason: 'label lies' },
    { id: 'a', bug: '#3', kind: 'semantic', detected: true, by: 'judge', reason: 'stale floor' },
    // bug B: 1/3 → flaky (need ⌈3/2⌉=2)
    { id: 'b', bug: '#4', kind: 'semantic', detected: true, by: 'judge', reason: 'tally kept' },
    { id: 'b', bug: '#4', kind: 'semantic', detected: false, by: '—', reason: 'no issue found' },
    { id: 'b', bug: '#4', kind: 'semantic', detected: false, by: '—', reason: 'no issue found' },
    // bug C: 2/3 → stable (exactly the majority threshold)
    { id: 'c', bug: '#1', kind: 'gate', detected: true, by: 'gate', reason: 'disabled' },
    { id: 'c', bug: '#1', kind: 'gate', detected: true, by: 'gate', reason: 'disabled' },
    { id: 'c', bug: '#1', kind: 'gate', detected: false, by: 'error', reason: 'llm error' },
    // bug D: 0/3 → missed
    { id: 'd', bug: '#2', kind: 'gate', detected: false, by: '—', reason: 'no issue found' },
    { id: 'd', bug: '#2', kind: 'gate', detected: false, by: '—', reason: 'no issue found' },
    { id: 'd', bug: '#2', kind: 'gate', detected: false, by: '—', reason: 'no issue found' },
  ];
  const agg = aggregate(runs);
  const by = Object.fromEntries(agg.scenarios.map((s) => [s.id, s]));

  assert.equal(by.a.stable, true); assert.equal(by.a.flaky, false); assert.equal(by.a.rate, 1);
  assert.deepEqual(by.a.reasons.sort(), ['label lies', 'stale floor']); // union of distinct reasons
  assert.equal(by.b.stable, false); assert.equal(by.b.flaky, true); assert.equal(by.b.detections, 1);
  assert.equal(by.c.stable, true); assert.equal(by.c.flaky, false); // 2/3 clears ⌈N/2⌉
  assert.equal(by.d.stable, false); assert.equal(by.d.flaky, false); // never seen ≠ flaky

  assert.equal(agg.scenarios.length, 4);
  assert.equal(agg.stableCount, 2);   // a, c
  assert.equal(agg.flakyCount, 1);    // b
  assert.equal(agg.detectionRate, 0.5);
});

test('toScript (F5): a semantic finding → pins-prepended, get-steps carry observed as expect', () => {
  const finding = {
    id: 'floor-desync', bug: '#3', reason: 'FloorLabel shows "Floor: 1" but real floor is 2',
    pins: [{ sel: 'Canvas/Game:DungeonGame.rollDescend', replace: '()=>true' }],
    raw: [
      { step: { op: 'press', ref: 'Canvas/AttackBtn' }, result: { ok: true, fired: 1 } },
      { step: { op: 'sleep', ms: 700 }, result: { ok: true } },
      { step: { op: 'get', sel: 'Canvas/FloorLabel:Label.string' }, result: { ok: true, value: 'Floor: 1' } },
      { step: { op: 'get', sel: 'Canvas/Game:DungeonGame.floor' }, result: { ok: true, value: 2 } },
    ],
  };
  const script = toScript(finding);
  assert.equal(script.name, 'candidate-floor-desync');
  // pins re-materialize as the FIRST steps (deterministic replay), in patch form
  assert.deepEqual(script.steps[0], { op: 'patch', sel: 'Canvas/Game:DungeonGame.rollDescend', hooks: { replace: '()=>true' } });
  // press / sleep pass through untouched
  assert.deepEqual(script.steps[1], { op: 'press', ref: 'Canvas/AttackBtn' });
  assert.deepEqual(script.steps[2], { op: 'sleep', ms: 700 });
  // each get freezes its observed value as an expect (green now, red when the state is fixed)
  assert.deepEqual(script.steps[3], { op: 'get', sel: 'Canvas/FloorLabel:Label.string', expect: { value: 'Floor: 1' } });
  assert.deepEqual(script.steps[4], { op: 'get', sel: 'Canvas/Game:DungeonGame.floor', expect: { value: 2 } });
});

test('toScript (F5): a gate finding (no get observations) is not freezable → null', () => {
  const finding = {
    id: 'flee-dead', bug: '#2', reason: 'Canvas/FleeBtn: dead button (drove nothing)', pins: [],
    raw: [{ step: { op: 'press', ref: 'Canvas/FleeBtn' }, result: { ok: true, drove: 'nothing', wired: false } }],
  };
  assert.equal(toScript(finding), null); // already guarded by the coverage gate — nothing to freeze
});
