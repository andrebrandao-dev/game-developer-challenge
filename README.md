# Pirate Battle

A top-down 2D naval shooter built with **React**, **TypeScript (strict)** and
**PixiJS**. Sail between islands, sink enemy ships and score as many points as
you can before the time runs out. Ranking and match history are served by a
REST API simulated in the browser with **MSW**, consumed through **Axios** and
**TanStack Query**, and the game is covered by **Playwright** E2E and visual
regression tests.

- **Live demo:** _<!-- DEPLOY_URL -->to be added after the Vercel deploy_
- **Architecture & decisions:** [ARCHITECTURE.md](ARCHITECTURE.md)
- **Performance report:** [docs/perf/REPORT.md](docs/perf/REPORT.md)
- **Original challenge brief:** [docs/CHALLENGE.md](docs/CHALLENGE.md)

## Quick start

Requirements: **Node.js ≥ 20.19** and **pnpm 10** (`corepack enable` picks the
version pinned in `package.json`).

```bash
pnpm install
pnpm dev          # http://localhost:5173
```

No backend or private service is needed. The ranking/history API is mocked
in the browser, in development and in the published build.

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | Dev server with HMR (React Strict Mode on) |
| `pnpm build` | Type-checks and builds the optimised bundle into `dist/` |
| `pnpm preview` | Serves the production build on http://localhost:4173 |
| `pnpm lint` | ESLint (typescript-eslint strict, type-aware) |
| `pnpm typecheck` | TypeScript project check (app, tests, configs) |
| `pnpm test:unit` | Vitest: simulation rules, determinism and soak tests |
| `pnpm test:e2e` | Playwright E2E + visual regression (builds and previews automatically) |
| `pnpm test:e2e:ui` | Playwright UI mode |
| `pnpm test:e2e:update` | Re-generate the visual regression baselines |
| `pnpm perf` | Profiling run: 3-minute match + 5 memory cycles → `docs/perf/` |
| `pnpm assets` | Regenerate `public/game/` from `assets/` (runs automatically before `dev`/`build`) |

The first E2E run needs the browser: `pnpm exec playwright install chromium`.

## Environment variables

Optional. Copy `.env.example` to `.env.local` to override.

| Variable | Default | Purpose |
| --- | --- | --- |
| `VITE_API_BASE_URL` | `/api` | Base URL of the ranking/history API (intercepted by MSW) |
| `VITE_API_TIMEOUT_MS` | `4000` | Axios timeout in milliseconds |

## Controls

| Action | Keyboard | Touch |
| --- | --- | --- |
| Sail forward | `W` / `↑` | ⬆ (left pad) |
| Turn left / right | `A` `D` / `←` `→` | ↶ ↷ (left pad) |
| Bow cannon (1 shot forward) | `Space` / `K` | top button (right pad) |
| Port broadside (3 shots, left) | `Q` / `J` | left button (right pad) |
| Starboard broadside (3 shots, right) | `E` / `L` | right button (right pad) |
| Pause | `Esc` / `P` / pause button | pause button |

- Every action can be held together (sail, turn and fire at the same time).
- Game keys are only captured during active gameplay. Menus are fully
  keyboard navigable (`Tab`, `Enter`, arrows in the Captain's Log tabs, `Esc`
  closes dialogs and resumes from pause).
- The game pauses automatically when the window loses focus or the tab is
  hidden. Resuming always requires pressing **Resume**.
- On phones the game is played in **landscape**; rotating to portrait pauses
  the match and asks you to rotate back.

## Gameplay

- **Chasers** (red) chase you and explode on impact (15 damage, no points).
- **Shooters** (blue) close in to firing range, keep their distance and fire
  when aligned with you and in line of sight.
- Every enemy sunk by your cannons is worth **1 point**.
- A match ends when the time runs out or your ship sinks. Leaving the battle
  or refreshing the page abandons it (nothing is recorded).

### Gameplay configuration

All balancing values live in one typed object,
[`DEFAULT_GAME_CONFIG`](src/config/gameConfig.ts): speeds, turn rates,
health, damage, ranges, projectile speed and lifetime, cooldowns, spawn
cadence, cap and distribution, Shooter ranges and AI look-ahead. Systems read
only from the config, so balancing never touches logic. Each match uses a
frozen snapshot taken at start.

The **Options** screen exposes:

| Option | Limits | Default |
| --- | --- | --- |
| Game session time | 60–180 s, steps of 10 | 120 s |
| Enemy spawn time | 0.5–10 s, steps of 0.5 (must be positive) | 3 s |

Options are validated, saved explicitly and persisted in localStorage. Changes
made during a match (from the pause menu) apply to the next match.

## Network scenarios (mock API)

Open **Network lab** (top-right corner of the menus) to pick a scenario. The
choice survives a refresh. **Reset mocks** restores the initial state:
fixtures only, the `normal` scenario, no pending records and an empty cache.

| Scenario | Behaviour |
| --- | --- |
| `normal` | Success with 120–380 ms latency |
| `empty` | Ranking and history return no entries |
| `many-pages` | Large dataset spanning many pages |
| `slow` | Every response takes 2.5 s |
| `variable-latency` | 50 ms–3 s latency |
| `out-of-order` | Alternating 2.5 s / 100 ms, so responses arrive out of order |
| `timeout` | No request is ever answered |
| `offline` | Network-level failure |
| `http-400` / `http-500` | Every request fails with that status |
| `ranking-fails` / `history-fails` | Only that endpoint fails (500) |
| `record-timeout` | Saving stores the record but the first attempt never gets an answer |
| `record-unavailable` | Saving fails with 503 until another scenario is selected |

Scenarios can also be selected with a URL parameter, e.g.
`http://localhost:5173/?scenario=record-unavailable`. Latency randomness is
seeded and resets on every scenario change, so runs are reproducible.

### Reproducing failures

| What to see | Steps |
| --- | --- |
| Loading / empty / error states | Select `slow`, `empty` or `ranking-fails`, open **Ranking** |
| Retries & error message | `http-500` (retried twice, then error + Try again). `http-400` fails at once |
| Save fails, survives refresh, recovers | `record-unavailable` → play a match → result shows *Not saved yet* → refresh → **Match history** shows the pending notice → select `normal` → it is saved once |
| Timeout after the server stored the record | `record-timeout` (add `&apiTimeout=1000` to the URL to shorten the wait) → finish a match → the retry gets the stored record, with no duplicate |
| Late responses | `out-of-order` → **Ranking** → page quickly between 1 and 2: the visible page never reverts to stale data |
| Asset loading failure | DevTools → Network → block `ships.png` → **Play** → error + **Try again** |

### Developer URL flags

| Flag | Effect |
| --- | --- |
| `?seed=1234` | Fixed gameplay seed (spawn points, enemy mix) |
| `?perf=1` | Frame-time overlay during battles |
| `?scenario=<id>` | Select a network scenario at boot |
| `?apiTimeout=1500` | Override the HTTP timeout |
| `?testHooks=1` | Expose `window.__pirateBattle` (state, clock, mocks) for tests |
| `?clock=manual` | With test hooks: simulation only advances through `__pirateBattle.session.advance(ms)` |

## Tests

```bash
pnpm test:unit                       # Vitest, a few seconds
pnpm exec playwright install chromium
pnpm test:e2e                        # builds, previews and runs the E2E suite
pnpm exec playwright show-report     # HTML report (playwright-report/)
```

- **Projects:** `desktop-chromium` (full suite, 1600×900) and
  `mobile-chromium` (Pixel 7 landscape, touch, flows tagged `@mobile`).
- **Reproducible:** fixed seeds, a manual simulation clock driven by the
  tests, seeded mock latency, and a fresh browser context per test.
  Combat tests press real keys or touch buttons and assert on the resulting
  simulation state.
- **Artifacts:** HTML report in `playwright-report/`; trace, video and
  screenshot of failures in `test-results/`
  (`pnpm exec playwright show-trace test-results/<test>/trace.zip`).
- **Visual regression:** baselines for the menu, a stable arena frame and the
  result screen live in `e2e/__screenshots__/` (generated on macOS; run
  `pnpm test:e2e:update` to regenerate them on another platform).
- Any unhandled console error fails the test.

Coverage map:

| Area | Spec |
| --- | --- |
| Options navigation, validation, persistence, config snapshot | `e2e/options.spec.ts` |
| Asset loading, failure and retry | `e2e/assets.spec.ts` |
| Start, movement, rotation, arena limits, island collision | `e2e/movement.spec.ts` |
| Bow and broadside fire, cooldowns, damage once, scoring | `e2e/combat.spec.ts` |
| Chaser, Shooter, spawn interval | `e2e/enemies.spec.ts` |
| Time up, death, frozen simulation, clean restart | `e2e/match-end.spec.ts` |
| Manual/automatic pause, resume without time leaks, focus trap | `e2e/pause.spec.ts` |
| Result persistence, abandoning, repeated navigation, touch controls | `e2e/navigation.spec.ts` |
| Ranking/history, pagination, loading, empty, errors, timeouts | `e2e/captains-log.spec.ts` |
| Record once, both tabs updated, pending after refresh, timeout without duplicates, late responses | `e2e/records.spec.ts` |
| Visual baselines | `e2e/visual.spec.ts` |

## Performance

`pnpm perf` builds the app and runs [perf/profile.spec.ts](perf/profile.spec.ts)
in full Chromium at 1920×1080: a full 3-minute match at the heaviest spawn
setting with a scripted pilot, then 5 cycles of start → play → exit with
forced GC between samples. Results, hardware, browser and limitations are in
[docs/perf/REPORT.md](docs/perf/REPORT.md).

## Deploy

The project deploys to **Vercel** as a static site ([vercel.json](vercel.json)):
`pnpm install --frozen-lockfile`, then `pnpm build`, output `dist/`. The MSW
worker ships in the build, so ranking and history work on the published URL.
Routing is hash based, so refreshing any screen works without rewrites.

## Project structure

```
assets/            Provided art and sounds (source of truth)
scripts/           prepare-assets.mjs: builds public/game/ from assets/
src/
  config/          Typed gameplay config and option validation
  game/
    core/          Simulation: world, systems (movement, collisions, combat, AI, spawner), tests
    render/        PixiJS views: arena, ships, effects, renderer, viewport
    input/         Keyboard + touch → ControlIntent
    audio/         Web Audio manager and event → sound mapping
    assets/        Atlas loading and texture helpers
    perf/          Frame statistics
    GameSession.ts Lifecycle of one match (Pixi app, loop, pause, teardown)
  api/             Contracts, Axios client, queries, outbox, sync agent
  mocks/           MSW handlers, fixtures, scenarios, mock database
  app/             Router, preferences, match lifecycle, URL flags
  screens/         Menu, battle (HUD, touch, pause), result, Captain's Log
  ui/              Shared components (modal, options form, network lab)
  testing/         Test hooks and test-only config overrides
e2e/               Playwright specs, fixtures and visual baselines
perf/              Profiling spec
docs/              Challenge brief and performance report
```

## Credits & licenses

- **Game art, UI and sounds** (`assets/`): provided by Jungle Gaming as part
  of this challenge. The ship, tile and effect sprites match
  [Kenney's Pirate Pack](https://kenney.nl/assets/pirate-pack) (CC0 1.0). The
  UI kit and sounds are distributed with the challenge; refer to its
  repository for their terms. The atlases are converted at build time; the
  source files are unchanged.
- **Fonts:** system font stacks only (no font files are bundled).
- **Libraries:** React, PixiJS, TanStack Query, Axios, zod and MSW (MIT
  licensed); Playwright and TypeScript (Apache-2.0). See `pnpm-lock.yaml`
  for exact versions.
