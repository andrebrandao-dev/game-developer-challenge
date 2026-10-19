# Architecture

This document explains how Pirate Battle is put together and why. It covers the
React/PixiJS integration, the simulation loop, collisions, resource management,
local persistence, the ranking/history integration, and the known limitations
and balancing decisions.

## Layers at a glance

```
┌──────────────────────────── React (src/app, src/screens, src/ui) ───────────────────────────┐
│ Router · Menus · Options · HUD · Pause dialog · Result · Captain's Log · Network lab        │
│        ▲ useSyncExternalStore (HUD / session state, ~1 update per second)                   │
└────────┼────────────────────────────────────────────────────────────────────────────────────┘
         │ creates / destroys                         ▲ TanStack Query (cache, retries)
┌────────┴──────── GameSession (src/game/GameSession.ts) ─────┐   ┌──────── src/api ──────────┐
│ Pixi Application · ticker loop · pause · resize · audio     │   │ Axios client · contracts  │
│   ├─ InputController (keyboard + touch → ControlIntent)     │   │ outbox (pending records)  │
│   ├─ Simulation (src/game/core) ── pure TS, no DOM/Pixi     │   │ RecordSyncAgent           │
│   ├─ GameRenderer (src/game/render) ── reads the world      │   └────────────┬──────────────┘
│   └─ SoundDirector (src/game/audio) ── reads events         │                │ HTTP (/api)
└─────────────────────────────────────────────────────────────┘   ┌────────────┴──────────────┐
                                                                  │ MSW worker (src/mocks)    │
                                                                  │ handlers · scenarios · db │
                                                                  └───────────────────────────┘
```

| Concern | Where | Depends on |
| --- | --- | --- |
| Game rules (movement, combat, AI, spawns, scoring, match end) | `src/game/core` | nothing (pure TypeScript) |
| Balancing values | `src/config/gameConfig.ts` | nothing |
| Rendering | `src/game/render` | Pixi, reads `World` |
| Input | `src/game/input` | DOM events, produces `ControlIntent` |
| Match lifecycle (loop, pause, resize, teardown) | `src/game/GameSession.ts` | all of the above |
| UI state, menus, dialogs | `src/screens`, `src/ui`, `src/app` | React |
| Remote state (ranking, history) | `src/api` | Axios, TanStack Query, zod |
| Mock backend | `src/mocks` | MSW |

The core never imports from Pixi, React or the DOM, so it is unit-tested under
plain Node (`pnpm test:unit`), including 3-minute soak matches.

## React ↔ PixiJS integration

- **One `GameSession` per mounted battle.** `BattleScreen` creates the session
  in an effect and destroys it in the cleanup. The session creates its own
  `Application` (not the shared ticker) inside the stage `<div>`.
- **React Strict Mode.** In development effects run mount → unmount → mount.
  `Application.init` is async, so the first session can be destroyed before it
  finished initialising. `mount()` checks a `destroyed` flag after `await
  app.init()` and tears the late application down immediately. Only the second
  session ever attaches a canvas. Tests verify that no canvas outlives a battle.
- **No React render per frame.** The session exposes two tiny observable
  stores (`ValueStore`): `hud` (score, health, *whole* seconds remaining,
  enemy count) and `state` (phase, pause reason). `ValueStore.set` compares
  shallowly and only notifies on change, so the HUD re-renders about once per
  second (when the clock changes) or when score/health change. React subscribes
  with `useSyncExternalStore`.
- **Continuous state stays in the simulation.** Positions, velocities,
  cooldowns and projectiles never enter React state.
- **Ownership is split clearly.** Pixi draws the arena, ships, projectiles,
  effects and the bars above ships. React draws the HUD, touch buttons, pause
  dialog and every menu. The canvas is `aria-hidden`; the semantic
  information lives in the HUD (`role="meter"`, `role="timer"`) and in a polite
  live region that announces milestones (score, health thresholds, 60/30/10 s,
  pause/resume), never per-frame values.

## Simulation cycle

`Simulation` (src/game/core/simulation.ts) advances the `World` in **fixed
steps of 1/60 s** from a `ControlIntent`:

```
frame (Pixi ticker, variable dt)
 └─ sim.advance(dt, intent)           accumulator += dt; run N fixed steps (max 5/frame)
     └─ step(intent)
         1. store prev positions/angles (render interpolation)
         2. time += 1/60 → if time ≥ duration: end('time_up')
         3. tick weapon cooldowns
         4. player: steer → resolve vs islands/edges → fire requested weapons
         5. enemies: AI helm → steer → resolve vs islands/edges (shooters may fire)
         6. ship-vs-ship: chaser rams player (damage, chaser explodes) / separation
         7. projectiles: sub-stepped movement, hits, range/lifetime/bounds expiry
         8. remove destroyed ships; player sunk → end('destroyed')
         9. spawner
 └─ renderer.render(events, alpha, fxDt)   interpolates prev→current by alpha
```

- **Frame-rate independent.** Every rate is per second and only the fixed
  step size is used inside `step`. A unit test checks that 30 FPS and 144 FPS
  frame streams produce exactly the same world. The accumulator tolerates
  float drift and drops time beyond 5 steps/frame, so a stalled tab cannot
  fast-forward the match.
- **Deterministic.** All randomness (spawn points, enemy mix) uses a seeded
  mulberry32 `Rng`. The seed can be fixed with `?seed=` for tests and
  profiling. Visual effects use their own seeded RNG, so screenshots are
  reproducible too.
- **Events, not callbacks.** The simulation appends `GameEvent`s (shot fired,
  hit, destroyed, rammed, projectile expired, score changed, match ended).
  The session drains them once per frame and hands them to the renderer
  (effects), the sound director and the HUD store, in order.
- **Match end** sets `status = 'ended'`; `step()` returns immediately from then
  on, so movement, attacks, damage, spawns and scoring all stop at once.
  `damageShip` also refuses to score once the player has sunk, so a shot still
  in flight during the losing step cannot count.
- **Destroyed enemies stop causing damage.** They leave the ship list in the
  same step (no more AI, firing or collisions), and `destroyShip` makes their
  projectiles still in flight fizzle out.
- **Pause** (manual: Esc/P/button; automatic: window `blur`,
  `visibilitychange`, portrait orientation on phones) disables input (which
  clears held keys), stops the Pixi ticker and renders the frozen frame once.
  `resume()` is only called from the pause dialog. It clears input and the
  accumulator and skips the first ticker delta, so nothing from the paused
  period leaks into the match. Cooldowns live in simulation time, so they are
  frozen too.
- **Input.** `InputController` aggregates keyboard and touch into one intent;
  several actions can be held at once (sail + turn + fire). Taps shorter than
  a frame are latched until a step consumes them. Keys are captured, and
  `preventDefault` is called, only while gameplay is active and focus is not
  in a form field.

## Collisions

- **Shapes.** Ships are **capsules** (a segment along the hull plus a radius),
  which match the long hull sprites much better than circles. Islands are
  **rounded rectangles** derived from the tile layout, inset to follow the
  drawn coastline. Projectiles are small circles.
- **Ship vs island/edges.** The bow, centre and stern sample circles are
  tested against each island (circle vs rounded rect = point vs core rect with
  radii added) and the four arena walls. The deepest penetration is resolved
  along its normal, iterating 3 times. Speed is reduced by how head-on the
  impact was, so ships slide along coasts instead of sticking.
- **Ship vs ship.** Capsule–capsule closest points (segment–segment distance).
  A chaser touching the player is a ram. Every other overlap is separated
  half-and-half and re-resolved against the islands, so a push can never shove
  a hull into land.
- **Projectiles** move in sub-steps of at most 6 units, so a fast shot cannot
  tunnel through a hull or a thin coast. The first hit wins: the projectile is
  marked dead before damage is applied, so **damage is applied exactly once**.
  Projectiles expire on range, on lifetime, on islands or when leaving the
  arena.
- **AI avoidance.** Enemies cast look-ahead rays (swept circles). If the
  direct heading is blocked they try increasing offsets, starting on the side
  they committed to (kept for 0.6 s to prevent oscillation). Shooters only fire
  within range, when aligned, and with a clear line of sight.
- **Spawns** happen in a band along the arena border, at least 560 units from
  the player, with clearance from islands and ships (up to 24 tries, otherwise
  retry 0.25 s later). A shuffle bag over the configured weights guarantees
  both enemy types appear early in every match.
- **Broad phase.** None: there are 6 islands and at most 9 ships, so the O(n·m)
  checks are cheaper than maintaining a grid. A uniform grid would be the next
  step if the arena or caps grew.

## Rendering & resource management

- **Atlases.** `scripts/prepare-assets.mjs` (runs before `dev` and `build`)
  converts the Starling XML ship sheet and the 64 px tile grid into Pixi JSON
  atlases, and copies the UI atlas, individual UI PNGs, sounds and the menu
  background into `public/game/`. High-DPI screens get the 2× tile and UI
  atlases. The ship sheet in the pack has no real 2× variant.
- **Loading.** `loadGameAssets` loads one Pixi `Assets` bundle with progress
  reporting. Failures surface as an `AssetLoadError`; the battle screen shows
  an error with **Try again**. Pixi evicts failed entries from its cache, so a
  retry performs real requests. Loaded textures are **cached and reused** by
  every later match. Sessions never destroy atlas textures, only what they
  created themselves.
- **Static arena.** Water is a `TilingSprite` (its drift is driven by the
  effect clock). Islands and decorations are rendered once into a texture
  (`cacheAsTexture`). The overscan water and shading are deliberately *not*
  cached: at 2× density that texture would exceed GPU memory.
- **Entities.** One `ShipView` per ship id. The texture swaps between intact,
  damaged and critical as health drops, fire sprites appear, and a hit flash
  plays. Health bars follow the atlas metadata (`fill_rect`, left-origin
  clip): the fill is a cropped sub-texture cached per pixel width. Projectile
  sprites are pooled.
- **Effects** use a pooled particle system (one generic tweened sprite type)
  for muzzle smoke, splashes, dust, wood debris, explosions, wakes and sinking
  wrecks. Particles are capped at 900.
- **Resize & density.** A `ResizeObserver` on the stage resizes the renderer.
  The 1920×1080 arena is fitted with *contain* (whole arena always visible,
  proportions kept, letterbox filled with shaded water). Pixi runs with
  `resolution = min(devicePixelRatio, 2)` and `autoDensity`, and a
  `matchMedia(resolution)` listener reacts to DPR changes (moving between
  screens, zoom). Gameplay only ever sees world units, so input and arena
  limits are unaffected by screen size.
- **Teardown** (`GameSession.destroy`, also on restart, abandon, back button,
  refresh) removes keyboard, blur, visibility and DPR listeners, disconnects the
  ResizeObserver, stops audio loops, removes the ticker callback, destroys the
  renderer (views, pools, generated textures, bar textures) and the Pixi
  application with its canvas. The memory profile below shows the result.

## Local persistence

All storage goes through `readJson`/`writeJson` with zod validation. Corrupted
or outdated data falls back to defaults, and unavailable storage (private
mode, quota) never breaks the app.

| Key | Content |
| --- | --- |
| `pirate-battle:options:v1` | Session time and spawn interval (validated against `OPTION_LIMITS`) |
| `pirate-battle:profile:v1` | Player id (UUID) and captain name |
| `pirate-battle:last-result:v1` | Last completed match (record + kills), shown on the result screen after refresh |
| `pirate-battle:outbox:v1` | Pending match records and recently confirmed ids |
| `pirate-battle:audio-muted:v1` | Sound preference |
| `pirate-battle:mock-db:v1` | Mock server: records created through the API, revision |
| `pirate-battle:mock-scenario:v1` | Selected network scenario |

A match in progress lives only in memory. Refreshing or leaving the battle
screen (menu, back button) abandons it, and nothing is recorded.

## Ranking & match history

### Contracts (`src/api/contracts.ts`)

zod schemas shared by the Axios client (every response is validated) and the
MSW handlers (every request body is validated):

```
GET /api/ranking?sessionDurationSec&spawnIntervalSec&page&pageSize  → Page<RankingEntry>
GET /api/players/:playerId/matches?page&pageSize                    → Page<MatchRecord>
PUT /api/matches/:matchId   body: MatchRecord                       → { record, created, revision }
GET /api/matches/:matchId                                           → MatchRecord
```

A `MatchRecord` carries `matchId` (client UUID), `playerId`, `playerName`,
`playedAt`, `score`, `durationMs` (effective, unpaused time), `endReason` and
the `config` it was played with. Pages include `revision`, the server's data
version when the page was produced.

**Ranking rules.** Only matches with the *same config* are compared (the
ranking tab filters by battle settings, defaulting to the current options).
Every match is one entry. Ties are broken deterministically by score desc,
then shorter duration, then earlier `playedAt`, then `matchId`.

### Recording a match without duplicates

1. When a match ends, `completeMatch` builds the record, persists it as the
   *last result* and adds it to the **outbox** (localStorage), all *before*
   any network call.
2. `RecordSyncAgent` (mounted once at the app root) drains the outbox with a
   TanStack `useMutation`:
   - `PUT /matches/:matchId` is **idempotent**. The server returns `201`
     (created) or `200` with the stored record (already exists), and `409` if
     the id exists with a different payload.
   - Every mutation shares one `scope`, so they run **serially**. An in-flight
     set prevents the same record from being sent twice at once (double
     clicks).
   - Transient failures (timeout, network, 5xx, 408/429) are retried twice
     with deterministic backoff (500 ms, 1 s). After that the record is marked
     **failed** and kept.
   - Failed records are retried on boot, on the `online` event, on a network
     scenario change, or manually (**Try again** on the result screen and in
     the history tab).
   - A record interrupted by a refresh (`syncing`) is restored as `pending` and
     resent. The server's idempotency makes that safe.
3. On success the record leaves the outbox, its id is remembered as
   confirmed, and **both** `ranking` and `history` queries are invalidated.

The player can start new matches while records are pending; the outbox is
independent from the battle.

### Queries, cache and stale responses (`src/api/queries.ts`)

- Query keys: `['ranking', duration, interval, page]` and
  `['history', playerId, page]`.
- `staleTime` is 10 s, `refetchOnMount: 'always'` (tabs refresh every time
  they are shown again, with cached data visible meanwhile), and
  `refetchOnWindowFocus` is on. `placeholderData: keepPreviousData` keeps the
  old page on screen while the next one loads.
- Retries only for retryable errors (max 2). 4xx errors fail fast.
- The query function receives TanStack's `AbortSignal` and passes it to
  Axios, so invalidated or superseded requests are cancelled.
- **Out-of-order protection.** On top of cancellation, `freshest()` compares
  the response `revision` with the cached data and with the highest revision
  already seen (including confirmed writes). An older response never replaces
  newer cached data, and a response older than a confirmed write is
  refetched once.
- The UI distinguishes first load, empty, error (with retry), stale data
  after a failed refresh (banner + retry) and background refresh
  ("Updating…").

Failures in these APIs never block the game, the options or the combat. They
are isolated in the Captain's Log and the record status.

### Mocks (`src/mocks`)

The handlers, fixtures and scenarios are the same code in development, in the
Playwright tests and in the published build (`mockServiceWorker.js` is served
from `public/`). Confirmed records persist in localStorage. Rivals are
deterministic fixtures with fixed dates. Scenarios are data (latency model +
outcome per endpoint), selected in the **Network lab** or with `?scenario=`,
and use a seeded latency PRNG that resets on every change:

`normal`, `empty`, `many-pages`, `slow`, `variable-latency`, `out-of-order`,
`timeout`, `offline`, `http-400`, `http-500`, `ranking-fails`, `history-fails`,
`record-timeout` (stores the record, then never answers the first attempt),
`record-unavailable` (503 until another scenario is selected).

**Reset mocks** restores fixtures only, the default scenario, an empty outbox
and an empty query cache.

## Testing strategy

- **Unit (Vitest)**: deterministic rules: movement, frame-rate independence,
  bounds, islands, weapons and cooldowns, single damage, scoring, ram rules,
  shooter behaviour, spawn interval and safety, determinism, match end. A soak
  test plays three 180 s matches and checks physical invariants every step.
- **Accessibility**: `e2e/a11y.spec.ts` runs axe-core (WCAG 2.1 A/AA,
  including colour contrast) on the menu, controls, options with a validation
  error, ranking, history, network lab, battle HUD, pause dialog and result.
  The battle also exposes its state (in progress / paused / ended) as text.
- **E2E (Playwright)**: run against the production build on desktop and mobile
  Chromium. Instrumentation (`?testHooks=1`) can read the state and step the
  clock (`?clock=manual`), but the real input, simulation, collision and
  rendering code always runs: combat tests press real keys or touch buttons.
  Test-only config overrides (`configOverrides`) change *balancing values*
  only, e.g. a sturdy player so a match reliably reaches its time limit. A
  fixture fails any test with an unexpected console error.

## Limitations

- WebGL is required. Without it, the battle screen shows an error; menus,
  options and the Captain's Log still work.
- Audio files are the original WAVs (~5.7 MB), loaded in the background after
  the first user gesture. They are not part of the match bundle, so they never
  block or fail a match. Converting them to Opus/AAC would cut the size, but
  the Playwright Chromium build cannot decode AAC and no Opus encoder was
  available in the toolchain.
- The arena is a fixed 1920×1080 world. On very wide or tall screens the
  letterbox shows shaded water.
- Collision shapes are capsules and rounded rectangles: accurate for these
  sprites, but not pixel-perfect around palm decorations (purely visual).
- The mock database lives in the browser: data is per device and per browser
  profile, by design.
- Visual-regression baselines are platform specific (fonts and GPU
  rasterisation). The committed baselines were generated on macOS.

## Balancing decisions

All values live in `DEFAULT_GAME_CONFIG`; a match uses a frozen snapshot of
it merged with the player's options.

| Value | Choice | Why |
| --- | --- | --- |
| Player | 100 HP, 210 u/s, 2.6 rad/s | Agile enough to dodge Chasers and line up broadsides |
| Bow cannon | 34 dmg, 0.45 s cooldown, 560 range | Precise long-range tool. 2 hits sink a Chaser, 3 a Shooter |
| Broadside | 3 × 25 dmg, 1.6 s cooldown per side, 420 range | High burst at close range. Rewards positioning, with independent left/right cooldowns |
| Chaser | 50 HP, 150 u/s, ram 15 dmg | Faster than Shooters, fragile. Ramming kills it without scoring, so dodging or shooting it first matters |
| Shooter | 75 HP, 115 u/s, 8 dmg every 2.6 s, range 480, keeps 300 | Pressure at range. Holds distance and needs alignment plus line of sight to fire |
| Spawns | First at 1.5 s, then every *interval*, max 8 active, ≥ 560 u from player | Never spawns on top of the player. The cap keeps 1 s intervals playable |
| Spawn interval option | 0.5–10 s, steps of 0.5 | Positive and bounded. 0.5 s is the "chaos" end, 10 s a calm practice mode |
| Session option | 60–180 s, steps of 10 | As specified |

The first version (ram 20, shooter 10 dmg/2.2 s, cap 10) sank an idle player
in about 18 s at the default 3 s interval. Measured with the current values
(headless simulation, 10 seeds, default 3 s interval):

| Pilot | Survival | Score |
| --- | --- | --- |
| Idle (no input) | 20–27 s (avg ≈ 24 s) | 0 |
| Scripted, no aiming (weave + fire everything) | 31–88 s of a 120 s match | 0–7 |

Standing still is punished quickly, while moving and aiming is clearly
rewarded. Surviving the full time is meant to take deliberate play
(dodging Chasers, keeping Shooters in the bow cannon's line).
