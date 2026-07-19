# Development History — coir × copse UI-Coverage Fixture

This document records how the **coir × copse** fixture was built: a tiny real Cocos
Creator 3.8 game that doubles as a test bed for the coir×copse UI-coverage join, the four
UI bugs deliberately buried in it, and — the longest part of the story — everything it took
to make the whole thing pass **on GitHub Actions** and publish a live demo.

Live demo: <https://aaronhg.github.io/coir-copse-demo/>

---

## 0. The Goal in One Sentence

Build a **self-contained, CC0-clean, CI-able** demonstration of the coir×copse "join" —
where **coir** statically reads a Cocos scene's ClickEvent wiring and **copse** drives the
live game, and the two meet on the key `(nodePath, method)` — running headless on a hosted
runner with no Cocos editor in the loop, and hosting the exact build that passed as a live
demo.

---

## 1. The Idea — the coir × copse Join

Two sibling tools, one static and one live, that individually can't answer the question that
matters, but together can:

- **coir** parses the project on disk. It knows a button is *wired* — its `clickEvents`
  entry links a node to a handler method — but it never runs the game, so it can't know
  whether a player can actually reach that button in the shipped build.
- **copse** drives the running canvas over CDP. It knows what's *reachable and pressable
  right now*, but not what the editor *should* have wired.

The join key is `(nodePath, method)`. It's chosen deliberately: the **method name survives
minification** (it's a serialized string in the scene), whereas the handler's component
class is mangled to `t`/`e` on a release build — so coir, which still has the real names, is
the half that supplies identity, and copse supplies reachability. The verdict falls out of
the intersection:

| coir (wired) | copse (live) | verdict |
|---|---|---|
| yes | reachable | **covered** |
| yes | present but `reachable:false` | **blocked / dead wiring** |
| yes | absent from this scene state | **unreached** (navigate to it) |
| — | pressable, no serialized handler | **dead button** (`method:null`) |

coir emits its half with `coir clickmap <scene> -o json` → `[{nodePath, method, component}]`;
copse supplies the live half (`clickSurface`), and **arbor** joins the two (`arbor coverage`).

---

## 2. The Fixture Game

### 2.1 Why a real game, with buried bugs
A coverage gate is only trustworthy if you've watched it catch something. So the fixture
isn't a stub — it's a playable turn-based dungeon crawler (`assets/scripts/DungeonGame.ts`,
one component) with **four real UI defects** planted in the shell around an otherwise-correct
core loop. The player's HP and the enemy's HP are always right; the bugs live where a
coverage gate is actually meant to help — a disabled button, an unwired button, a stale
label, a missed reset.

### 2.2 Mechanics
Tap **Attack** to trade blows; kill a monster and a *different, tougher* one fades in
(several monster + hero sprites cycle); miss chance, red-flash on hit, a random floor
descend, a gear→✕ settings strip. The RNG entry points (`rollCounter` / `rollDescend` /
`rollMiss`) are **separate methods on purpose**, so a driver can pin them for deterministic
flow tests.

### 2.3 The four buried UI bugs
| # | Bug | How the gate catches it |
|---|---|---|
| 1 | menu **✕ close is disabled** (`interactable:false`) | coverage → `blocked` when the menu is open |
| 2 | **Flee button has no handler wired** | coverage → `dead-button` (`codeOnly`) |
| 3 | **floor label never refreshes** (shown depth desyncs) | flow cross-check: shown value vs. state |
| 4 | on death the **"Defeated" tally isn't reset** | flow: drive to death, assert state |

Bugs #1, #3, #4 each get a **tripwire** flow script that asserts the bug is *present* — so
the suite is green today and flips **red the moment someone fixes the bug**, which stops the
fixture from silently rotting into correctness.

---

## 3. CC0 Assets (Provenance Discipline)

All art is [Kenney](https://kenney.nl) CC0: **Tiny Dungeon** (floor, monsters, heroes),
**UI Pack · Pixel Adventure** (9-sliced buttons), **Game Icons** (gear/home/return/star/
cross). Provenance was not taken on faith — each shipped image was **byte-verified by md5
against the downloaded Kenney packs** before it was kept. That caught one mis-attribution:
the menu icons were credited to "UI Pack" but actually match Kenney **Game Icons** (White/2x)
— corrected in the LICENSE.

---

## 4. Copyright-Safe Stripping

The project started life inside a larger sample with third-party engine assets and unused
scenes. To make it public-safe, we used **coir's own closure query** as the allow-list: from
the one scene we keep (`fixture.scene`), compute the transitive asset closure, then delete
everything not in it — unused anims, scenes, sample content, proprietary art. The result is
exactly what this one scene references and nothing else (the README states this explicitly so
a reviewer can check).

---

## 5. Renaming With UUID Preservation

The project + scene were renamed to `coir-copse-demo` / `fixture.scene`. Cocos identifies
assets by the uuid in the sidecar `.meta`, not by filename — so the rename moved the `.meta`
alongside the file, preserving the scene uuid (`217d2a44-…`) and every inbound reference. A
rename that dropped the `.meta` would have orphaned the whole scene.

---

## 6. The CI Harness — a Gate With No Editor

### 6.1 Pre-built web-mobile (why commit the build)
The one thing that makes this CI-able is that **there is no Cocos editor in CI**. The repo
commits a pre-built `build/web-mobile/` (relative-path-safe, so it also runs fine from a
Pages subpath). CI serves those static files and drives them with headless Chrome. Rebuild +
commit the target after editing the game.

### 6.2 The three checks
- **Coverage gate** (`ci/gate.mjs`) — runs the coir×copse join and **diffs the finding set
  against a committed baseline** (`ci/expected.json`), the same idea as coir's `coir.rules.json`.
  Green normally; red on regression (a new dead/blocked button, or a covered one going
  unreachable). Findings are *policy*, committed to the repo.
- **Flow suite** (`ci/tests/`) — one green-path script plus the three bug tripwires, run by
  **copse's own runner** `copse run <dir> --junit` (not a bespoke local script), which emits
  the per-test JUnit GitHub renders as checks.
- **Selftest** (`ci/selftest.mjs`) — seeds two regressions into a copy of the baseline and
  asserts the gate goes **red**, plus a control that the pristine baseline stays **green**. A
  gate nobody has seen fail is a no-op you trust by accident.

### 6.3 One bundled step so the server outlives its drivers
An early failure mode: the static server ran in its own step and was torn down when that step
ended, so the gate/selftest in later steps hit a dead port — the "`[3] pristine baseline →
RED-ALWAYS`" symptom. Fix: serve + coir + suite + gate + selftest all run in **one** step, so
the server is a child of that shell and a `trap` kills it only after everything has run; an
`rc` accumulator keeps JUnit publishing on failure.

---

## 7. Getting CI Green — Three Stacked Root Causes

This is where most of the time went. The first crash hid a second problem, which hid a third.
Each layer looked like "the WebGL scene won't render," and only ground-truth diagnostics —
not guesses — told them apart.

### 7.1 Symptom
`copse run` crashed at step 0 across every script, and `copse coverage` crashed too, both
with `Cannot read properties of null (reading 'children')`. Green locally, red on the runner.

### 7.2 Root cause #1 — copse read a null scene (fixed in copse)
Under a slow headless renderer the first scene can take seconds to boot; copse could reach
`cc.director.getScene().children` before the scene was live and throw. Fixed in copse
(`aaronhg/copse`): `snapshot()` returns `[]` for a null scene instead of walking `null.children`,
and the driver's boot waits until `getScene()` actually has children before returning. This
turned the hard crash into a graceful empty result — which then exposed the next problem.

### 7.3 The faithful-reproduction discipline
Rather than push-and-pray, we mirrored the runner locally in Docker: **amd64 (via Rosetta) +
real `google-chrome-stable` + SwiftShader**, first on Debian 12 (`node:22-bookworm`), then on
**Ubuntu 24.04** to match `ubuntu-latest` exactly. Both **rendered the scene fine** — so the
mirrors couldn't reproduce the failure, which was itself the key finding: the problem was
specific to the runner's *graphics stack*, not the OS or Chrome version (both were Chrome 150).

### 7.4 Root cause #2 — no software Vulkan *device* on the runner (fixed in CI)
copse launches Chrome with `--use-gl=angle --use-angle=swiftshader` — ANGLE over SwiftShader's
**Vulkan** device. A self-contained WebGL probe on the runner returned `NULL-CONTEXT` with
`ANGLE Display::initialize error: Internal Vulkan error (-3)`. Locally we reproduced the exact
error by removing `libvulkan.so.1` — but that turned out to be a *dependency of
google-chrome-stable*, so the runner **has the loader**; what it lacks is a usable software
Vulkan **device**. Fix: `apt-get install mesa-vulkan-drivers` (llvmpipe). After that the probe
reported `WEBGL=ANGLE (…SwiftShader Device…)`.

A wrong turn worth recording: a well-cited 2026 memo says ANGLE needs an X11 display even for
software rendering, and recommends **xvfb + headful**. We tried it; it still failed. That
*disproved* the display hypothesis and pointed at the GL device instead — the more useful
outcome of a failed fix is the hypothesis it kills.

### 7.5 The ground-truth probe + copse doctor
Two diagnostics ended the guessing, both printing facts instead of spinning:
- a **standalone WebGL probe** (bare Chrome + copse's exact flags → the renderer string, plus
  `vulkaninfo`), which proved the *environment* WebGL worked after the Vulkan fix; and
- **the boot diagnostic** — first a one-off `ci/boot-diag.mjs`, since promoted into copse itself
  as the **`copse doctor`** verb — which connects through **copse's own Chrome** to the actual
  game and dumps the WebGL renderer, the live scene's child count, and **the game's own console /
  pageerrors** — the thing that had been invisible. It exits non-zero on an empty scene so CI
  **fails fast (~1 min) with the reason** instead of spinning copse's boot-wait ~8× (~15 min).

### 7.6 Root cause #3 — a `.gitignore` rule ate the textures (the real blocker)
With WebGL finally working, `copse doctor` showed the truth: `WEBGL: webgl2 …SwiftShader` ✓,
engine loaded ✓, but `SCENE: "NO-SCENE"`, and a flood of **Cocos `Error 4930`** +
`Failed to load resource: 404` for `assets/main/native/**.png`. The textures were **404 on the
runner**. The cause was one line in `.gitignore` — a bare `native` (from the Cocos template,
meant for the root-level `native/` build folder). Unanchored, it matches **any** path segment
named `native`, including `build/web-mobile/assets/main/native/`, so **16 texture PNGs were
silently never committed**: present locally (scene loads), absent on a fresh checkout → 404 →
`Error 4930` → `LoadScene` aborts → `getScene()` null → empty tree → `covered:0` /
`bad-selector`. Fix: anchor the rule to `/native/` and commit the 16 textures (`build/web-mobile`
went from 24→40 tracked asset files).

### 7.7 Lessons
- **Reproduce faithfully before fixing.** The Docker mirror that *couldn't* reproduce the bug
  was as informative as one that could — it eliminated OS/Chrome-version as suspects.
- **Get ground truth, don't guess.** Each layer looked identical from the outside ("scene
  won't boot"); the WebGL probe and the copse boot diagnostic separated three unrelated causes.
- **A failed fix is a killed hypothesis.** xvfb not working is what proved it was the GL
  device, not the display.
- **Keep the diagnostic.** It stayed in CI as a fast-fail guard — and earned its way into copse
  as the `copse doctor` verb, so any game gets the same one-minute "why won't it boot" answer.

---

## 8. GitHub Pages — the Live Demo

A second job (`deploy-demo`) runs only on `main` and only after the gate is green, so the hosted
demo at **<https://aaronhg.github.io/coir-copse-demo/>** is, by construction, always a build that
passed the coir×copse join. One-time setup: *Settings ▸ Pages ▸ Source = "GitHub Actions"*.

It doesn't just upload the game — it **assembles an in-browser test panel** onto it. copse's
in-page engine (`window.__copse`) does `press`/`get`/`patch`/`clickSurface` entirely
client-side; only the puppeteer/Node half is transport, and none of that is needed in a browser.
So the deploy copies `copse.inject.js` + the flow scripts + coir's static rows next to the build
and injects `demo/testpanel.js` (which inlines copse's `subsetMatch` + arbor's `coverageJoin`). The
result: a **▶ Run the suite** button on the live page that drives the game in the visitor's own
browser and renders the same pass/fail + coverage verdict the CI gate computes — no backend, no
install. Verified headless before shipping (the panel's `runSuite` reproduces CI's `4/4 · covered:2
· dead-button:1` exactly).

---

## 9. Final State

- **The game**: one Cocos 3.8 scene (`assets/scene/fixture.scene`) + one component
  (`assets/scripts/DungeonGame.ts`), all-CC0 Kenney art (md5-verified), four buried UI bugs.
- **The join**: `coir clickmap` (static ClickEvent rows) × copse's `clickSurface` (live
  reachability), joined by **arbor**, meeting on `(nodePath, method)` — a key that survives release minification.
- **The gate** (`ci/`): baseline-diffed coverage (`gate.mjs` vs `expected.json`), a copse-run
  flow suite (1 green + 3 bug tripwires → JUnit), a selftest that proves the gate can go red,
  and a fast-fail boot diagnostic — all in one server-lifetime step.
- **The runner recipe** (the non-obvious part): no editor build; commit `build/web-mobile/`;
  install `mesa-vulkan-drivers` so headless Chrome's ANGLE→SwiftShader→Vulkan has a device;
  clone coir + copse; drive headless.
- **The pitfalls, banked**: a null-scene read (copse), a missing software Vulkan device (CI),
  and a `.gitignore` `native` rule eating web-mobile textures — each captured in a commit
  message and a workflow comment so they can't bite the next reuse.
- **Live**: green on `main` → the exact passing build is published to GitHub Pages.

> See `README.md` for the overview and how to run it; `ci/` for the gate/suite/selftest (the
> boot check is now copse's `doctor` verb, and PR-scoping is now `arbor gate`); and
> `.github/workflows/ci.yml` for the runner recipe (the comments there explain *why* each
> non-obvious step exists).
