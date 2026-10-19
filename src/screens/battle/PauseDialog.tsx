import { useState } from 'react';
import type { PauseReason } from '@/game/GameSession';
import { ControlsHelp } from '@/ui/ControlsHelp';
import { Modal } from '@/ui/Modal';
import { OptionsPanel } from '@/ui/OptionsPanel';

const REASON_TEXT: Record<PauseReason, string> = {
  manual: 'Ready when you are.',
  'focus-lost': 'Paused because the game window lost focus.',
  hidden: 'Paused because the tab was hidden.',
  orientation: 'Paused while the device was in portrait.',
};

interface PauseDialogProps {
  reason: PauseReason;
  onResume: () => void;
  onAbandon: () => void;
}

type View = 'menu' | 'options' | 'controls' | 'confirm-exit';

/** Modal pause menu. Resuming always requires an explicit action. */
export function PauseDialog({ reason, onResume, onAbandon }: PauseDialogProps) {
  const [view, setView] = useState<View>('menu');

  if (view === 'options') {
    return (
      <Modal title="Options" onDismiss={() => setView('menu')} testId="pause-options">
        <OptionsPanel inMatch closeLabel="Back" onClose={() => setView('menu')} />
      </Modal>
    );
  }

  if (view === 'controls') {
    return (
      <Modal title="Controls" onDismiss={() => setView('menu')} testId="pause-controls">
        <ControlsHelp />
        <button type="button" className="btn" onClick={() => setView('menu')} autoFocus>
          Back
        </button>
      </Modal>
    );
  }

  if (view === 'confirm-exit') {
    return (
      <Modal title="Abandon battle?" onDismiss={() => setView('menu')} testId="confirm-exit">
        <p>This battle will end now and will not be recorded in the ranking or your history.</p>
        <div className="stack">
          <button type="button" className="btn" onClick={() => setView('menu')} autoFocus>
            Keep fighting
          </button>
          <button type="button" className="btn btn--secondary" onClick={onAbandon}>
            Abandon
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Paused" onDismiss={onResume} testId="pause-dialog">
      <p className="muted">{REASON_TEXT[reason]}</p>
      <div className="stack pause-actions">
        <button type="button" className="btn" onClick={onResume} autoFocus>
          Resume
        </button>
        <button type="button" className="btn" onClick={() => setView('options')}>
          Options
        </button>
        <button type="button" className="btn btn--small btn--secondary" onClick={() => setView('controls')}>
          Controls
        </button>
        <button type="button" className="btn" onClick={() => setView('confirm-exit')}>
          Main menu
        </button>
      </div>
    </Modal>
  );
}
