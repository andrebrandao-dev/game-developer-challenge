import type { ControlIntent } from '../core/types';

export type GameAction = 'forward' | 'turnLeft' | 'turnRight' | 'fireFront' | 'fireLeft' | 'fireRight';
export type SystemAction = 'pause';

export interface KeyBinding {
  readonly action: GameAction | SystemAction;
  readonly codes: readonly string[];
  /** Human readable key names, for the controls help. */
  readonly labels: readonly string[];
  readonly description: string;
  /** One-word label for the in-battle legend. */
  readonly short: string;
}

/** Physical key codes (layout independent) for every action. */
export const KEY_BINDINGS: readonly KeyBinding[] = [
  { action: 'forward', codes: ['KeyW', 'ArrowUp'], labels: ['W', '↑'], description: 'Sail forward', short: 'Sail' },
  { action: 'turnLeft', codes: ['KeyA', 'ArrowLeft'], labels: ['A', '←'], description: 'Turn left', short: 'Left' },
  { action: 'turnRight', codes: ['KeyD', 'ArrowRight'], labels: ['D', '→'], description: 'Turn right', short: 'Right' },
  { action: 'fireFront', codes: ['Space', 'KeyK'], labels: ['Space', 'K'], description: 'Fire bow cannon', short: 'Bow cannon' },
  { action: 'fireLeft', codes: ['KeyQ', 'KeyJ'], labels: ['Q', 'J'], description: 'Port broadside (left)', short: 'Port' },
  { action: 'fireRight', codes: ['KeyE', 'KeyL'], labels: ['E', 'L'], description: 'Starboard broadside (right)', short: 'Starboard' },
  { action: 'pause', codes: ['Escape', 'KeyP'], labels: ['Esc', 'P'], description: 'Pause', short: 'Pause' },
];

const CODE_TO_ACTION = new Map<string, GameAction | SystemAction>(
  KEY_BINDINGS.flatMap((b) => b.codes.map((code) => [code, b.action] as const)),
);

/** Sources that can hold an action down at the same time. */
type Source = 'keyboard' | 'touch';

/**
 * Aggregates held actions from keyboard and touch into a ControlIntent.
 * Multiple sources and multiple actions can be held simultaneously, so the
 * player can move, turn and fire at the same time.
 */
export class InputController {
  private readonly held: Record<Source, Set<GameAction>> = { keyboard: new Set(), touch: new Set() };
  private keyboardTarget: Window | null = null;
  private enabled = false;
  private onPause: (() => void) | null = null;

  /** Starts listening to the keyboard. `onPause` is called for pause keys. */
  attachKeyboard(target: Window, onPause: () => void): void {
    this.detachKeyboard();
    this.keyboardTarget = target;
    this.onPause = onPause;
    target.addEventListener('keydown', this.handleKeyDown);
    target.addEventListener('keyup', this.handleKeyUp);
  }

  detachKeyboard(): void {
    if (!this.keyboardTarget) return;
    this.keyboardTarget.removeEventListener('keydown', this.handleKeyDown);
    this.keyboardTarget.removeEventListener('keyup', this.handleKeyUp);
    this.keyboardTarget = null;
    this.onPause = null;
  }

  /**
   * Keys are only captured while gameplay is active (not paused, no dialog).
   * Disabling also releases everything that was held.
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.reset();
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /** Releases all held actions (on pause, resume, blur...). */
  reset(): void {
    this.held.keyboard.clear();
    this.held.touch.clear();
  }

  /** Used by the on-screen touch controls. */
  setTouch(action: GameAction, pressed: boolean): void {
    if (!this.enabled) return;
    if (pressed) this.held.touch.add(action);
    else this.held.touch.delete(action);
  }

  isHeld(action: GameAction): boolean {
    return this.held.keyboard.has(action) || this.held.touch.has(action);
  }

  intent(): ControlIntent {
    const left = this.isHeld('turnLeft');
    const right = this.isHeld('turnRight');
    return {
      forward: this.isHeld('forward'),
      turn: left === right ? 0 : left ? -1 : 1,
      fireFront: this.isHeld('fireFront'),
      fireLeft: this.isHeld('fireLeft'),
      fireRight: this.isHeld('fireRight'),
    };
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (!this.enabled || isTypingTarget(event.target)) return;
    const action = CODE_TO_ACTION.get(event.code);
    if (!action) return;
    // Game keys must not scroll the page or activate focused buttons.
    event.preventDefault();
    if (action === 'pause') {
      if (!event.repeat) this.onPause?.();
      return;
    }
    this.held.keyboard.add(action);
  };

  private readonly handleKeyUp = (event: KeyboardEvent): void => {
    const action = CODE_TO_ACTION.get(event.code);
    if (!action || action === 'pause') return;
    this.held.keyboard.delete(action);
  };
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}
