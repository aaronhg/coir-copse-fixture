# CI — the coir × copse gate

How the gate is wired, why each non-obvious step exists, and how to run it locally. For the
overview see the [README](../README.md); for the story of getting it green see
[DEVELOPMENT.md](../DEVELOPMENT.md) §6–§7.

## No editor in the loop

The gate runs against a **pre-built** `build/web-mobile/` — that's the whole reason it's
CI-able. Build once (Creator ▸ *Project ▸ Build ▸ web-mobile*) and **commit the output**; CI
serves those static files and drives them with headless Chrome. Rebuild + commit after editing
the game. (The build's native texture assets live under `build/web-mobile/assets/main/native/` —
they must be committed; a stray `native` line in `.gitignore` once ate them, see DEVELOPMENT.md §7.6.)

## The pieces (`ci/`)

```
coir clickmap     coir  → static ClickEvent map from fixture.scene   (→ ci/coir-rows.json)
ci/gate.mjs       copse → live coverage, diffed vs expected.json      (green / red-on-regression)
ci/tests/         copse flow scripts — run as a suite by copse's own `copse run <dir> --junit`
ci/selftest.mjs   proves the gate can actually go red
copse doctor      copse → fast-fail boot check (why the scene won't come up, in ~1 min)
copse affected    copse → which flow tests a diff touches (pure; drives the PR-scoped gate)
ci/serve.mjs      static file server for build/web-mobile
ci/ai-qa.mjs      Layer 2 — LLM plans a test → copse drives it → LLM judges → F5 freeze / F7 ×N (OPT-IN)
ci/ai-qa.test.mjs zero-LLM tests for the F5 serializer + F7 aggregation
```

### Coverage gate (`gate.mjs`)
Runs the coir×copse join and **diffs the finding set against a committed baseline**
(`ci/expected.json`) — the same idea as coir's `coir.rules.json`. Green normally; red on
regression. For this fixture: Attack + gear-menu are `covered`, Flee is a `dead-button` (#2),
Close/Restart are `unreached`. A **new** dead/blocked button — or a previously-covered one going
unreachable — fails it. Regenerate the baseline with `node gate.mjs --update` after an
intentional change.

### Flow suite (`ci/tests/`, run by `copse run <dir> --junit`)
Not a bespoke script — it's **copse's own runner**, which emits the per-test JUnit GitHub renders
as checks. One green-path script plus one **tripwire** per buried bug:
- **green-combat** — drives a clean win, asserts HP / kills / enemy-HP (guards the core loop).
- **tripwires** (#1 disabled ✕, #3 stale floor label, #4 kept tally) — each asserts the bug is
  *present*, so the suite is green today and flips **red** the moment someone fixes the bug. The
  fixture can't silently rot into correctness.

### Selftest (`selftest.mjs`)
Seeds two regressions into a copy of the baseline and asserts the gate goes **red**, plus a
control that the pristine baseline stays **green**. A gate nobody has watched fail is a no-op you
trust by accident.

## Layer 2 — AI QA (`ci/ai-qa.mjs`, opt-in)

Everything above is **zero-LLM**: it catches DEAD / BLOCKED buttons and coverage regressions. It
cannot catch a *semantic* bug — a label that lies (#3), a tally that should have reset (#4). Those
need a player who reasons about state. `ai-qa.mjs` is that player, and it's the demo's own test bed
(it already knows the four planted bugs):

- **explore (F4)** — an LLM *plans* a test from a risk goal; copse's `runHarness` drives it in real
  Chrome (ref-based, with hard gates for reachable / drive / error) and records the executed steps.
- **judge (F6)** — an LLM classifies the run `bug | inconclusive | ok`. "inconclusive" = *the plan*
  never set up its precondition (not: the control is broken — that's a bug). copse's hard gates veto
  a naive "looks fine" (a dead button can't pass on opinion).
- **freeze (F5)** — a stable, *conclusive* semantic finding is serialized (RNG pins + steps +
  observed as `expect`) into `ci/candidates/*.json` and **replayed with `copse run` to confirm it's
  green** — a discovery becomes a permanent zero-LLM tripwire. Anything that doesn't replay green is
  discarded, so no false tripwire lands. Review a candidate, then `git mv` it into `ci/tests/`.
- **N-run (F7)** — the plan is stochastic, so each scenario runs N times: a finding in a *majority*
  is stable (gate-worthy); a single hit is flaky (reported, not gated). `detection rate = stable / total`.

The LLM seam is one function: **Anthropic API** (`ANTHROPIC_API_KEY` set, with an assistant-`{`
prefill so the reply is always JSON) or the local **`claude -p`** in dev; **no key → Layer 2 is
skipped** and only the zero-LLM gate runs. `ai-qa.test.mjs` locks the F5/F7 logic at zero token cost.

Run it locally: `node ci/ai-qa.mjs <url> --runs 3 --freeze` (add `--headed` to watch). In CI it's a
**separate, opt-in** workflow (below) — never every PR.

## The GitHub Actions runner recipe (`.github/workflows/ci.yml`)

`ubuntu-latest` already ships the Chrome copse needs, so there's no browser setup — but there are
two non-obvious steps, both learned the hard way (DEVELOPMENT.md §7):

1. **A software Vulkan device.** copse launches Chrome with `--use-gl=angle --use-angle=swiftshader`
   — ANGLE over SwiftShader's *Vulkan* device. The runner has the Vulkan **loader** (`libvulkan1`
   is a google-chrome dependency) but **no usable software Vulkan device**, so ANGLE dies with
   `Internal Vulkan error (-3)`, WebGL is null, and the Cocos scene never builds. Fix:
   `apt-get install mesa-vulkan-drivers` (a software llvmpipe device). A tiny WebGL probe in that
   step prints the resulting renderer as ground truth.
2. **A boot diagnostic gate** (`copse doctor`). Connects through copse's own Chrome and prints
   the WebGL renderer, the live scene's child count, and the game's own console/pageerrors — then
   **exits non-zero on an empty scene** so CI fails fast (~1 min) with the reason instead of
   spinning copse's boot-wait across the whole suite (~15 min).

Everything after that — serve, `coir clickmap`, `copse run`, `gate.mjs`, `selftest.mjs` — runs in
**one step** so the static server (a child of that shell) outlives every command that drives it; a
`trap` kills it only at the end, and an `rc` accumulator keeps JUnit publishing on failure.

coir + copse are cloned from GitHub at run time. If yours are private, swap the clone for a PAT:
```yaml
git clone https://x-access-token:${{ secrets.TOOLS_PAT }}@github.com/<you>/coir.git /tmp/coir
```

## The opt-in AI QA workflow (`.github/workflows/ai-qa.yml`)

Layer 2 costs tokens, so it is **not** part of the every-push `ci.yml` — it's a separate workflow
you trigger from **Actions ▸ AI QA (Layer 2) ▸ Run workflow** (inputs: `runs`, `scenario`), with an
optional nightly `schedule` commented in. It reuses the same runner recipe (Vulkan device + `copse
doctor`), runs `ai-qa.mjs --freeze --report`, and:

- renders the **detection table + token cost** on the run's summary page;
- uploads an **`ai-qa-evidence`** artifact — the full log, `report.json` (every run's plan / trace /
  verdict + usage + F5 outcomes), and any surviving candidate tripwires;
- **`--fail-on missed`**: a flaky bug is reported, not red; a *fully-blind* bug (0/N) fails.

No `ANTHROPIC_API_KEY` secret → the job writes a "skipped" summary and stops; fork PRs (which can't
see secrets) degrade the same way. The zero-LLM gate stays the always-on floor.

## GitHub Pages — the live demo

A second job (`deploy-demo`) runs **only on `main`, only after the gate is green**, and uploads
that same committed `build/web-mobile/` via `upload-pages-artifact` + `deploy-pages`. So the
hosted demo at <https://aaronhg.github.io/coir-copse-demo/> is, by construction, always a build
that passed the join. One-time setup: repo *Settings ▸ Pages ▸ Source = "GitHub Actions"*. (Cocos
3.8 web-mobile uses relative paths, so it runs fine from the `/<repo>/` Pages subpath.)

## Run it locally

The harness spawns the coir/copse CLIs (no deps to install). In `ci/`:
```bash
npm run serve &                          # serve build/web-mobile on :8899
COIR_CLI=… COPSE_CLI=… npm run check     # rows → suite → gate → selftest
```
It runs **`--headed`** on purpose: headless Chrome renders Cocos through SwiftShader and cooks the
machine, so locally you want a real window; CI is headless because its container is ephemeral (and
it installs the software Vulkan device above). Point `COIR_CLI` / `COPSE_CLI` at your local
checkouts of the two tools.
