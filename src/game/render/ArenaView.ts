import { Container, Graphics, Sprite, TilingSprite } from 'pixi.js';
import type { Arena, IslandDef } from '../core/arena';
import { texture, type GameTextures } from '../assets/gameAssets';

const WATER_TILE = 'tile_73';
/** Tile numbers of the 9-slice blocks in the tilesheet. */
const SAND_BLOCK = [
  [1, 2, 3],
  [17, 18, 19],
  [33, 34, 35],
] as const;
const GRASS_BLOCK = [
  [6, 7, 8, 9],
  [22, 23, 24, 25],
  [38, 39, 40, 41],
  [54, 55, 56, 57],
] as const;
const SHALLOW_BLOCK = [
  [10, 11, 12],
  [26, 27, 28],
  [42, 43, 44],
] as const;

/** Water extends past the arena so letterboxed screens never show a void. */
const WATER_OVERSCAN = 1600;

/** Maps an index along an island edge to a column/row of a 9-slice block. */
function sliceIndex(i: number, n: number, blockSize: number): number {
  if (i === 0) return 0;
  if (i === n - 1) return blockSize - 1;
  // Alternate the middle tiles (4-wide blocks have two variants).
  return blockSize === 4 ? 1 + ((i - 1) % 2) : 1;
}

/** Static arena: water, shallows, islands and decorations. */
export class ArenaView extends Container {
  private readonly water: TilingSprite;
  private readonly statics: Container;

  constructor(arena: Arena, textures: GameTextures) {
    super({ label: 'arena' });
    const t = 64;

    this.water = new TilingSprite({
      texture: texture(textures.tiles, WATER_TILE),
      x: -WATER_OVERSCAN,
      y: -WATER_OVERSCAN,
      width: arena.width + WATER_OVERSCAN * 2,
      height: arena.height + WATER_OVERSCAN * 2,
    });
    this.addChild(this.water);

    this.statics = new Container({ label: 'arena-statics' });
    for (const island of arena.layout.islands) this.addShallows(island, textures, t);
    for (const island of arena.layout.islands) this.addIsland(island, textures, t);
    for (const deco of arena.layout.decorations) {
      const sprite = new Sprite({
        texture: texture(textures.tiles, `tile_${deco.tile}`),
        anchor: 0.5,
        x: deco.col * t,
        y: deco.row * t,
        rotation: deco.rotation ?? 0,
        scale: deco.scale ?? 1,
      });
      this.statics.addChild(sprite);
    }

    this.addChild(this.statics);
    // Islands never change during a match: render them once into a texture.
    // Only arena-sized content is cached; the overscan water/shading is not
    // (a cached texture that large would exhaust GPU memory at 2× density).
    this.statics.cacheAsTexture(true);

    // Shade everything outside the playable arena and outline its border.
    const outside = new Graphics()
      .rect(-WATER_OVERSCAN, -WATER_OVERSCAN, arena.width + WATER_OVERSCAN * 2, arena.height + WATER_OVERSCAN * 2)
      .fill({ color: 0x06202e, alpha: 0.55 })
      .rect(0, 0, arena.width, arena.height)
      .cut()
      .rect(0, 0, arena.width, arena.height)
      .stroke({ color: 0xffffff, alpha: 0.18, width: 3 });
    this.addChild(outside);
  }

  private addIsland(def: IslandDef, textures: GameTextures, t: number): void {
    const block = def.style === 'grass' ? GRASS_BLOCK : SAND_BLOCK;
    const size = block.length;
    for (let r = 0; r < def.rows; r++) {
      const row = block[sliceIndex(r, def.rows, size)];
      for (let c = 0; c < def.cols; c++) {
        const tile = row?.[sliceIndex(c, def.cols, size)];
        if (tile === undefined) continue;
        this.statics.addChild(
          new Sprite({ texture: texture(textures.tiles, `tile_${tile}`), x: (def.col + c) * t, y: (def.row + r) * t }),
        );
      }
    }
  }

  /**
   * Light-water skirt one tile wide around each island. The inner part is
   * drawn too, so the transparent coast margins of the sand tiles blend into
   * shallow water rather than deep water.
   */
  private addShallows(def: IslandDef, textures: GameTextures, t: number): void {
    const cols = def.cols + 2;
    const rows = def.rows + 2;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const tile = SHALLOW_BLOCK[sliceIndex(r, rows, 3)]?.[sliceIndex(c, cols, 3)];
        if (tile === undefined) continue;
        this.statics.addChild(
          new Sprite({
            texture: texture(textures.tiles, `tile_${tile}`),
            x: (def.col - 1 + c) * t,
            y: (def.row - 1 + r) * t,
            alpha: 0.9,
          }),
        );
      }
    }
  }

  /** Slow drift of the water texture, driven by the effect clock. */
  update(timeSec: number): void {
    this.water.tilePosition.x = Math.sin(timeSec * 0.25) * 12;
    this.water.tilePosition.y = timeSec * 6;
  }

  override destroy(): void {
    this.statics.cacheAsTexture(false);
    // Textures belong to the shared atlases: never destroy them here.
    super.destroy({ children: true, texture: false, textureSource: false });
  }
}
