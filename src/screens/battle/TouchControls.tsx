import { useState, type PointerEvent } from 'react';
import type { GameAction, InputController } from '@/game/input/InputController';

interface PadButton {
  action: GameAction;
  label: string;
  icon: string;
  slot: 'slot-top' | 'slot-left' | 'slot-right';
}

const STEERING: PadButton[] = [
  { action: 'forward', label: 'Sail forward', icon: 'icon-forward', slot: 'slot-top' },
  { action: 'turnLeft', label: 'Turn left', icon: 'icon-turn-left', slot: 'slot-left' },
  { action: 'turnRight', label: 'Turn right', icon: 'icon-turn-right', slot: 'slot-right' },
];

const CANNONS: PadButton[] = [
  { action: 'fireFront', label: 'Fire bow cannon', icon: 'icon-fire-front', slot: 'slot-top' },
  { action: 'fireLeft', label: 'Fire port broadside', icon: 'icon-fire-left', slot: 'slot-left' },
  { action: 'fireRight', label: 'Fire starboard broadside', icon: 'icon-fire-right', slot: 'slot-right' },
];

/**
 * On-screen controls for touch devices. Each button tracks its own pointer
 * (pointer capture), so several can be held at once with multi-touch.
 */
export function TouchControls({ input }: { input: InputController }) {
  const [pressed, setPressed] = useState<ReadonlySet<GameAction>>(new Set());

  const set = (action: GameAction, down: boolean) => {
    input.setTouch(action, down);
    setPressed((prev) => {
      const next = new Set(prev);
      if (down) next.add(action);
      else next.delete(action);
      return next;
    });
  };

  const handlers = (action: GameAction) => ({
    onPointerDown: (e: PointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      set(action, true);
    },
    onPointerUp: () => set(action, false),
    onPointerCancel: () => set(action, false),
    onLostPointerCapture: () => set(action, false),
    onContextMenu: (e: { preventDefault: () => void }) => e.preventDefault(),
  });

  const pad = (buttons: PadButton[], label: string) => (
    <div className="touch-pad" role="group" aria-label={label}>
      {buttons.map((b) => (
        <button
          key={b.action}
          type="button"
          className={`round-btn ${b.icon} ${b.slot}`}
          aria-label={b.label}
          data-pressed={pressed.has(b.action)}
          data-testid={`touch-${b.action}`}
          {...handlers(b.action)}
        />
      ))}
    </div>
  );

  return (
    <div className="touch-controls" data-testid="touch-controls">
      {pad(STEERING, 'Steering')}
      {pad(CANNONS, 'Cannons')}
    </div>
  );
}
