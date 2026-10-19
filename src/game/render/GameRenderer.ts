import { Container, Sprite, Texture, type Renderer } from 'pixi.js';
import type { ShipKind } from '@/config/gameConfig';
import { lerp, lerpAngle } from '../core/math';
import type { GameEvent, Projectile, Ship } from '../core/types';
import type { World } from '../core/world';
import { shipTextures, texture, type GameTextures, type ShipTextureSet } from '../assets/gameAssets';
import { ArenaView } from './ArenaView';
import { EffectsLayer } from './EffectsLayer';
import { createBarResources, destroyBarResources, ShipView, type BarResources } from './ShipView';
import { computeViewport, type Viewport } from './viewport';

const WAKE_INTERVAL_SEC = 0.07;
const TRAIL_LENGTH = 46;
const SHAKE_DECAY = 7;

interface ProjectileView {
  ball: Sprite;
  trail: Sprite;
}

function createTrailTexture(): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 4;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const gradient = ctx.createLinearGradient(0, 0, 64, 0);
    gradient.addColorStop(0, 'rgba(255,255,255,0)');
    gradient.addColorStop(1, 'rgba(255,255,255,0.85)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 4);
  }
  return Texture.from(canvas);
}

export interface RenderStats {
  ships: number;
  projectiles: number;
  particles: number;
}

/**
 * Pixi view of a match. Reads the simulation world (never writes it), keeps
 * one display object per entity id and turns simulation events into effects.
 */
export class GameRenderer {
  readonly root = new Container({ label: 'game-root' });
  private readonly scene = new Container({ label: 'scene' });
  private readonly arenaView: ArenaView;
  private readonly shipLayer = new Container({ label: 'ships' });
  private readonly projectileLayer = new Container({ label: 'projectiles' });
  private readonly effects: EffectsLayer;
  private readonly bars: BarResources;
  private readonly shipSets: Record<ShipKind, ShipTextureSet>;
  private readonly ballTexture: Texture;
  private readonly trailTexture: Texture;

  private readonly shipViews = new Map<number, ShipView>();
  private readonly projectileViews = new Map<number, ProjectileView>();
  private readonly projectilePool: ProjectileView[] = [];
  private wakeTimer = 0;
  private shake = 0;
  private fxTime = 0;
  private viewport: Viewport;

  constructor(
    renderer: Renderer,
    private readonly textures: GameTextures,
    private readonly world: World,
  ) {
    this.arenaView = new ArenaView(world.arena, textures);
    this.effects = new EffectsLayer(renderer, textures, world.seed);
    this.bars = createBarResources(textures);
    this.shipSets = {
      player: shipTextures(textures, 'player'),
      chaser: shipTextures(textures, 'chaser'),
      shooter: shipTextures(textures, 'shooter'),
    };
    this.ballTexture = texture(textures.ships, 'cannon_ball');
    this.trailTexture = createTrailTexture();

    this.scene.addChild(this.arenaView, this.effects.under, this.shipLayer, this.projectileLayer, this.effects.over);
    this.root.addChild(this.scene);
    this.viewport = computeViewport(world.arena.width, world.arena.height, world.arena.width, world.arena.height);
  }

  get currentViewport(): Viewport {
    return this.viewport;
  }

  resize(screenWidth: number, screenHeight: number): void {
    this.viewport = computeViewport(screenWidth, screenHeight, this.world.arena.width, this.world.arena.height);
    this.scene.scale.set(this.viewport.scale);
    this.applyCamera();
  }

  private applyCamera(): void {
    const amplitude = this.shake * 9;
    const sx = amplitude ? Math.sin(this.fxTime * 91) * amplitude : 0;
    const sy = amplitude ? Math.cos(this.fxTime * 77) * amplitude : 0;
    this.scene.position.set(this.viewport.offsetX + sx * this.viewport.scale, this.viewport.offsetY + sy * this.viewport.scale);
  }

  /**
   * @param alpha interpolation factor between the previous and current step
   * @param fxDt  effect clock delta (0 while paused)
   */
  render(events: readonly GameEvent[], alpha: number, fxDt: number): void {
    this.fxTime += fxDt;
    for (const event of events) this.handleEvent(event);

    this.syncShips(alpha, fxDt);
    this.syncProjectiles(alpha);
    this.spawnWakes(fxDt);
    this.effects.update(fxDt);
    this.arenaView.update(this.fxTime);

    this.shake = Math.max(0, this.shake - this.shake * SHAKE_DECAY * fxDt - 0.02 * fxDt);
    this.applyCamera();
  }

  stats(): RenderStats {
    return { ships: this.shipViews.size, projectiles: this.projectileViews.size, particles: this.effects.count };
  }

  private handleEvent(event: GameEvent): void {
    switch (event.type) {
      case 'shotFired': {
        if (event.count === 1) {
          this.effects.muzzle(event.x, event.y, event.angle);
        } else {
          const ship = this.world.ships.find((s) => s.id === event.shipId);
          const fx = ship ? Math.cos(ship.angle) : 0;
          const fy = ship ? Math.sin(ship.angle) : 0;
          const spacing = this.world.config.player.broadside.spacing;
          for (let i = 0; i < event.count; i++) {
            const along = (i - (event.count - 1) / 2) * spacing;
            this.effects.muzzle(event.x + fx * along, event.y + fy * along, event.angle);
          }
        }
        break;
      }
      case 'shipHit': {
        this.shipViews.get(event.shipId)?.flash();
        if (event.kind === 'player') this.shake = Math.min(1, this.shake + 0.5);
        break;
      }
      case 'projectileExpired':
        if (event.on === 'water') this.effects.splash(event.x, event.y);
        else if (event.on === 'island') this.effects.dust(event.x, event.y);
        else if (event.on === 'ship') this.effects.impact(event.x, event.y);
        break;
      case 'shipDestroyed': {
        const view = this.shipViews.get(event.shipId);
        this.effects.wreck(event.x, event.y, event.angle, view?.wreckTexture ?? this.shipSets[event.kind].wreck);
        this.effects.explosion(event.x, event.y, event.kind === 'player' ? 1.3 : 1);
        if (view) {
          this.shipViews.delete(event.shipId);
          view.destroy();
        }
        if (event.kind === 'player') this.shake = 1;
        break;
      }
      case 'shipRammed':
        this.effects.explosion(event.x, event.y, 0.8);
        this.shake = Math.min(1, this.shake + 0.7);
        break;
      case 'shipSpawned':
        this.effects.splash(event.x, event.y);
        break;
      case 'collision':
      case 'scoreChanged':
      case 'matchStarted':
      case 'matchEnded':
        break;
    }
  }

  private syncShips(alpha: number, fxDt: number): void {
    const seen = new Set<number>();
    for (const ship of this.world.ships) {
      if (!ship.alive) continue;
      seen.add(ship.id);
      let view = this.shipViews.get(ship.id);
      if (!view) {
        view = new ShipView(ship.kind, this.shipSets[ship.kind], this.textures, this.bars);
        this.shipViews.set(ship.id, view);
        this.shipLayer.addChild(view);
      }
      const x = lerp(ship.prevPos.x, ship.pos.x, alpha);
      const y = lerp(ship.prevPos.y, ship.pos.y, alpha);
      view.update(x, y, lerpAngle(ship.prevAngle, ship.angle, alpha), ship.health / ship.stats.maxHealth, fxDt, this.fxTime);
    }
    for (const [id, view] of this.shipViews) {
      if (seen.has(id)) continue;
      this.shipViews.delete(id);
      view.destroy();
    }
  }

  private syncProjectiles(alpha: number): void {
    const seen = new Set<number>();
    for (const p of this.world.projectiles) {
      seen.add(p.id);
      let view = this.projectileViews.get(p.id);
      if (!view) {
        view = this.acquireProjectile();
        this.projectileViews.set(p.id, view);
      }
      this.placeProjectile(view, p, alpha);
    }
    for (const [id, view] of this.projectileViews) {
      if (seen.has(id)) continue;
      this.projectileViews.delete(id);
      view.ball.removeFromParent();
      view.trail.removeFromParent();
      this.projectilePool.push(view);
    }
  }

  private acquireProjectile(): ProjectileView {
    const view =
      this.projectilePool.pop() ??
      ({
        ball: new Sprite({ texture: this.ballTexture, anchor: 0.5 }),
        trail: new Sprite({ texture: this.trailTexture, anchor: { x: 1, y: 0.5 } }),
      } satisfies ProjectileView);
    this.projectileLayer.addChild(view.trail, view.ball);
    return view;
  }

  private placeProjectile(view: ProjectileView, p: Projectile, alpha: number): void {
    const x = lerp(p.prevPos.x, p.pos.x, alpha);
    const y = lerp(p.prevPos.y, p.pos.y, alpha);
    view.ball.position.set(x, y);
    const length = Math.min(TRAIL_LENGTH, p.travelled + 1);
    view.trail.position.set(x, y);
    view.trail.rotation = Math.atan2(p.vel.y, p.vel.x);
    view.trail.width = length;
    view.trail.height = 3;
    view.trail.alpha = p.faction === 'enemy' ? 0.55 : 0.8;
  }

  private spawnWakes(fxDt: number): void {
    this.wakeTimer -= fxDt;
    if (this.wakeTimer > 0) return;
    this.wakeTimer = WAKE_INTERVAL_SEC;
    for (const ship of this.world.ships) {
      if (!ship.alive || ship.speed < 25) continue;
      this.wakeFor(ship);
    }
  }

  private wakeFor(ship: Ship): void {
    const back = ship.stats.hullHalfLength + 8;
    const x = ship.pos.x - Math.cos(ship.angle) * back;
    const y = ship.pos.y - Math.sin(ship.angle) * back;
    this.effects.wake(x, y, Math.min(1, ship.speed / ship.stats.maxSpeed));
  }

  destroy(): void {
    for (const view of this.shipViews.values()) view.destroy();
    this.shipViews.clear();
    for (const view of [...this.projectileViews.values(), ...this.projectilePool]) {
      view.ball.destroy();
      view.trail.destroy();
    }
    this.projectileViews.clear();
    this.projectilePool.length = 0;
    this.effects.destroy();
    destroyBarResources(this.bars);
    this.arenaView.destroy();
    this.trailTexture.destroy(true);
    this.root.destroy({ children: true, texture: false, textureSource: false });
  }
}
