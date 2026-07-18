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
ci/boot-diag.mjs  fast-fail boot check (why the scene won't come up, in ~1 min)
ci/serve.mjs      static file server for build/web-mobile
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

## The GitHub Actions runner recipe (`.github/workflows/ci.yml`)

`ubuntu-latest` already ships the Chrome copse needs, so there's no browser setup — but there are
two non-obvious steps, both learned the hard way (DEVELOPMENT.md §7):

1. **A software Vulkan device.** copse launches Chrome with `--use-gl=angle --use-angle=swiftshader`
   — ANGLE over SwiftShader's *Vulkan* device. The runner has the Vulkan **loader** (`libvulkan1`
   is a google-chrome dependency) but **no usable software Vulkan device**, so ANGLE dies with
   `Internal Vulkan error (-3)`, WebGL is null, and the Cocos scene never builds. Fix:
   `apt-get install mesa-vulkan-drivers` (a software llvmpipe device). A tiny WebGL probe in that
   step prints the resulting renderer as ground truth.
2. **A boot diagnostic gate** (`boot-diag.mjs`). Connects through copse's own Chrome and prints
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
