import { useEffect, useRef, useState } from 'react';
import type { GameSession, HudView, SessionState } from '@/game/GameSession';

const TIME_MILESTONES = [60, 30, 10];
const HEALTH_MILESTONES = [0.5, 0.25];

/**
 * Screen-reader announcements for the match. Only meaningful changes are
 * announced (score, health milestones, time milestones, pause/end), never
 * per-frame values.
 */
export function BattleAnnouncer({ session }: { session: GameSession }) {
  const [message, setMessage] = useState('');
  const previous = useRef<{ hud: HudView; state: SessionState } | null>(null);

  useEffect(() => {
    previous.current = { hud: session.hud.get(), state: session.state.get() };

    const check = () => {
      const prev = previous.current;
      const hud = session.hud.get();
      const state = session.state.get();
      previous.current = { hud, state };
      if (!prev) return;

      const parts: string[] = [];
      if (state.phase !== prev.state.phase) {
        if (state.phase === 'running' && prev.state.phase === 'initialising') parts.push('Battle started.');
        if (state.phase === 'paused') parts.push('Game paused.');
        if (state.phase === 'running' && prev.state.phase === 'paused') parts.push('Game resumed.');
      }
      if (hud.score > prev.hud.score) parts.push(`Enemy sunk. Score ${hud.score}.`);
      for (const milestone of HEALTH_MILESTONES) {
        const limit = milestone * hud.maxHealth;
        if (prev.hud.health > limit && hud.health <= limit && hud.health > 0) parts.push(`Health ${hud.health} of ${hud.maxHealth}.`);
      }
      for (const seconds of TIME_MILESTONES) {
        if (prev.hud.secondsRemaining > seconds && hud.secondsRemaining <= seconds) parts.push(`${seconds} seconds remaining.`);
      }
      if (parts.length > 0) setMessage(parts.join(' '));
    };

    const unsubscribeHud = session.hud.subscribe(check);
    const unsubscribeState = session.state.subscribe(check);
    return () => {
      unsubscribeHud();
      unsubscribeState();
    };
  }, [session]);

  return (
    <div className="visually-hidden" role="status" aria-live="polite" aria-atomic="true" data-testid="battle-announcer">
      {message}
    </div>
  );
}
