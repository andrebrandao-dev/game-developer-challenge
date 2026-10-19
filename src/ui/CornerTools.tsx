import { useQueryClient } from '@tanstack/react-query';
import { useId, useState, useSyncExternalStore } from 'react';
import { useOutbox } from '@/api/pendingRecords';
import { audio } from '@/game/audio/AudioManager';
import { mockScenario } from '@/mocks/db';
import { resetNetworkState, selectScenario } from '@/mocks/browser';
import { SCENARIOS } from '@/mocks/scenarios';
import { Modal } from './Modal';

function NetworkLab({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState(mockScenario.current.id);
  const [status, setStatus] = useState('');
  const outbox = useOutbox();
  const groupId = useId();

  return (
    <Modal title="Network lab" onDismiss={onClose} testId="network-lab" wide>
      <p className="muted" style={{ margin: 0 }}>
        The ranking and history APIs are simulated in the browser (MSW). Pick a scenario to reproduce network conditions
        and failures. The choice is kept after a refresh.
      </p>
      <fieldset style={{ border: 0, margin: 0, padding: 0, width: '100%' }}>
        <legend id={groupId} className="visually-hidden">
          Network scenario
        </legend>
        <div
          role="radiogroup"
          aria-labelledby={groupId}
          style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 8, textAlign: 'left' }}
        >
          {SCENARIOS.map((s) => (
            <label key={s.id} className="chip-btn" style={{ display: 'flex', gap: 8, alignItems: 'flex-start', borderRadius: 10 }}>
              <input
                type="radio"
                name="scenario"
                value={s.id}
                checked={selected === s.id}
                onChange={() => {
                  setSelected(s.id);
                  selectScenario(s.id);
                  setStatus(`Scenario: ${s.label}.`);
                }}
              />
              <span>
                <strong>{s.label}</strong>
                <br />
                <span className="hint">{s.description}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <p className="hint" style={{ margin: 0 }}>
        Records waiting to be saved on this device: {outbox.pending.length}
      </p>
      <p className="status" role="status">
        {status}
      </p>
      <div className="btn-row">
        <button
          type="button"
          className="btn btn--small btn--secondary"
          onClick={() => {
            resetNetworkState(queryClient);
            setSelected(mockScenario.current.id);
            setStatus('Mock data and scenario restored to the initial state.');
          }}
        >
          Reset mocks
        </button>
        <button type="button" className="btn btn--small" onClick={onClose} autoFocus>
          Close
        </button>
      </div>
    </Modal>
  );
}

/** Sound toggle and the network scenario lab (top-right corner of menus). */
export function CornerTools() {
  const muted = useSyncExternalStore(
    (cb) => audio.subscribe(cb),
    () => audio.muted,
  );
  const [lab, setLab] = useState(false);

  return (
    <>
      <div className="corner-tools">
        <button type="button" className="chip-btn" aria-pressed={!muted} onClick={() => audio.setMuted(!muted)}>
          Sound: {muted ? 'Off' : 'On'}
        </button>
        <button type="button" className="chip-btn" onClick={() => setLab(true)} data-testid="open-network-lab">
          Network lab
        </button>
      </div>
      {lab && <NetworkLab onClose={() => setLab(false)} />}
    </>
  );
}
