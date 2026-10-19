import { Container, Graphics, Sprite, type Renderer, type Texture } from 'pixi.js';
import { Rng } from '../core/rng';
import { texture, type GameTextures } from '../assets/gameAssets';

/** One pooled, tweened sprite. All effects are combinations of these. */
interface Particle {
  sprite: Sprite;
  age: number;
  life: number;
  delay: number;
  vx: number;
  vy: number;
  spin: number;
  scaleFrom: number;
  scaleTo: number;
  alphaFrom: number;
  alphaTo: number;
  /** Optional flip-book frames spread evenly over the lifetime. */
  frames: readonly Texture[] | null;
}

type ParticleInit = Partial<Omit<Particle, 'sprite' | 'age'>> & {
  texture: Texture;
  x: number;
  y: number;
  life: number;
  rotation?: number;
  tint?: number;
};

const MAX_PARTICLES = 900;

/**
 * Lightweight particle/effect system with sprite pooling. Driven by the
 * effect clock (frozen while paused, stepped manually in tests). Visual
 * randomness uses a seeded RNG so screenshots are reproducible.
 */
export class EffectsLayer {
  /** Below ships (wakes, wrecks). */
  readonly under = new Container({ label: 'fx-under' });
  /** Above ships (explosions, smoke, splashes). */
  readonly over = new Container({ label: 'fx-over' });

  private readonly active: Particle[] = [];
  private readonly pool: Sprite[] = [];
  private readonly rng: Rng;
  private readonly generated: Texture[] = [];
  private readonly dot: Texture;
  private readonly ring: Texture;
  private readonly explosionFrames: readonly Texture[];
  private readonly woodFrames: readonly Texture[];
  private readonly fireBig: Texture;

  constructor(renderer: Renderer, textures: GameTextures, seed: number) {
    this.rng = new Rng(seed ^ 0x5eed);
    this.dot = this.generate(renderer, new Graphics().circle(16, 16, 16).fill(0xffffff));
    this.ring = this.generate(renderer, new Graphics().circle(34, 34, 30).stroke({ color: 0xffffff, width: 5 }));
    this.explosionFrames = ['explosion_1', 'explosion_2', 'explosion_3'].map((n) => texture(textures.ships, n));
    this.woodFrames = ['wood_1', 'wood_2', 'wood_3', 'wood_4'].map((n) => texture(textures.ships, n));
    this.fireBig = texture(textures.ships, 'fire_1');
  }

  private generate(renderer: Renderer, g: Graphics): Texture {
    const tex = renderer.generateTexture({ target: g, resolution: 2, antialias: true });
    g.destroy();
    this.generated.push(tex);
    return tex;
  }

  get count(): number {
    return this.active.length;
  }

  private emit(layer: Container, init: ParticleInit): void {
    if (this.active.length >= MAX_PARTICLES) return;
    const sprite = this.pool.pop() ?? new Sprite({ anchor: 0.5 });
    sprite.texture = init.texture;
    sprite.position.set(init.x, init.y);
    sprite.rotation = init.rotation ?? 0;
    sprite.tint = init.tint ?? 0xffffff;
    sprite.visible = (init.delay ?? 0) <= 0;
    const scaleFrom = init.scaleFrom ?? 1;
    const alphaFrom = init.alphaFrom ?? 1;
    sprite.scale.set(scaleFrom);
    sprite.alpha = alphaFrom;
    layer.addChild(sprite);
    this.active.push({
      sprite,
      age: 0,
      life: init.life,
      delay: init.delay ?? 0,
      vx: init.vx ?? 0,
      vy: init.vy ?? 0,
      spin: init.spin ?? 0,
      scaleFrom,
      scaleTo: init.scaleTo ?? scaleFrom,
      alphaFrom,
      alphaTo: init.alphaTo ?? 0,
      frames: init.frames ?? null,
    });
  }

  update(dt: number): void {
    if (dt <= 0) return;
    for (let i = this.active.length - 1; i >= 0; i--) {
      const p = this.active[i];
      if (!p) continue;
      if (p.delay > 0) {
        p.delay -= dt;
        if (p.delay > 0) continue;
        p.sprite.visible = true;
      }
      p.age += dt;
      const t = Math.min(1, p.age / p.life);
      if (t >= 1) {
        this.release(i);
        continue;
      }
      const s = p.sprite;
      s.x += p.vx * dt;
      s.y += p.vy * dt;
      s.rotation += p.spin * dt;
      s.scale.set(p.scaleFrom + (p.scaleTo - p.scaleFrom) * t);
      s.alpha = p.alphaFrom + (p.alphaTo - p.alphaFrom) * t;
      if (p.frames) {
        const frame = p.frames[Math.min(p.frames.length - 1, Math.floor(t * p.frames.length))];
        if (frame) s.texture = frame;
      }
    }
  }

  private release(index: number): void {
    const p = this.active[index];
    const last = this.active.pop();
    if (!p || !last) return;
    if (index < this.active.length) this.active[index] = last;
    p.sprite.removeFromParent();
    this.pool.push(p.sprite);
  }

  // ---------------------------------------------------------------- effects

  muzzle(x: number, y: number, angle: number): void {
    const fx = Math.cos(angle);
    const fy = Math.sin(angle);
    this.emit(this.over, {
      texture: this.explosionFrames[2] ?? this.dot,
      x,
      y,
      life: 0.1,
      rotation: angle,
      scaleFrom: 0.45,
      scaleTo: 0.25,
      alphaFrom: 1,
    });
    for (let i = 0; i < 3; i++) {
      const speed = 40 + this.rng.range(0, 40);
      this.emit(this.over, {
        texture: this.dot,
        x: x + fx * 6,
        y: y + fy * 6,
        life: 0.5 + this.rng.range(0, 0.25),
        vx: fx * speed + this.rng.range(-15, 15),
        vy: fy * speed + this.rng.range(-15, 15),
        tint: 0xe8e4dc,
        scaleFrom: 0.35,
        scaleTo: 0.9 + this.rng.range(0, 0.3),
        alphaFrom: 0.7,
      });
    }
  }

  splash(x: number, y: number): void {
    this.emit(this.under, { texture: this.ring, x, y, life: 0.55, scaleFrom: 0.15, scaleTo: 0.7, alphaFrom: 0.85 });
    for (let i = 0; i < 4; i++) {
      const a = this.rng.range(0, Math.PI * 2);
      const speed = this.rng.range(30, 70);
      this.emit(this.over, {
        texture: this.dot,
        x,
        y,
        life: 0.35,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        scaleFrom: 0.22,
        scaleTo: 0.08,
        alphaFrom: 0.9,
      });
    }
  }

  dust(x: number, y: number): void {
    for (let i = 0; i < 3; i++) {
      this.emit(this.over, {
        texture: this.dot,
        x: x + this.rng.range(-6, 6),
        y: y + this.rng.range(-6, 6),
        life: 0.45,
        tint: 0xe9cf9b,
        scaleFrom: 0.3,
        scaleTo: 0.8,
        alphaFrom: 0.8,
      });
    }
  }

  impact(x: number, y: number): void {
    this.emit(this.over, {
      texture: this.explosionFrames[2] ?? this.dot,
      x,
      y,
      life: 0.2,
      scaleFrom: 0.35,
      scaleTo: 0.6,
      alphaFrom: 1,
    });
    this.debris(x, y, 3, 90);
  }

  private debris(x: number, y: number, count: number, speed: number): void {
    for (let i = 0; i < count; i++) {
      const a = this.rng.range(0, Math.PI * 2);
      const v = this.rng.range(speed * 0.4, speed);
      this.emit(this.over, {
        texture: this.rng.pick(this.woodFrames),
        x,
        y,
        life: 0.7 + this.rng.range(0, 0.3),
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        spin: this.rng.range(-8, 8),
        rotation: a,
        scaleFrom: 0.7,
        scaleTo: 0.5,
        alphaFrom: 1,
      });
    }
  }

  explosion(x: number, y: number, size = 1): void {
    this.emit(this.over, {
      texture: this.explosionFrames[0] ?? this.dot,
      frames: this.explosionFrames,
      x,
      y,
      life: 0.55,
      scaleFrom: 0.5 * size,
      scaleTo: 1.35 * size,
      alphaFrom: 1,
      alphaTo: 0.2,
    });
    for (let i = 0; i < 2; i++) {
      this.emit(this.over, {
        texture: this.explosionFrames[1] ?? this.dot,
        frames: this.explosionFrames.slice(1),
        x: x + this.rng.range(-22, 22) * size,
        y: y + this.rng.range(-22, 22) * size,
        life: 0.45,
        delay: 0.08 + i * 0.1,
        scaleFrom: 0.4 * size,
        scaleTo: 0.9 * size,
        alphaFrom: 1,
      });
    }
    this.debris(x, y, 6, 160 * size);
    this.splash(x, y);
  }

  /** Sinking hulk left behind by a destroyed ship. */
  wreck(x: number, y: number, angle: number, hull: Texture): void {
    this.emit(this.under, {
      texture: hull,
      x,
      y,
      life: 2.2,
      rotation: angle - Math.PI / 2,
      spin: this.rng.range(-0.25, 0.25),
      scaleFrom: 1,
      scaleTo: 0.78,
      alphaFrom: 1,
    });
    this.emit(this.under, {
      texture: this.fireBig,
      x,
      y: y - 6,
      life: 1.1,
      scaleFrom: 1.1,
      scaleTo: 0.4,
      alphaFrom: 1,
    });
  }

  wake(x: number, y: number, strength: number): void {
    this.emit(this.under, {
      texture: this.dot,
      x,
      y,
      life: 1,
      scaleFrom: 0.35,
      scaleTo: 0.9,
      alphaFrom: 0.28 * strength,
    });
  }

  /** Drops every active particle (used on restart). */
  clear(): void {
    while (this.active.length > 0) this.release(this.active.length - 1);
  }

  destroy(): void {
    this.clear();
    for (const sprite of this.pool) sprite.destroy();
    this.pool.length = 0;
    for (const tex of this.generated) tex.destroy(true);
    this.under.destroy({ children: true });
    this.over.destroy({ children: true });
  }
}
