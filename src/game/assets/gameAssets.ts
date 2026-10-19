import { Assets, Rectangle, Texture, type Spritesheet } from 'pixi.js';
import type { ShipKind } from '@/config/gameConfig';

const BASE = `${import.meta.env.BASE_URL}game/atlases/`;
const BUNDLE = 'match';

export interface GameTextures {
  readonly ships: Spritesheet;
  readonly tiles: Spritesheet;
  readonly ui: Spritesheet;
}

export class AssetLoadError extends Error {
  constructor(cause: unknown) {
    super('Could not load the game assets.', { cause });
    this.name = 'AssetLoadError';
  }
}

let registered = false;
let loaded: GameTextures | null = null;

/** High-DPI screens get the 2× tile and UI atlases (ships only ship at 1×). */
function densitySuffix(): string {
  return typeof window !== 'undefined' && window.devicePixelRatio >= 1.5 ? '@2x' : '';
}

function register(): void {
  if (registered) return;
  const suffix = densitySuffix();
  Assets.addBundle(BUNDLE, [
    { alias: 'ships', src: `${BASE}ships.json` },
    { alias: 'tiles', src: `${BASE}tiles${suffix}.json` },
    { alias: 'ui', src: `${BASE}ui${suffix}.json` },
  ]);
  registered = true;
}

/**
 * Loads (once) and returns the textures needed by a match. Textures are cached
 * by Pixi's Assets and reused by every subsequent match. Failed requests are
 * evicted from the cache, so calling this again performs a real retry.
 */
export async function loadGameAssets(onProgress?: (progress: number) => void): Promise<GameTextures> {
  if (loaded) {
    onProgress?.(1);
    return loaded;
  }
  register();
  try {
    const bundle = (await Assets.loadBundle(BUNDLE, onProgress)) as Record<'ships' | 'tiles' | 'ui', Spritesheet>;
    loaded = { ships: bundle.ships, tiles: bundle.tiles, ui: bundle.ui };
    return loaded;
  } catch (error) {
    // Drop any partially loaded entries so the retry starts clean.
    await Assets.unloadBundle(BUNDLE).catch(() => undefined);
    throw new AssetLoadError(error);
  }
}

export const areGameAssetsLoaded = (): boolean => loaded !== null;

export function texture(sheet: Spritesheet, name: string): Texture {
  const tex = sheet.textures[name];
  if (!tex) throw new Error(`Missing texture "${name}"`);
  return tex;
}

/** Ship colour per kind: [intact, damaged, heavily damaged, wreck] sprite numbers. */
const SHIP_SPRITES: Record<ShipKind, readonly [number, number, number, number]> = {
  player: [2, 8, 14, 20], // black / skull
  chaser: [3, 9, 15, 21], // red / cross
  shooter: [5, 11, 17, 23], // blue / horse
};

export interface ShipTextureSet {
  readonly intact: Texture;
  readonly damaged: Texture;
  readonly critical: Texture;
  readonly wreck: Texture;
}

export function shipTextures(textures: GameTextures, kind: ShipKind): ShipTextureSet {
  const [a, b, c, d] = SHIP_SPRITES[kind];
  return {
    intact: texture(textures.ships, `ship_${a}`),
    damaged: texture(textures.ships, `ship_${b}`),
    critical: texture(textures.ships, `ship_${c}`),
    wreck: texture(textures.ships, `ship_${d}`),
  };
}

/**
 * Horizontal clip of a bar fill texture (e.g. health), cached per pixel width.
 * Follows the atlas metadata: clip axis x, origin left, inside `fill_rect`.
 */
export class BarFillTextures {
  private readonly cache = new Map<number, Texture>();

  constructor(
    private readonly base: Texture,
    private readonly fillX: number,
    private readonly fillWidth: number,
  ) {}

  get(ratio: number): Texture {
    const r = Math.min(1, Math.max(0, ratio));
    const width = r <= 0 ? 0 : Math.round(this.fillX + this.fillWidth * r);
    let tex = this.cache.get(width);
    if (!tex) {
      const { frame } = this.base;
      tex =
        width === 0
          ? Texture.EMPTY
          : new Texture({
              source: this.base.source,
              frame: new Rectangle(frame.x, frame.y, Math.min(width, frame.width), frame.height),
            });
      this.cache.set(width, tex);
    }
    return tex;
  }

  destroy(): void {
    for (const tex of this.cache.values()) if (tex !== Texture.EMPTY) tex.destroy(false);
    this.cache.clear();
  }
}

/** Fill rects from ui_sheet.json `ui.layout.fill_rect` (logical units). */
export const HEALTH_BAR_LAYOUT = {
  player: { frame: 'health_frame', fillX: 30, fillWidth: 196 },
  enemy: { frame: 'enemy_health_frame', fillX: 24, fillWidth: 112 },
} as const;
