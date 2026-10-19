import { KEY_BINDINGS } from '@/game/input/InputController';

/** Keyboard controls generated from the actual bindings, plus touch notes. */
export function ControlsHelp({ compact = false }: { compact?: boolean }) {
  return (
    <div className="controls-help">
      <dl className="controls-list" aria-label="Keyboard controls">
        {KEY_BINDINGS.map((binding) => (
          <div key={binding.action} style={{ display: 'contents' }}>
            <dt>
              {binding.labels.map((label) => (
                <kbd key={label}>{label}</kbd>
              ))}
            </dt>
            <dd>{binding.description}</dd>
          </div>
        ))}
      </dl>
      {!compact && (
        <p className="hint">
          On touch screens, use the on-screen buttons: steering on the left, cannons on the right. Hold several at once
          to sail and fire together. Landscape orientation is required on phones.
        </p>
      )}
    </div>
  );
}
