// arbor.config.mjs — how THIS project (the Tiny-Dungeon fixture) drives arbor. Like a playwright.config.
import { defineConfig } from '../arbor/src/index.mjs'; // arbor is a sibling repo now (or `from 'arbor'` if you npm-install it)
import { scenarios } from './ci/qa/scenarios.mjs';

const G = 'Canvas/Game:DungeonGame';

export default defineConfig({
  url: 'http://127.0.0.1:8899/',
  webServer: { command: 'node ci/serve.mjs 8899', reuseExisting: true }, // arbor starts/stops it (or reuses a running one)
  driver: { copse: '../copse' },
  analyzer: { coir: '../coir' },

  // how to DRIVE this game (the agent's surface) — refs/sels + mechanics, no bug hints
  surface: `You are QA-testing a Cocos turn-based dungeon game through a JSON step API. You cannot see pixels — you reason over game state and label text.

Buttons (op:press, ref):
  Canvas/AttackBtn            — trade blows with the monster
  Canvas/FleeBtn             — flee the fight
  Canvas/MenuBtn             — open / close the settings menu (gear)
  Canvas/MenuPanel/CloseBtn  — the X inside the panel (only reachable while the menu is open)
  Canvas/RestartBtn          — restart after the hero is defeated (only appears ~0.5s after death)

Read values (op:get, sel):
  real state:  ${G}.hp | ${G}.enemyHp | ${G}.kills | ${G}.floor
  label text:  Canvas/FloorLabel:Label.string | Canvas/HpLabel:Label.string | Canvas/EnemyHpLabel:Label.string
               (labels are what the PLAYER sees; .floor/.kills/... are the REAL state)

Mechanics: attacks are ANIMATED / turn-based — after EVERY press add {"op":"sleep","ms":700} before the next press or read. Attack: hero hits the monster (enemyHp −1); enemyHp starts at 2+floor; at 0 the monster dies, kills +1, a fresh monster appears, and you MAY descend a floor. The monster may counter (hero hp −1); hero hp starts at 3; at 0 the hero DIES and RestartBtn appears (~0.5s later).`,

  // the design spec = the oracle for `verify` / `orchestrate`
  spec: './ci/qa/tiny-dungeon.spec.md',
  specMin: './ci/qa/tiny-dungeon.spec.min.md',
  groundTruth: './ci/qa/ground-truth.json',   // answer key → the outcome judge scores findings vs the 4 planted bugs
  evalStore: './ci/qa/evals.jsonl',            // append each scored run → detection/evidence trend over time
  // thresholds: { detection: 3, evidence: 3 }, // uncomment to FAIL a run below these (or pass --min-detection / --min-evidence)

  // the game's pinnable RNG hooks — lets `orchestrate`'s coordinator make a claim's state reachable
  pinnable: `${G}.rollCounter — true when the monster counters (hero takes 1 dmg). ()=>true = hero always takes damage (dies in ~4 attacks), ()=>false = safe.
${G}.rollDescend — true when a kill descends a floor. ()=>true = every kill descends.
${G}.rollMiss — true when the hero's attack misses. ()=>false = attacks always land.
A pin is {"sel":"${G}.rollCounter","replace":"()=>true"}. Hero starts hp 3; enemyHp starts 2+floor.`,

  scenarios,
  model: 'claude-haiku-4-5-20251001',
  reporters: ['console', 'json'],

  // ── deterministic (zero-LLM) gate ──
  scene: 'scene/fixture.scene',
  tests: './ci/tests',
  coverage: { baseline: './ci/expected.json', rows: './ci/coir-rows.json' },
  visual: {
    baseline: './ci/visual-baseline.json',
    refs: ['Canvas/AttackBtn', 'Canvas/MenuBtn', 'Canvas/HpLabel', 'Canvas/FloorLabel', 'Canvas/EnemyHpLabel'],
  },
});
