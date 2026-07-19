# Tiny Dungeon — Design Spec (v1)

A one-screen, turn-based dungeon crawler. The player taps **Attack** to trade blows with a monster;
clearing monsters takes the hero deeper. A short, replayable "one more run" loop.

## Core loop

- The hero faces one monster at a time. Tapping **Attack** makes the hero strike; a monster that
  survives the hit may strike back. The hero can also miss.
- Defeating a monster increases the **Defeated** count by 1 and brings out the next (tougher) monster.
- If the hero's HP reaches 0 the run ends in a game-over; the player can then start a fresh run.

## Controls

- **Attack** — the hero attacks the current monster.
- **Flee** — abandon the current encounter. The hero escapes and a **new encounter begins** (a fresh
  monster appears); you do not keep fighting the same one. Flee is available during combat.
- **Menu (gear)** — opens the settings panel. Tapping it again dismisses the panel.
- **Close (the X inside the panel)** — closes the settings panel and returns to the game. Whenever the
  panel is open, this control must be usable to close it.
- **Restart** — appears on game-over; starts a fresh run.

## HUD labels — must always reflect live state

- **HP: x/3** — the hero's current health.
- **Enemy HP: x/n** — the current monster's health.
- **Defeated: n** — monsters defeated **in the current run**.
- **Floor: n** — the hero's current depth. This label must **always show the real current floor and
  update the moment the hero descends** (it must never lag behind the true floor).

## Run lifecycle

- A run starts at **floor 1**, full HP, and a **Defeated count of 0**.
- On the hero's death the game shows a game-over state with a **Restart** control.
- **Restart begins a brand-new run**: HP back to full, floor back to 1, and the **Defeated count reset
  to 0** — each run's tally is independent and does not carry over from the previous run.
