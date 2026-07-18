#!/usr/bin/env node
// Layer 2 — AI QA harness (F4 explore + F6 judge + F5 auto-freeze + F7 uncertainty control).
//
// The zero-LLM half of this repo (coir clickmap × copse coverage, copse run) catches DEAD /
// BLOCKED buttons. It cannot catch a *semantic* bug — a label that lies, a tally that should have
// reset. Those need a player: drive the game, then read state and JUDGE it. This is that player.
//
//   explore (F4)  — an LLM PLANS a test from a risk goal; copse's runHarness drives it (real Chrome,
//                   ref-based, hard gates for reachable/drive/error) and records the executed steps.
//   judge   (F6)  — an LLM reads the observed state vs the intended oracle → pass/fail. copse's hard
//                   gates VETO a naive "looks fine" (a dead/disabled button can't pass on opinion).
//   freeze  (F5)  — a stable *semantic* finding is serialized (pins + steps + observed as `expect`)
//                   into ci/tests/candidate-*.json and REPLAYED with `copse run` to confirm it's
//                   green — turning a one-time exploration into a permanent zero-LLM tripwire.
//   N-run   (F7)  — the LLM plan is stochastic, so each scenario runs N times: a finding seen in a
//                   MAJORITY of runs is stable (gate-worthy); a single hit is flaky (reported, not
//                   gated). detection rate = stable scenarios / total.
//
// Validated against coir-copse-demo, which already knows the answer: 4 planted bugs (see
// assets/scripts/DungeonGame.ts). #1/#2 are gate-caught (reachable/drive); #3/#4 are the semantic
// ones only this harness (and F5's frozen tripwires) can see.
//
// Usage:  node ai-qa.mjs <url> [--runs N] [--scenario id] [--freeze] [--headed] [--copse <cli>]
// Env:    COPSE_DRIVER (driver path, default ../../copse/src/drivers/puppeteer.js), COPSE_CLI (for --freeze)
// Exit:   0 = every real bug detected stably · 1 = a bug went undetected / only flaky.

import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';

const HERE = new URL('.', import.meta.url).pathname;
const ROOT = join(HERE, '..');
const DRIVER = process.env.COPSE_DRIVER || join(ROOT, '../copse/src/drivers/puppeteer.js');
const HARNESS = process.env.COPSE_HARNESS || join(ROOT, '../copse/src/harness.js');

// ── the game's surface, once (the agent gets the whole thing and picks what the goal needs) ──────
const G = 'Canvas/Game:DungeonGame';
const BRIEF = `You are QA-testing a Cocos turn-based dungeon game through a JSON step API. You cannot see pixels — you reason over game state and label text.

Buttons (op:press, ref):
  Canvas/AttackBtn            — trade blows with the monster
  Canvas/FleeBtn             — (newly added) flee the fight
  Canvas/MenuBtn             — open / close the settings menu (gear)
  Canvas/MenuPanel/CloseBtn  — the X inside the panel (only reachable while the menu is open)
  Canvas/RestartBtn          — restart after the hero is defeated (only appears ~0.5s after death)

Read values (op:get, sel):
  real state:  ${G}.hp | ${G}.enemyHp | ${G}.kills | ${G}.floor
  label text:  Canvas/FloorLabel:Label.string | Canvas/HpLabel:Label.string | Canvas/EnemyHpLabel:Label.string
               (labels are what the PLAYER sees; the .floor/.kills/... above are the REAL state)

Mechanics (RNG is pinned deterministic for this run):
  - Attacks are ANIMATED / turn-based: after EVERY press add {"op":"sleep","ms":700} before the next
    press or read, or the action is silently dropped.
  - Attack: hero hits the monster (enemyHp −1). enemyHp starts at 2+floor. At 0 the monster dies,
    kills +1, a fresh (tougher) monster appears, and you MAY descend a floor.
  - The monster may counter (hero hp −1). Hero hp starts at 3. At 0 the hero DIES: the run freezes and
    RestartBtn appears (~0.5s later); pressing Restart begins a fresh run.`;

// pins are applied by the HARNESS before the agent runs (so the agent's steps stay pin-free);
// F5 re-prepends them as patch steps so a frozen candidate replays deterministically.
const P = (m, body) => ({ sel: `${G}.${m}`, replace: body });
export const SCENARIOS = [
  { id: 'flee-dead', bug: '#2', kind: 'gate', pins: [],
    goal: 'A "Flee" action was added to the combat UI. Verify the Flee button actually does something when pressed (drives some game state / opens something).' },
  { id: 'menu-close-disabled', bug: '#1', kind: 'gate', pins: [],
    goal: 'The settings-menu open/close flow was changed. Open the menu (MenuBtn), then close it with the X (MenuPanel/CloseBtn). Verify the close actually works.' },
  { id: 'floor-desync', bug: '#3', kind: 'semantic',
    pins: [P('rollCounter', '()=>false'), P('rollMiss', '()=>false'), P('rollDescend', '()=>true')],
    goal: 'The floor-descend / floor-label code was changed. Verify FloorLabel always shows the REAL current floor — including right after slaying a monster and descending. Read BOTH the FloorLabel text AND the real .floor so a disagreement is visible.' },
  { id: 'tally-kept', bug: '#4', kind: 'semantic',
    pins: [P('rollCounter', '()=>true'), P('rollMiss', '()=>false'), P('rollDescend', '()=>false')],
    goal: 'The run-reset / Restart logic was changed. The hero must actually DIE first: read .hp after each Attack and KEEP attacking (it takes ~4 hits — the monster counters every surviving turn) until .hp reads 0. Do NOT press Restart until .hp is 0. THEN press RestartBtn to begin a fresh run, sleep, and read .kills. On a fresh run the "Defeated" tally (.kills) MUST be 0.' },
];

// ── LLM (a plan or a judgment): the Anthropic API if a key is present, else the local `claude -p`.
// Same harness, one seam — dev uses the logged-in CLI, CI sets ANTHROPIC_API_KEY. Both return a
// parsed JSON object. The API path pins the reply to JSON with a system line + an assistant PREFILL
// of "{" (the model continues from INSIDE the object, so there's no prose to strip); the CLI path
// leans on extractJson, a balanced-brace scan that tolerates ``` fences / surrounding prose (the
// greedy /\{[\s\S]*\}/ it replaces was what made the menu scenario flaky — it over-grabbed).
function extractJson(text, prefill = '') {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/); // a fenced block wins if present
  const src = prefill + (fence ? fence[1] : text);
  const start = src.indexOf('{');
  if (start < 0) throw new Error('no JSON object in reply');
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; }
    else if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return JSON.parse(src.slice(start, i + 1)); // the FIRST balanced object
  }
  throw new Error('unbalanced JSON object in reply');
}

// ONE model knob for both paths. Default Haiku (cheap/fast — good for trialling the flow); override
// with ANTHROPIC_MODEL (e.g. claude-sonnet-5 for sharper semantic judging). The API needs the full
// id; the `claude -p` CLI accepts the same id via --model.
export const MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';
export const USAGE = { input: 0, output: 0 }; // accumulated across API calls (visible → cost in CI); CLI path has none
async function llmApi(prompt, maxTokens) {
  const body = {
    model: MODEL,
    max_tokens: maxTokens,
    system: 'You are a precise test author and judge. Reply with ONE JSON object and nothing else.',
    messages: [{ role: 'user', content: prompt }, { role: 'assistant', content: '{' }], // prefill → forces JSON
  };
  for (let attempt = 0; ; attempt++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if ((res.status === 429 || res.status >= 500) && attempt < 4) { await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt)); continue; }
    if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    USAGE.input += data.usage?.input_tokens || 0; USAGE.output += data.usage?.output_tokens || 0;
    return extractJson(data.content[0].text, '{'); // re-attach the prefilled brace
  }
}

const llmCli = (prompt) => extractJson(JSON.parse(execFileSync('claude', ['-p', prompt, '--model', MODEL, '--output-format', 'json'], { encoding: 'utf8', maxBuffer: 64 << 20 }).toString()).result);

let CLI_OK; // memoized `claude` availability
export function hasLLM() {
  if (process.env.ANTHROPIC_API_KEY) return true;
  if (CLI_OK === undefined) { try { execFileSync('claude', ['--version'], { stdio: 'ignore' }); CLI_OK = true; } catch { CLI_OK = false; } }
  return CLI_OK;
}
const llm = async (prompt, maxTokens = 1500) => process.env.ANTHROPIC_API_KEY ? llmApi(prompt, maxTokens) : llmCli(prompt);

const compactSteps = (raw) => raw.map((s) => ({ op: s.step.op, target: s.step.ref || s.step.sel, result: s.result?.value ?? (s.result?.ok === false ? s.result : 'ok') }));

function agentFor(scenario) {
  return {
    plan: async ({ context, snapshot }) => {
      const refs = (snapshot || []).filter((n) => n.button).map((n) => n.ref);
      return llm(`${BRIEF}\n\nButtons visible right now: ${refs.join(', ') || '(none — press to reveal)'}\n\nGoal: ${context.goal}\n\nWrite a short test. Output ONLY JSON:\n{"rationale":"...","steps":[ ...press/get/sleep steps... ],"expect":"a plain-English statement of the correct outcome (the oracle)"}\nUse op:press, op:get, and a {"op":"sleep","ms":700} after EVERY press.`, 1800);
    },
    // The judge CLASSIFIES the run, not just pass/fail: an "inconclusive" run (the plan never set up
    // its precondition — e.g. the hero never actually died) is NOT a bug and must NOT be counted as a
    // detection (or frozen). `pass` (for runHarness's fallback verdict) is true only when clean.
    judge: async ({ plan, steps }) => {
      const j = await llm(`${BRIEF}\n\nIntent: ${plan.rationale}\nOracle (expected): ${plan.expect}\n\nObserved step results:\n${JSON.stringify(compactSteps(steps), null, 1)}\n\nClassify this run:\n- "bug": a real defect is proven — a SHOWN label disagrees with the REAL state; a value that should have reset didn't; OR a control the player is meant to use is broken (a press returned ok:false / 'disabled', or a button did nothing / was unreachable when it should have worked).\n- "inconclusive": ONLY when YOUR OWN plan never set up the scenario (e.g. you never drove the hero to hp 0, so a reset was never triggered). A control that is disabled or dead is NOT inconclusive — that IS the bug.\n- "ok": the behaviour is correct.\nOutput ONLY JSON: {"verdict":"bug"|"inconclusive"|"ok","reason":"..."}`, 800);
      return { verdict: j.verdict, reason: j.reason, pass: j.verdict === 'ok' };
    },
  };
}

// ── one exploration → a normalized finding ───────────────────────────────────────────────────────
export async function runAgent(cp, scenario, runHarness) {
  let out;
  try {
    out = await runHarness(cp, agentFor(scenario), { context: { goal: scenario.goal } });
  } catch (e) {
    return { id: scenario.id, bug: scenario.bug, kind: scenario.kind, pins: scenario.pins, detected: false, by: 'error', reason: `harness/LLM error: ${e.message}`, raw: [] };
  }
  const raw = out.rounds.flatMap((r) => r.steps);
  // A CRASH (a handler threw / logged) is always a real defect. A STRUCTURAL gate (dead / blocked
  // control) is THE signal for a gate-kind scenario (#1/#2) — but in a semantic one it's usually the
  // agent mis-driving (e.g. pressing Attack into a legit game-over overlay), so it's surfaced, not
  // counted. The SEMANTIC oracle (judge → "bug") is what a #3/#4 detection rests on.
  const errReasons = (out.errored || []).map((e) => `${e.ref}: ${e.error}`);
  const structReasons = [
    ...(out.undriven || []).map((u) => `${u.ref}: dead button (drove nothing)`),
    ...(out.unreachable || []).map((u) => `${u.ref}: unreachable (blocked by ${u.blockedBy})`),
  ];
  const bugReasons = out.rounds.filter((r) => r.verdict && r.verdict.verdict === 'bug').map((r) => r.verdict.reason);
  const inconclusive = out.rounds.some((r) => r.verdict && r.verdict.verdict === 'inconclusive');
  const structCounts = scenario.kind === 'gate' && structReasons.length > 0; // dead/blocked = the point of a gate scenario
  const detected = bugReasons.length > 0 || errReasons.length > 0 || structCounts;
  const by = bugReasons.length ? 'judge' : (errReasons.length || structCounts) ? 'gate' : inconclusive ? 'inconclusive' : '—';
  const reason = [...bugReasons, ...errReasons, ...(structCounts ? structReasons : [])].join('; ')
    || (inconclusive ? 'inconclusive: ' + out.rounds.map((r) => r.verdict && r.verdict.reason).filter(Boolean).join('; ') : 'no issue found');
  const rationale = out.rounds.map((r) => r.rationale).filter(Boolean).join(' | ');
  return { id: scenario.id, bug: scenario.bug, kind: scenario.kind, pins: scenario.pins, detected, by, reason, rationale, raw };
}

// ── F5 — serialize a finding into a deterministic `copse run` tripwire (or null if not freezable) ─
export function toScript(finding) {
  // Only a SEMANTIC finding freezes cleanly: its `get` observations become `expect`s, so replay is
  // green now (bug present) and flips RED when the bug is fixed. A gate finding (dead/disabled
  // button) has no state to assert green — it's already guarded by the coverage gate → skip.
  const gets = (finding.raw || []).filter((s) => s.step.op === 'get' && s.result && 'value' in s.result);
  if (!gets.length) return null;
  const pins = (finding.pins || []).map((p) => ({ op: 'patch', sel: p.sel, hooks: { replace: p.replace } }));
  const body = (finding.raw || []).map((s) => {
    const step = { ...s.step };
    if (step.op === 'get' && s.result && 'value' in s.result) step.expect = { value: s.result.value };
    return step;
  });
  return {
    name: `candidate-${finding.id}`,
    note: `AUTO-FROZEN from an AI-QA finding (bug ${finding.bug}): ${finding.reason}. Green = bug still present; flips RED when fixed.`,
    steps: [...pins, ...body],
  };
}

// ── F7 — aggregate N runs per scenario into stable / flaky ────────────────────────────────────────
export function aggregate(runs) {
  const byId = new Map();
  for (const r of runs) { if (!byId.has(r.id)) byId.set(r.id, []); byId.get(r.id).push(r); }
  const scenarios = [...byId.values()].map((rs) => {
    const N = rs.length, detections = rs.filter((r) => r.detected).length, need = Math.ceil(N / 2);
    return {
      id: rs[0].id, bug: rs[0].bug, kind: rs[0].kind, runs: N, detections, rate: detections / N,
      stable: detections >= need, flaky: detections > 0 && detections < need,
      reasons: [...new Set(rs.filter((r) => r.detected).map((r) => r.reason))],
      by: [...new Set(rs.filter((r) => r.detected).map((r) => r.by))],
    };
  });
  const stableCount = scenarios.filter((s) => s.stable).length;
  return { scenarios, stableCount, flakyCount: scenarios.filter((s) => s.flaky).length, detectionRate: scenarios.length ? stableCount / scenarios.length : 0 };
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const url = argv.find((a) => !a.startsWith('--'));
  const flag = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true) : d; };
  const RUNS = Number(flag('--runs', 3));
  const only = flag('--scenario', null);
  const onlyIds = only ? String(only).split(',').map((x) => x.trim()) : null; // --scenario a,b runs a subset
  const FREEZE = argv.includes('--freeze');
  const REPORT = flag('--report', null); // write a complete machine-readable audit bundle (findings + traces + usage)
  const FAIL_ON = flag('--fail-on', 'flaky'); // exit policy — flaky: any <100% fails · missed: only a fully-blind bug (0/N) fails · never
  const headed = argv.includes('--headed');
  const COPSE = flag('--copse', process.env.COPSE_CLI || join(ROOT, '../copse/src/cli.js'));
  if (!url) { console.error('usage: ai-qa.mjs <url> [--runs N] [--scenario id[,id…]] [--freeze] [--headed]'); process.exit(2); }
  if (!hasLLM()) { console.error('ai-qa: no LLM available — set ANTHROPIC_API_KEY or log in the `claude` CLI. Layer 2 is skipped; the zero-LLM gate (doctor/coverage/affected) still runs.'); process.exit(3); }
  const scenarios = SCENARIOS.filter((s) => !onlyIds || onlyIds.includes(s.id));

  const { connect } = await import(DRIVER);
  const { runHarness } = await import(HARNESS);
  const cp = await connect(url, { headless: headed ? false : 'new' });

  const results = [], exemplar = new Map();
  try {
    for (let n = 0; n < RUNS; n++) {
      for (const sc of scenarios) {
        await cp.reload();                                   // fresh scene per run
        for (const p of sc.pins) await cp.patch(p.sel, { replace: p.replace }); // re-pin RNG after reload
        const f = await runAgent(cp, sc, runHarness);
        results.push(f);
        if (f.by === 'judge' && !exemplar.has(f.id)) exemplar.set(f.id, f); // freeze ONLY from a conclusive semantic bug
        console.log(`  run ${n + 1}/${RUNS}  ${sc.id.padEnd(20)} ${f.detected ? '🔴 found' : '⚪ missed'}  (${f.by})  ${f.reason}`.slice(0, 160));
      }
    }
  } finally { await cp.close(); }

  const agg = aggregate(results);
  console.log(`\n── detection over ${RUNS} run(s) ─────────────────────────────`);
  for (const s of agg.scenarios) {
    const tag = s.stable ? '✅ stable' : s.flaky ? '🟡 flaky ' : '❌ missed';
    console.log(`  ${tag}  bug ${s.bug}  ${s.id.padEnd(20)} ${s.detections}/${s.runs}  (${s.by.join('/') || '—'})`);
    if (s.reasons.length) console.log(`            ↳ ${s.reasons[0]}`.slice(0, 150));
  }
  console.log(`  detection rate: ${agg.stableCount}/${agg.scenarios.length} bugs stably found` + (agg.flakyCount ? `, ${agg.flakyCount} flaky` : ''));

  const candidates = []; // F5 outcomes, for the report / artifact
  if (FREEZE) {
    console.log(`\n── auto-freeze (F5) — stable, CONCLUSIVE semantic findings → candidate tripwires ─────`);
    const OUT = join(HERE, 'candidates'); // STAGE here (not the live suite) — a human reviews, then git mv's in
    mkdirSync(OUT, { recursive: true });
    for (const s of agg.scenarios.filter((x) => x.stable)) {
      const ex = exemplar.get(s.id);            // set only for a conclusive judge-bug run
      const script = ex && toScript(ex);
      if (!script) { console.log(`  · ${s.id}: gate finding (no conclusive semantic repro) — already guarded by the coverage gate, nothing to freeze`); candidates.push({ id: s.id, bug: s.bug, outcome: 'none', why: 'gate finding — no semantic state to freeze (coverage gate guards it)' }); continue; }
      const path = join(OUT, `${script.name}.json`);
      writeFileSync(path, JSON.stringify(script, null, 2) + '\n');
      let ok = false;
      try { execFileSync('node', [COPSE, 'run', url, path, ...(headed ? ['--headed'] : [])], { encoding: 'utf8' }); ok = true; }
      catch { rmSync(path, { force: true }); } // doesn't replay green → not a repro → discard, never keep a red candidate
      console.log(`  ▶ ${script.name}.json  → replay ${ok ? 'green ✓  (staged in ci/candidates/)' : 'RED ✗ — discarded (not a stable repro)'}`);
      if (ok) console.log(`      review, then:  git mv ci/candidates/${script.name}.json ci/tests/`);
      candidates.push({ id: s.id, bug: s.bug, file: `${script.name}.json`, outcome: ok ? 'staged' : 'discarded', steps: script.steps.length });
    }
  }

  const cost = (USAGE.input || USAGE.output) ? `${USAGE.input.toLocaleString()} in / ${USAGE.output.toLocaleString()} out tokens (${MODEL})` : `n/a (claude CLI path, ${MODEL})`;
  console.log(`\n  llm cost: ${cost}`);

  if (REPORT) { // a self-contained audit bundle: aggregate + EVERY run's full trace + usage + F5 outcomes
    mkdirSync(dirname(REPORT), { recursive: true });
    const report = {
      url, runs: RUNS, scenarios_run: scenarios.map((s) => s.id),
      llm: process.env.ANTHROPIC_API_KEY ? 'anthropic-api' : 'claude-cli',
      model: MODEL,
      usage: { input: USAGE.input, output: USAGE.output },
      detectionRate: agg.detectionRate, stableCount: agg.stableCount, flakyCount: agg.flakyCount,
      bugs: agg.scenarios, candidates,
      findings: results.map((f) => ({ id: f.id, bug: f.bug, kind: f.kind, detected: f.detected, by: f.by, reason: f.reason, rationale: f.rationale, trace: compactSteps(f.raw) })),
    };
    writeFileSync(REPORT, JSON.stringify(report, null, 2) + '\n');
    console.log(`  report: ${REPORT}`);
  }

  const missed = agg.scenarios.filter((s) => s.detections === 0).length; // a bug NO run found = the harness is blind to it
  const failed = FAIL_ON === 'never' ? false : FAIL_ON === 'missed' ? missed > 0 : agg.detectionRate !== 1;
  process.exit(failed ? 1 : 0);
}
