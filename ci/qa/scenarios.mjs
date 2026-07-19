// ci/qa/scenarios.mjs — the fixture's calibration scenarios (like test files). A scenario is a goal +
// the RNG pins that make its state reachable deterministically. `kind:'gate'` = a structural bug the
// hard gates catch (dead/disabled); `kind:'semantic'` = a bug only the judge (or a frozen tripwire) sees.
const G = 'Canvas/Game:DungeonGame';
const pin = (m, body) => ({ sel: `${G}.${m}`, replace: body });

export const scenarios = [
  { id: 'flee-dead', bug: '#2', kind: 'gate', pins: [],
    goal: 'A "Flee" action was added to the combat UI. Verify the Flee button actually does something when pressed (drives some game state / opens something).' },

  { id: 'menu-close-disabled', bug: '#1', kind: 'gate', pins: [],
    goal: 'The settings-menu open/close flow was changed. Open the menu (MenuBtn), then close it with the X (MenuPanel/CloseBtn). Verify the close actually works.' },

  { id: 'floor-desync', bug: '#3', kind: 'semantic',
    pins: [pin('rollCounter', '()=>false'), pin('rollMiss', '()=>false'), pin('rollDescend', '()=>true')],
    goal: 'The floor-descend / floor-label code was changed. Verify FloorLabel always shows the REAL current floor — including right after slaying a monster and descending. Read BOTH the FloorLabel text AND the real .floor so a disagreement is visible.' },

  { id: 'tally-kept', bug: '#4', kind: 'semantic',
    pins: [pin('rollCounter', '()=>true'), pin('rollMiss', '()=>false'), pin('rollDescend', '()=>false')],
    goal: 'The run-reset / Restart logic was changed. The hero must actually DIE first: read .hp after each Attack and KEEP attacking (it takes ~4 hits — the monster counters every surviving turn) until .hp reads 0. Do NOT press Restart until .hp is 0. THEN press RestartBtn to begin a fresh run, sleep, and read .kills. On a fresh run the "Defeated" tally (.kills) MUST be 0.' },
];
