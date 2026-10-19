import { Container, Sprite } from 'pixi.js';
import type { ShipKind } from '@/config/gameConfig';
import { BarFillTextures, HEALTH_BAR_LAYOUT, texture, type GameTextures, type ShipTextureSet } from '../assets/gameAssets';

/** Health ratio thresholds for the deterioration sprites. */
const DAMAGED_BELOW = 0.67;
const CRITICAL_BELOW = 0.34;
const HIT_FLASH_SEC = 0.14;
const SPAWN_FADE_SEC = 0.45;

/** Shared, per-renderer resources for health bars. */
export interface BarResources {
  readonly playerFrame: Sprite['texture'];
  readonly enemyFrame: Sprite['texture'];
  readonly playerFills: { green: BarFillTextures; amber: BarFillTextures; red: BarFillTextures };
  readonly enemyFill: BarFillTextures;
}

export function createBarResources(textures: GameTextures): BarResources {
  const { player, enemy } = HEALTH_BAR_LAYOUT;
  const fill = (name: string, layout: { fillX: number; fillWidth: number }) =>
    new BarFillTextures(texture(textures.ui, name), layout.fillX, layout.fillWidth);
  return {
    playerFrame: texture(textures.ui, player.frame),
    enemyFrame: texture(textures.ui, enemy.frame),
    playerFills: {
      green: fill('health_fill_green', player),
      amber: fill('health_fill_amber', player),
      red: fill('health_fill_red', player),
    },
    enemyFill: fill('enemy_health_fill_red', enemy),
  };
}

export function destroyBarResources(bars: BarResources): void {
  bars.playerFills.green.destroy();
  bars.playerFills.amber.destroy();
  bars.playerFills.red.destroy();
  bars.enemyFill.destroy();
}

class HealthBar extends Container {
  private readonly fill: Sprite;
  private ratio = -1;

  constructor(
    private readonly isPlayer: boolean,
    private readonly bars: BarResources,
  ) {
    super({ label: 'health-bar' });
    const frame = new Sprite(isPlayer ? bars.playerFrame : bars.enemyFrame);
    this.fill = new Sprite();
    this.addChild(frame, this.fill);
    // Centre the bar horizontally above the ship.
    this.pivot.set(frame.width / 2, frame.height / 2);
    this.scale.set(isPlayer ? 0.36 : 0.5);
  }

  set(ratio: number): void {
    const quantised = Math.round(ratio * 200) / 200;
    if (quantised === this.ratio) return;
    this.ratio = quantised;
    if (this.isPlayer) {
      const fills = this.bars.playerFills;
      const set = quantised > 0.6 ? fills.green : quantised > 0.3 ? fills.amber : fills.red;
      this.fill.texture = set.get(quantised);
    } else {
      this.fill.texture = this.bars.enemyFill.get(quantised);
    }
  }
}

/** Visual representation of one ship. Holds no gameplay state. */
export class ShipView extends Container {
  readonly kind: ShipKind;
  private readonly body = new Container({ label: 'ship-body' });
  private readonly hull: Sprite;
  private readonly fires: Sprite[];
  private readonly bar: HealthBar;
  private readonly sprites: ShipTextureSet;
  private flashTimer = 0;
  private age = 0;

  constructor(kind: ShipKind, sprites: ShipTextureSet, textures: GameTextures, bars: BarResources) {
    super({ label: `ship-${kind}` });
    this.kind = kind;
    this.sprites = sprites;
    this.hull = new Sprite({ texture: sprites.intact, anchor: 0.5 });
    this.fires = [
      new Sprite({ texture: texture(textures.ships, 'fire_1'), anchor: { x: 0.5, y: 0.9 }, x: 10, y: -14, visible: false }),
      new Sprite({ texture: texture(textures.ships, 'fire_2'), anchor: { x: 0.5, y: 0.9 }, x: -12, y: 18, visible: false }),
    ];
    this.body.addChild(this.hull, ...this.fires);
    this.bar = new HealthBar(kind === 'player', bars);
    this.bar.y = -78;
    this.addChild(this.body, this.bar);
    this.alpha = kind === 'player' ? 1 : 0;
  }

  /** Called when the simulation reports damage on this ship. */
  flash(): void {
    this.flashTimer = HIT_FLASH_SEC;
  }

  update(x: number, y: number, angle: number, healthRatio: number, fxDt: number, fxTime: number): void {
    this.position.set(x, y);
    // Sprites face down (+y); simulation heading 0 faces +x.
    this.body.rotation = angle - Math.PI / 2;
    this.bar.set(healthRatio);

    this.hull.texture =
      healthRatio < CRITICAL_BELOW ? this.sprites.critical : healthRatio < DAMAGED_BELOW ? this.sprites.damaged : this.sprites.intact;

    const [big, small] = this.fires;
    if (big && small) {
      small.visible = healthRatio < DAMAGED_BELOW;
      big.visible = healthRatio < CRITICAL_BELOW;
      const flicker = 0.9 + Math.sin(fxTime * 22 + this.uid) * 0.12;
      big.scale.set(flicker, 1.05 - (flicker - 0.9));
      small.scale.set(1.05 - (flicker - 0.9), flicker);
    }

    this.age += fxDt;
    if (this.kind !== 'player') this.alpha = Math.min(1, this.age / SPAWN_FADE_SEC);

    this.flashTimer = Math.max(0, this.flashTimer - fxDt);
    this.hull.tint = this.flashTimer > 0 ? 0xff8a7a : 0xffffff;
  }

  get wreckTexture(): Sprite['texture'] {
    return this.sprites.wreck;
  }

  override destroy(): void {
    super.destroy({ children: true, texture: false, textureSource: false });
  }
}
