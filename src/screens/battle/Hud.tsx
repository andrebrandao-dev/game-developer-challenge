import { useSyncExternalStore } from 'react';
import type { GameSession } from '@/game/GameSession';
import { formatClock } from '@/lib/format';


const WARNING_SECONDS = 10;

/**
 * Top bar: health, score, time and pause. Subscribed to the session's HUD
 * store, which only changes when a displayed value changes (≈1/s for time).
 */
export function Hud({ session, onPause }: { session: GameSession; onPause: () => void }) {
  const hud = useSyncExternalStore(session.hud.subscribe, session.hud.get);
  const ratio = hud.maxHealth > 0 ? hud.health / hud.maxHealth : 0;
  const level = ratio > 0.6 ? 'high' : ratio > 0.3 ? 'mid' : 'low';
  const warning = hud.secondsRemaining <= WARNING_SECONDS;

  return (
    <header className="hud" aria-label="Battle status">
      <div className="hud__group">
        <div
          className="health"
          role="meter"
          aria-label="Ship health"
          aria-valuemin={0}
          aria-valuemax={hud.maxHealth}
          aria-valuenow={hud.health}
          aria-valuetext={`${hud.health} of ${hud.maxHealth}`}
          data-testid="hud-health"
        >
          <span className="health__icon" aria-hidden="true" />
          <span className="health__bar">
            <span className="health__fill" data-level={level} style={{ ['--ratio' as string]: ratio }} />
            <span className="health__label" aria-hidden="true">
              {hud.health} / {hud.maxHealth}
            </span>
          </span>
        </div>
      </div>

      <div className="hud__group">
        <div className="counter counter--score" data-testid="hud-score">
          <span className="counter__icon" aria-hidden="true" />
          <span className="visually-hidden">Score </span>
          <span>{hud.score}</span>
        </div>
        <div
          className={warning ? 'counter counter--time counter--warning' : 'counter counter--time'}
          role="timer"
          aria-live="off"
          data-testid="hud-time"
        >
          <span className="counter__icon" aria-hidden="true" />
          <span className="visually-hidden">Time remaining </span>
          <span>{formatClock(hud.secondsRemaining)}</span>
        </div>
        <button type="button" className="round-btn icon-pause" aria-label="Pause" onClick={onPause} data-testid="pause-button" />
      </div>
    </header>
  );
}
