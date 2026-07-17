# coir × copse — a UI-coverage test fixture

A tiny, self-contained **Cocos Creator 3.8** game, built as the fixture for the
**coir × copse** UI-coverage demo. It's a real little game *and* a deliberate minefield:
four UI bugs are buried in it so an automated gate can prove it catches them.

> Tap **Attack** to trade blows with the monster. Slay it and a different (tougher) monster
> appears; take too many counter-hits and you fall — then **Restart**. The ⚙ button opens a
> settings strip. Monsters and heroes cycle through several sprites.

## The four buried bugs

| # | Bug | How a UI gate catches it |
|---|-----|--------------------------|
| 1 | The menu's **✕ close button is disabled** (left `interactable:false`) | coverage → `blocked` when the menu is open |
| 2 | The **Flee button has no handler wired** | coverage → `codeOnly` (looks like a button, does nothing) |
| 3 | The **floor label never refreshes** — shown depth desyncs from the real floor | cross-check: shown value vs. game state |
| 4 | On death the **"Defeated" tally isn't reset** for the new run | reset-flow: drive to death, assert state |

The player's own HP and the enemy's HP are always correct — the bugs live in the shell
(a disabled button, an unwired button, a stale label, a missed reset), which is exactly the
class of defect a coverage gate is meant to surface.

## Run it

1. Open the project in **Cocos Creator 3.8.6**.
2. Open `assets/scene/fixture.scene`.
3. Press **Preview** (▶). It's the only scene in the project.

`assets/scripts/DungeonGame.ts` is the whole game (one component). The RNG hooks
`rollCounter` / `rollDescend` / `rollMiss` are separate methods on purpose, so a driver can
pin them for deterministic tests.

## CI — the coir × copse gate (`ci/`)

The gate runs against a **pre-built** `build/web-mobile/` — no Cocos editor in the loop,
which is the whole reason it's CI-able. Build once (Creator ▸ *Project ▸ Build ▸ web-mobile*)
and **commit the output**; CI serves the static files and drives them with headless Chrome.

```
coir clickmap    coir  → static ClickEvent map from fixture.scene   (→ ci/coir-rows.json)
ci/gate.mjs      copse → live coverage, diffed vs expected.json      (green / red-on-regression)
ci/selftest.mjs  proves the gate can actually go red
ci/tests/        copse flow scripts — run as a suite by copse's own `copse run <dir> --junit`
```

(The flow suite is copse's built-in runner, not a local script — `copse run <dir> --junit`
emits the per-test JUnit that GitHub shows as PR checks.)

Green normally, red on drift:

- **coverage gate** — Attack + gear-menu are `covered`, Flee is a `dead-button` (#2),
  Close/Restart `unreached`. A new dead/blocked button (or a covered one going unreachable)
  fails it.
- **green-combat** — drives a clean win and asserts HP / kills / enemy-HP — guards the core loop.
- **tripwires** — one flow script per buried bug (#1 disabled ✕, #3 stale floor label,
  #4 kept tally): each asserts the bug is *present* (so it's green) and flips **red** the
  moment it's fixed, so the fixture can't silently rot into correctness.

GitHub Actions (`.github/workflows/ci.yml`) never builds the project: `ubuntu-latest` already
ships the Chrome copse needs, so it just clones coir + copse, serves `build/web-mobile`, and
runs the suite → JUnit. (coir/copse are cloned from GitHub — if yours are private, add a PAT;
see the workflow comment.)

On a green push to `main`, a second job publishes that same `build/web-mobile/` to **GitHub
Pages** — `https://<owner>.github.io/<repo>/` — so the live, playable demo is always a build
that passed the gate. One-time: repo *Settings ▸ Pages ▸ Source = "GitHub Actions"*.

Locally (no deps to install — the harness spawns the coir/copse CLIs): in `ci/`, start
`npm run serve &`, then `COIR_CLI=… COPSE_CLI=… npm run check`. Runs `--headed` on purpose —
headless Chrome renders Cocos via SwiftShader and cooks the machine; CI is headless because
its container is ephemeral.

## Assets — all CC0

Art is from [Kenney](https://kenney.nl) (Creative Commons Zero, CC0):

- **Tiny Dungeon** — floor, monsters, and heroes (`assets/art/kenney_tiny-dungeon`, `art/dungeon/hero.png`)
- **UI Pack · Pixel Adventure** — the 9-sliced buttons (`assets/art/kenney_ui-pack-pixel-adventure`)
- **Game Icons** — the menu icons (gear / home / return / star / cross) (`assets/art/kenney`)

No third-party engine assets, sample content, or proprietary art are included — the project
was stripped to exactly what this one scene uses.

## License

- **Code** (`DungeonGame.ts`): MIT — see [LICENSE](LICENSE).
- **Art**: CC0, by Kenney (see above). Attribution appreciated but not required.
