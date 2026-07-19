# CLAUDE.md

Guidance for Claude Code (claude.ai/code) working in this repo.

## What this is

The **Tiny-Dungeon fixture** — a small Cocos Creator 3.8.x game **and** the worked example that wires the
three tools ([coir](../coir) · [copse](../copse) · [arbor](../arbor)) into a CI gate over a *pre-built*
web-mobile bundle (no Cocos editor in the loop). It's a **consumer**, not a tool: it deliberately plants a
handful of bugs (a dead button, a label that lies, a tally that doesn't reset, a disabled control) so the
gate has something to catch, and hosts the result at <https://aaronhg.github.io/coir-copse-demo/>.

## Responsibilities & boundaries

This repo is the **consumer** in the family (`coir` · `copse` · `arbor`), split by one rule:
**needs project files → coir · needs a running game → copse · has judgment/policy → arbor.**

This repo OWNS only *its own* material — never tool logic:
- **the game** (`assets/`, the built `build/web-mobile/`, `scene/fixture.scene`) + the planted bugs.
- **`arbor.config.mjs`** — how THIS project drives arbor (url, `webServer`, `surface`, spec, scenarios,
  baselines, and where the tools are: `driver.copse` / `analyzer.coir`).
- **`ci/`** — the fixtures the gate reads: `qa/` (scenarios, `ground-truth.json`, the spec), `tests/`
  (frozen flow scripts for `copse run`), `expected.json` (coverage baseline), the visual baseline,
  `serve.mjs`, and the npm scripts.
- **`.github/workflows/{ci,ai-qa}.yml`** — the CI that fetches the tools and runs the gate.

This repo does NOT implement analysis, driving, or QA logic. If a change is about *how coverage is joined*,
*how the game is driven*, or *how a run is judged*, it belongs in **arbor / copse / coir**, not here.

## How the three tools are referenced

They are **sibling repos** (`../coir`, `../copse`, `../arbor`), resolved two ways — **relative + env**:

- **Local**: `arbor.config.mjs` imports `defineConfig` from `../arbor/src/index.mjs`; `driver.copse:'../copse'`
  and `analyzer.coir:'../coir'` are resolved by arbor (from the config's dir); `ci/package.json` runs
  `${ARBOR_BIN:-../../arbor/bin/arbor.mjs}`. No `node_modules` — the root `package.json` is a Cocos manifest,
  not an npm package. (A real external consumer could instead `npm i arbor copse coir` and use `from 'arbor'`.)
- **CI**: the workflows `git clone` all three from `github.com/aaronhg/{coir,copse,arbor}` into `/tmp`, then
  point at them with `ARBOR_BIN` / `COPSE_CLI` / `COPSE_DRIVER` / `COPSE_HARNESS` / `COIR_CLI` (arbor's driver
  reads these env overrides first).

## Commands

```bash
cd ci
npm run gate         # zero-LLM: coir clickmap × copse clickSurface, joined in arbor, vs expected.json
npm run visual       # golden pixel signatures vs baseline
npm run suite        # the frozen flow suite — copse's own runner (`copse run tests/`)
npm run selftest     # prove the coverage gate can go red
npm run check        # suite + gate + visual + selftest
# from the repo root, directly:
node ../arbor/bin/arbor.mjs coverage --headed
node ../arbor/bin/arbor.mjs calibrate --runs 3 --freeze     # the AI QA layer (needs an API key)
```

Local runs use `--headed` (headless SwiftShader WebGL cooks the machine; CI is headless and ephemeral).
