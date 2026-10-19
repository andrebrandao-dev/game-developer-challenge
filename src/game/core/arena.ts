import type { ArenaConfig } from '@/config/gameConfig';
import type { RoundedRect } from './geometry';
import type { Vec2 } from './math';

export type IslandStyle = 'sand' | 'grass';

/** Island footprint in tile units. Rendering and collision both derive from it. */
export interface IslandDef {
  readonly id: string;
  readonly col: number;
  readonly row: number;
  readonly cols: number;
  readonly rows: number;
  readonly style: IslandStyle;
}

/** Purely visual props placed on islands (palms, rocks...). */
export interface DecorationDef {
  /** Tile number in the tilesheet (tile_N.png). */
  readonly tile: number;
  /** Position in tile units (fractional allowed). */
  readonly col: number;
  readonly row: number;
  readonly rotation?: number;
  readonly scale?: number;
}

export interface ArenaLayout {
  readonly islands: readonly IslandDef[];
  readonly decorations: readonly DecorationDef[];
  /** Player start in tile units. */
  readonly playerStart: { readonly col: number; readonly row: number; readonly heading: number };
}

export interface Island extends RoundedRect {
  readonly id: string;
  readonly def: IslandDef;
}

export interface Arena {
  readonly width: number;
  readonly height: number;
  readonly islands: readonly Island[];
  readonly playerStart: Vec2;
  readonly playerHeading: number;
  readonly layout: ArenaLayout;
}

/**
 * Transparent margin around the sand tiles and the visual corner rounding,
 * so collisions follow the drawn coastline rather than the tile grid.
 */
const COAST_INSET = 6;
const COAST_CORNER_RADIUS = 22;

export const DEFAULT_ARENA_LAYOUT: ArenaLayout = {
  islands: [
    { id: 'north-west', col: 3, row: 1, cols: 6, rows: 4, style: 'grass' },
    { id: 'north-east', col: 21, row: 1, cols: 5, rows: 3, style: 'grass' },
    { id: 'centre', col: 14, row: 6, cols: 3, rows: 3, style: 'sand' },
    { id: 'east-reef', col: 26, row: 7, cols: 2, rows: 2, style: 'sand' },
    { id: 'south-west', col: 6, row: 11, cols: 5, rows: 3, style: 'grass' },
    { id: 'south-east', col: 19, row: 11, cols: 7, rows: 4, style: 'grass' },
  ],
  decorations: [
    { tile: 71, col: 4.6, row: 2.2 },
    { tile: 70, col: 7.3, row: 3.4, rotation: 0.6 },
    { tile: 50, col: 6.1, row: 1.9 },
    { tile: 88, col: 5.3, row: 3.7 },
    { tile: 72, col: 22.4, row: 1.9 },
    { tile: 66, col: 24.1, row: 2.3 },
    { tile: 51, col: 15.0, row: 7.0, scale: 0.9 },
    { tile: 87, col: 14.6, row: 6.4 },
    { tile: 49, col: 26.5, row: 7.5, scale: 0.8 },
    { tile: 71, col: 7.4, row: 11.9 },
    { tile: 67, col: 9.2, row: 12.2 },
    { tile: 70, col: 20.5, row: 12.0, rotation: -0.4 },
    { tile: 71, col: 23.8, row: 12.6 },
    { tile: 65, col: 22.0, row: 13.2 },
    { tile: 88, col: 24.6, row: 11.8 },
  ],
  playerStart: { col: 8.5, row: 8.5, heading: 0 },
};

export function buildArena(config: ArenaConfig, layout: ArenaLayout = DEFAULT_ARENA_LAYOUT): Arena {
  const t = config.tileSize;
  const islands = layout.islands.map<Island>((def) => ({
    id: def.id,
    def,
    x: def.col * t + COAST_INSET,
    y: def.row * t + COAST_INSET,
    width: def.cols * t - COAST_INSET * 2,
    height: def.rows * t - COAST_INSET * 2,
    cornerRadius: COAST_CORNER_RADIUS,
  }));
  return {
    width: config.width,
    height: config.height,
    islands,
    playerStart: { x: layout.playerStart.col * t, y: layout.playerStart.row * t },
    playerHeading: layout.playerStart.heading,
    layout,
  };
}
