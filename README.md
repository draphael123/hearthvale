# Hearthvale

A cozy hex tile-laying puzzle — a fantasy take on Dorfromantik. Place hex
tiles so their terrain edges (forest / field / river / village, plus unlockable
mountain & fae) line up. Matching edges score points; closing regions and
fulfilling **decrees** (region-growth quests) earns big bonuses **and** refills
your draw stack — so efficient play extends the run.

## Run it
```
npm install
npm run dev      # http://localhost:5628
```
(Or it's served statically — any static server pointed at this folder works,
since it's plain ES modules with no build step.)

## Controls
- **Click** a glowing slot to place the current tile.
- **R / Space / right-click** — rotate the tile.
- **Drag** empty space to pan · **scroll** to zoom.
- **N** — new vale (after game over).

## Mechanics
- **Edge matching** — each of a hex's 6 edges is a terrain; matched borders
  with neighbors score 10 each, a fully-matched placement is +30 PERFECT.
- **Decrees** — feature tiles occasionally raise a decree ("grow this river
  region to N"). Completing one pays out and adds reward tiles to the stack.
- **Draw stack** — you start with 50 tiles; the run ends when the stack is
  empty, so quest rewards are how you extend it.
- **Unlock tree** (persists in localStorage) — beat score thresholds to fold
  new biomes into future runs: Mountain @ 800, Fae Ring @ 2000.

## Layout
- `src/hex.js` — pointy-top axial hex math (coords, neighbors, pixels, corners)
- `src/tiles.js` — terrain palette + procedural tile generation
- `src/game.js` — board, placement, scoring, region flood-fill, quests
- `src/meta.js` — persistent best score + biome unlock tree
- `src/render.js` — all canvas drawing
- `src/main.js` — loop, input, pan/zoom

`window.__hv` exposes `{ state, place, rotate, restart }` for headless testing.
