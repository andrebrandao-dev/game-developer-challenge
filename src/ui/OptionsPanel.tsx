import { useId, useState, type SyntheticEvent } from 'react';
import { OPTION_LIMITS, validateOption, type OptionKey } from '@/config/options';
import { saveOptions, saveProfileName, useOptions, useProfile, validateName, NAME_LIMITS } from '@/app/preferences';
import { audio } from '@/game/audio/AudioManager';

interface OptionsPanelProps {
  onClose: () => void;
  closeLabel?: string;
  /** Shown when the panel is opened during a match. */
  inMatch?: boolean;
}

const FIELDS: { key: OptionKey; label: string }[] = [
  { key: 'sessionDurationSec', label: 'Game session time' },
  { key: 'spawnIntervalSec', label: 'Enemy spawn time' },
];

type Draft = Record<OptionKey, string>;

const toDraft = (values: Record<OptionKey, number>): Draft => ({
  sessionDurationSec: String(values.sessionDurationSec),
  spawnIntervalSec: String(values.spawnIntervalSec),
});

const parse = (text: string): number => (text.trim() === '' ? Number.NaN : Number(text));

/**
 * Options form. Values are validated on every change, saved explicitly and
 * persisted in localStorage. A running match keeps its own config snapshot.
 */
export function OptionsPanel({ onClose, closeLabel = 'Main menu', inMatch = false }: OptionsPanelProps) {
  const saved = useOptions();
  const profile = useProfile();
  const [draft, setDraft] = useState<Draft>(() => toDraft(saved));
  const [name, setName] = useState(profile.name);
  const [status, setStatus] = useState('');
  const baseId = useId();

  const errors = Object.fromEntries(
    FIELDS.map(({ key }) => [key, validateOption(key, parse(draft[key]))]),
  ) as Record<OptionKey, string | null>;
  const nameError = validateName(name);
  const hasErrors = Object.values(errors).some(Boolean) || nameError !== null;
  const dirty =
    FIELDS.some(({ key }) => parse(draft[key]) !== saved[key]) || name.trim() !== profile.name;

  const update = (key: OptionKey, value: string) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setStatus('');
  };

  const stepBy = (key: OptionKey, direction: 1 | -1) => {
    const { min, max, step } = OPTION_LIMITS[key];
    const current = parse(draft[key]);
    const base = Number.isFinite(current) ? current : saved[key];
    // Snap to the step grid, then clamp to the limits.
    const snapped = Math.round((base - min) / step) * step + min;
    const next = Math.min(max, Math.max(min, snapped + direction * step));
    update(key, String(Number(next.toFixed(2))));
    audio.play('ui_click', 0.5);
  };

  const submit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (hasErrors) return;
    const okOptions = saveOptions({
      sessionDurationSec: parse(draft.sessionDurationSec),
      spawnIntervalSec: parse(draft.spawnIntervalSec),
    });
    const okName = saveProfileName(name);
    setStatus(okOptions && okName ? (inMatch ? 'Saved. Changes apply to your next battle.' : 'Options saved.') : 'Could not save options.');
    audio.play('ui_open', 0.5);
  };

  const restoreDefaults = () => {
    setDraft({
      sessionDurationSec: String(OPTION_LIMITS.sessionDurationSec.default),
      spawnIntervalSec: String(OPTION_LIMITS.spawnIntervalSec.default),
    });
    setStatus('');
  };

  return (
    <form className="stack" onSubmit={submit} noValidate aria-label="Options" data-testid="options-form">
      {FIELDS.map(({ key, label }) => {
        const { min, max, step } = OPTION_LIMITS[key];
        const id = `${baseId}-${key}`;
        const error = errors[key];
        const value = parse(draft[key]);
        return (
          <div className="field" key={key}>
            <label htmlFor={id}>{label}</label>
            <div className="stepper">
              <button
                type="button"
                className="round-btn icon-minus"
                aria-label={`Decrease ${label.toLowerCase()}`}
                onClick={() => stepBy(key, -1)}
                disabled={Number.isFinite(value) && value <= min}
              />
              <input
                id={id}
                name={key}
                type="number"
                inputMode="decimal"
                min={min}
                max={max}
                step={step}
                value={draft[key]}
                onChange={(e) => update(key, e.target.value)}
                aria-invalid={error ? true : undefined}
                aria-describedby={`${id}-hint${error ? ` ${id}-error` : ''}`}
              />
              <button
                type="button"
                className="round-btn icon-plus"
                aria-label={`Increase ${label.toLowerCase()}`}
                onClick={() => stepBy(key, 1)}
                disabled={Number.isFinite(value) && value >= max}
              />
            </div>
            <span id={`${id}-hint`} className="hint">
              {min}–{max} seconds, steps of {step}
            </span>
            {error && (
              <p id={`${id}-error`} className="error" role="alert">
                {error}
              </p>
            )}
          </div>
        );
      })}

      <div className="field">
        <label htmlFor={`${baseId}-name`}>Captain name</label>
        <input
          id={`${baseId}-name`}
          className="text-input"
          name="captainName"
          value={name}
          maxLength={NAME_LIMITS.max + 5}
          autoComplete="nickname"
          onChange={(e) => {
            setName(e.target.value);
            setStatus('');
          }}
          aria-invalid={nameError ? true : undefined}
          aria-describedby={nameError ? `${baseId}-name-error` : undefined}
        />
        {nameError && (
          <p id={`${baseId}-name-error`} className="error" role="alert">
            {nameError}
          </p>
        )}
      </div>

      <p className="status" role="status">
        {status}
      </p>

      <div className="btn-row">
        <button type="submit" className="btn btn--small" disabled={hasErrors || !dirty}>
          Save
        </button>
        <button type="button" className="btn btn--small btn--secondary" onClick={restoreDefaults}>
          Defaults
        </button>
      </div>
      <button
        type="button"
        className="btn"
        onClick={() => {
          audio.play('ui_back', 0.5);
          onClose();
        }}
      >
        {closeLabel}
      </button>
    </form>
  );
}
