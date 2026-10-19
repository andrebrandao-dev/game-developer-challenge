import { useState } from 'react';
import { useOutbox } from '@/api/pendingRecords';
import { useLastResult } from '@/app/matches';
import type { LogTab } from '@/app/router';
import { audio } from '@/game/audio/AudioManager';
import { KEY_BINDINGS } from '@/game/input/InputController';
import { ControlsHelp } from '@/ui/ControlsHelp';
import { Modal } from '@/ui/Modal';
import { formatClock } from '@/lib/format';

interface MainMenuProps {
  onPlay: () => void;
  onOptions: () => void;
  onLog: (tab: LogTab) => void;
}

export function MainMenu({ onPlay, onOptions, onLog }: MainMenuProps) {
  const [showControls, setShowControls] = useState(false);
  const last = useLastResult();
  const outbox = useOutbox();
  const waiting = outbox.pending.length;

  return (
    <main className="scene">
      <div className="panel" data-testid="main-menu">
        <div className="panel__content">
          <h1 className="visually-hidden">Pirate Battle</h1>
          <img
            className="title-art"
            src="/game/ui/1x/menu/title_pirate_battle.png"
            srcSet="/game/ui/1x/menu/title_pirate_battle.png 1x, /game/ui/2x/menu/title_pirate_battle.png 2x"
            width={384}
            height={128}
            alt=""
          />
          <p className="tagline">Set sail. Take command.</p>

          <button type="button" className="btn" onClick={onPlay}>
            Play
          </button>
          <button type="button" className="btn" onClick={onOptions}>
            Options
          </button>

          <img
            className="menu-emblem"
            src="/game/ui/1x/ship_player.png"
            srcSet="/game/ui/1x/ship_player.png 1x, /game/ui/2x/ship_player.png 2x"
            width={46}
            height={79}
            alt=""
          />
          <p className="muted" style={{ margin: 0 }}>
            Navigate the islands. Survive the battle.
          </p>
          <p className="hint menu-keys" data-testid="menu-controls">
            {KEY_BINDINGS.map((b, i) => (
              <span key={b.action}>
                {i > 0 && ' · '}
                <kbd>{b.labels[0]}</kbd> {b.short}
              </span>
            ))}
            <br />
            On touch screens, use the on-screen buttons (landscape).
          </p>

          <nav className="btn-row" aria-label="Captain's log">
            <button type="button" className="btn btn--small btn--secondary" onClick={() => onLog('ranking')}>
              Ranking
            </button>
            <button type="button" className="btn btn--small btn--secondary" onClick={() => onLog('history')}>
              Match history
            </button>
          </nav>

          <button
            type="button"
            className="btn btn--tiny btn--secondary"
            onClick={() => {
              audio.play('ui_open', 0.5);
              setShowControls(true);
            }}
          >
            Controls
          </button>

          {last && (
            <p className="last-battle" data-testid="last-battle">
              Last battle: {last.record.score} points · {formatClock(last.record.durationMs / 1000)} ·{' '}
              {last.record.endReason === 'time_up' ? 'time up' : 'sunk'}
            </p>
          )}
          {waiting > 0 && (
            <p className="last-battle" role="status">
              {waiting} {waiting === 1 ? 'battle' : 'battles'} waiting to be saved.
            </p>
          )}
        </div>
      </div>

      {showControls && (
        <Modal title="Controls" onDismiss={() => setShowControls(false)} testId="controls-dialog">
          <ControlsHelp />
          <button type="button" className="btn" onClick={() => setShowControls(false)} autoFocus>
            Close
          </button>
        </Modal>
      )}
    </main>
  );
}
