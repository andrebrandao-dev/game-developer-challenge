import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { completeMatch, type ActiveMatch } from '@/app/matches';
import { runtimeFlags } from '@/app/runtimeFlags';
import { AssetLoadError, loadGameAssets, type GameTextures } from '@/game/assets/gameAssets';
import { GameSession } from '@/game/GameSession';
import { KEY_BINDINGS } from '@/game/input/InputController';
import { registerSession } from '@/testing/testHooks';
import { BattleAnnouncer } from './battle/BattleAnnouncer';
import { Hud } from './battle/Hud';
import { PauseDialog } from './battle/PauseDialog';
import { TouchControls } from './battle/TouchControls';
import { PerfOverlay } from './battle/PerfOverlay';

/** Delay between the end of a match and the result screen (lets the final explosion play). */
const RESULT_DELAY_MS = 1600;

type AssetState =
  | { status: 'loading'; progress: number }
  | { status: 'error'; message: string }
  | { status: 'ready'; textures: GameTextures };

interface BattleScreenProps {
  match: ActiveMatch;
  onFinished: () => void;
  onAbandon: () => void;
}

/** Loads the match assets (with progress and retry), then hosts the battle. */
export function BattleScreen({ match, onFinished, onAbandon }: BattleScreenProps) {
  const [assets, setAssets] = useState<AssetState>({ status: 'loading', progress: 0 });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    loadGameAssets((progress) => {
      if (!cancelled) setAssets({ status: 'loading', progress });
    })
      .then((textures) => {
        if (!cancelled) setAssets({ status: 'ready', textures });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message = error instanceof AssetLoadError ? error.message : 'Unexpected error while loading.';
        setAssets({ status: 'error', message });
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  if (assets.status === 'ready') {
    return <BattleView key={match.matchId} match={match} textures={assets.textures} onFinished={onFinished} onAbandon={onAbandon} />;
  }

  return (
    <main className="scene">
      <div className="panel">
        <div className="panel__content">
          {assets.status === 'loading' ? (
            <>
              <h2>Preparing the fleet</h2>
              <div
                className="progress"
                role="progressbar"
                aria-label="Loading game assets"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(assets.progress * 100)}
              >
                <div className="progress__bar" style={{ width: `${Math.round(assets.progress * 100)}%` }} />
              </div>
              <p className="muted" role="status">
                Loading assets… {Math.round(assets.progress * 100)}%
              </p>
            </>
          ) : (
            <>
              <h2>Rough seas!</h2>
              <p className="error" role="alert">
                {assets.message} Check your connection and try again.
              </p>
              <div className="stack">
                <button
                  type="button"
                  className="btn"
                  autoFocus
                  onClick={() => {
                    setAssets({ status: 'loading', progress: 0 });
                    setAttempt((n) => n + 1);
                  }}
                >
                  Try again
                </button>
                <button type="button" className="btn btn--secondary" onClick={onAbandon}>
                  Main menu
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  );
}

const coarsePointerQuery = '(pointer: coarse)';
const portraitQuery = '(orientation: portrait) and (pointer: coarse)';

function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
  );
}

interface BattleViewProps {
  match: ActiveMatch;
  textures: GameTextures;
  onFinished: () => void;
  onAbandon: () => void;
}

function BattleView({ match, textures, onFinished, onAbandon }: BattleViewProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [session, setSession] = useState<GameSession | null>(null);
  const [ended, setEnded] = useState<string | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const finishedRef = useRef(onFinished);
  useEffect(() => {
    finishedRef.current = onFinished;
  }, [onFinished]);

  const coarse = useMediaQuery(coarsePointerQuery);
  const portrait = useMediaQuery(portraitQuery);

  // One GameSession per mount. Strict Mode mounts twice: the first session is
  // destroyed (even mid-initialisation) before the second one is created.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    let resultTimer: number | undefined;
    const created = new GameSession({
      config: match.config,
      seed: match.seed,
      textures,
      manualClock: runtimeFlags.manualClock,
      onEnded: (result) => {
        completeMatch(match, result);
        setEnded(result.reason === 'time_up' ? 'Battle complete!' : 'Your ship has sunk!');
        resultTimer = window.setTimeout(() => finishedRef.current(), RESULT_DELAY_MS);
      },
    });
    setSession(created);
    registerSession(created);
    created.mount(stage).catch(() => setFatal('The game could not start on this device (WebGL unavailable).'));

    return () => {
      window.clearTimeout(resultTimer);
      registerSession(null);
      created.destroy();
    };
  }, [match, textures]);

  const state = useSyncExternalStore(
    session ? session.state.subscribe : noopSubscribe,
    session ? session.state.get : initialState,
  );

  // Phones must be in landscape; rotating to portrait pauses the match.
  useEffect(() => {
    if (portrait && session) session.pause('orientation');
  }, [portrait, session]);

  if (fatal) {
    return (
      <main className="scene">
        <div className="panel">
          <div className="panel__content">
            <h2>Cannot start</h2>
            <p className="error" role="alert">
              {fatal}
            </p>
            <button type="button" className="btn" onClick={onAbandon}>
              Main menu
            </button>
          </div>
        </div>
      </main>
    );
  }

  const paused = state.phase === 'paused';

  return (
    <main className="battle" data-testid="battle" data-phase={state.phase}>
      <h1 className="visually-hidden">Battle</h1>
      <p className="visually-hidden" data-testid="battle-state">
        Battle status: {PHASE_LABEL[state.phase]}
      </p>
      <div
        ref={stageRef}
        className="battle__stage"
        role="application"
        aria-label="Battle arena. Use the keyboard or the on-screen buttons to sail and fire."
        aria-describedby={coarse ? undefined : 'battle-keys'}
      />
      {session && !portrait && (
        <>
          <Hud session={session} onPause={() => session.pause('manual')} />
          <BattleAnnouncer session={session} />
          {coarse ? (
            <TouchControls input={session.input} />
          ) : (
            <p className="key-legend" id="battle-keys">
              {KEY_BINDINGS.map((b) => (
                <span key={b.action}>
                  <kbd>{b.labels[0]}</kbd> {b.short}
                </span>
              ))}
            </p>
          )}
          {runtimeFlags.perfOverlay && <PerfOverlay session={session} />}
        </>
      )}
      {ended && (
        <div className="end-banner" role="status">
          {ended}
        </div>
      )}
      {portrait && (
        <div className="overlay-message" role="alert">
          <div className="panel">
            <div className="panel__content">
              <h2>Rotate your device</h2>
              <p>Pirate Battle is played in landscape. Turn your phone sideways to continue.</p>
            </div>
          </div>
        </div>
      )}
      {session && paused && !portrait && state.pauseReason && (
        <PauseDialog reason={state.pauseReason} onResume={() => session.resume()} onAbandon={onAbandon} />
      )}
    </main>
  );
}

const PHASE_LABEL: Record<string, string> = {
  initialising: 'preparing',
  running: 'in progress',
  paused: 'paused',
  ended: 'ended',
  destroyed: 'ended',
};

const noopSubscribe = () => () => undefined;
const INITIAL_STATE = { phase: 'initialising', pauseReason: null } as const;
const initialState = () => INITIAL_STATE;
