import { useEffect, useState } from 'react';
import type { GameSession } from '@/game/GameSession';

/** Opt-in (?perf=1) frame-time readout, refreshed twice per second. */
export function PerfOverlay({ session }: { session: GameSession }) {
  const [text, setText] = useState('');

  useEffect(() => {
    const id = window.setInterval(() => {
      const s = session.frameStats.summary();
      const r = session.renderStats();
      setText(
        `${s.avgFps.toFixed(0)} fps · p95 ${s.p95FrameMs.toFixed(1)} ms · cpu ${s.avgWorkMs.toFixed(1)} ms · ships ${r?.ships ?? 0} · shots ${r?.projectiles ?? 0} · fx ${r?.particles ?? 0}`,
      );
    }, 500);
    return () => window.clearInterval(id);
  }, [session]);

  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute',
        left: 12,
        bottom: 12,
        padding: '4px 8px',
        borderRadius: 6,
        background: 'rgba(0,0,0,0.6)',
        font: '12px ui-monospace, monospace',
        color: '#9be29b',
        pointerEvents: 'none',
      }}
    >
      {text}
    </div>
  );
}
