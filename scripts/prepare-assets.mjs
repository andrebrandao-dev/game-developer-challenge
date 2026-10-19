#!/usr/bin/env node
/**
 * Prepares runtime assets from the provided `assets/` pack into `public/game/`.
 *
 * - Converts the Starling/Sparrow XML ship atlas into the JSON hash format
 *   PixiJS loads natively.
 * - Generates a JSON atlas for the 64×64 tile grid (1× and 2×).
 * - Copies the UI atlases, individual UI PNGs (used by the React menus),
 *   sounds and the menu background.
 *
 * Runs automatically before `dev` and `build`, so a clean checkout only
 * needs Node. The output folder is git-ignored and fully reproducible.
 */
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'assets');
const out = join(root, 'public', 'game');

const TILE_COLUMNS = 16;
const TILE_ROWS = 6;

async function copyDir(from, to, filter = () => true) {
  await mkdir(to, { recursive: true });
  for (const entry of await readdir(from, { withFileTypes: true })) {
    const a = join(from, entry.name);
    const b = join(to, entry.name);
    if (entry.isDirectory()) await copyDir(a, b, filter);
    else if (filter(entry.name)) await copyFile(a, b);
  }
}

/** Parses `<SubTexture name=".." x=".." .../>` entries into a Pixi JSON hash. */
function starlingToPixi(xml, image, scale) {
  const frames = {};
  const re = /<SubTexture\s+([^>]+?)\/>/g;
  const attr = (s, name) => {
    const m = new RegExp(`${name}="([^"]*)"`).exec(s);
    return m ? m[1] : undefined;
  };
  for (const match of xml.matchAll(re)) {
    const body = match[1];
    const name = attr(body, 'name').replace(/\.png$/, '');
    const x = Number(attr(body, 'x'));
    const y = Number(attr(body, 'y'));
    const w = Number(attr(body, 'width'));
    const h = Number(attr(body, 'height'));
    frames[name] = {
      frame: { x, y, w, h },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w, h },
      sourceSize: { w, h },
    };
  }
  return { frames, meta: { image, format: 'RGBA8888', scale: String(scale) } };
}

function tileAtlas(image, scale) {
  const size = 64 * scale;
  const frames = {};
  for (let row = 0; row < TILE_ROWS; row++) {
    for (let col = 0; col < TILE_COLUMNS; col++) {
      const n = row * TILE_COLUMNS + col + 1;
      frames[`tile_${n}`] = {
        frame: { x: col * size, y: row * size, w: size, h: size },
        rotated: false,
        trimmed: false,
        spriteSourceSize: { x: 0, y: 0, w: size, h: size },
        sourceSize: { w: size, h: size },
      };
    }
  }
  return { frames, meta: { image, format: 'RGBA8888', scale: String(scale) } };
}

/** The UI atlas is already in Pixi's format; strip editor-only fields. */
function cleanUiAtlas(json) {
  const frames = {};
  for (const [name, frame] of Object.entries(json.frames)) {
    const rest = { ...frame };
    delete rest.ui;
    frames[name] = rest;
  }
  return { frames, meta: { image: json.meta.image, format: json.meta.format, scale: json.meta.scale } };
}

async function main() {
  await rm(out, { recursive: true, force: true });
  await mkdir(join(out, 'atlases'), { recursive: true });

  // Ships & misc: the "retina" sheet in the pack has the same resolution as the 1× one, so only 1× is used.
  const shipsXml = await readFile(join(src, 'spritesheet', 'ships_miscellaneous_sheet.xml'), 'utf8');
  await writeFile(join(out, 'atlases', 'ships.json'), JSON.stringify(starlingToPixi(shipsXml, 'ships.png', 1)));
  await copyFile(join(src, 'spritesheet', 'ships_miscellaneous_sheet.png'), join(out, 'atlases', 'ships.png'));

  // Tiles (1× and 2×).
  await writeFile(join(out, 'atlases', 'tiles.json'), JSON.stringify(tileAtlas('tiles.png', 1)));
  await writeFile(join(out, 'atlases', 'tiles@2x.json'), JSON.stringify(tileAtlas('tiles@2x.png', 2)));
  await copyFile(join(src, 'tilesheet', 'tiles_sheet.png'), join(out, 'atlases', 'tiles.png'));
  await copyFile(join(src, 'tilesheet', 'tiles_sheet_retina.png'), join(out, 'atlases', 'tiles@2x.png'));

  // UI atlas (1× and 2×), used by Pixi for in-world health bars.
  for (const [file, outName, image] of [
    ['ui_sheet.json', 'ui.json', 'ui.png'],
    ['ui_sheet_retina.json', 'ui@2x.json', 'ui@2x.png'],
  ]) {
    const json = JSON.parse(await readFile(join(src, 'spritesheet', file), 'utf8'));
    const cleaned = cleanUiAtlas(json);
    cleaned.meta.image = image;
    await writeFile(join(out, 'atlases', outName), JSON.stringify(cleaned));
  }
  await copyFile(join(src, 'spritesheet', 'ui_sheet.png'), join(out, 'atlases', 'ui.png'));
  await copyFile(join(src, 'spritesheet', 'ui_sheet_retina.png'), join(out, 'atlases', 'ui@2x.png'));

  // Individual UI PNGs for the React interface (CSS backgrounds with image-set).
  await copyDir(join(src, 'png', 'default', 'ui'), join(out, 'ui', '1x'));
  await copyDir(join(src, 'png', 'retina', 'ui'), join(out, 'ui', '2x'));

  await copyDir(join(src, 'sounds'), join(out, 'sounds'), (name) => name.endsWith('.wav'));
  await copyFile(join(src, 'ui_scene_background.png'), join(out, 'ui', 'scene_background.png'));
  await copyFile(join(src, 'logo_jungle_gaming.svg'), join(out, 'ui', 'logo_jungle_gaming.svg'));
  // Player ship emblem used in the main menu.
  await copyFile(join(src, 'png', 'default', 'ships', 'ship_2.png'), join(out, 'ui', '1x', 'ship_player.png'));
  await copyFile(join(src, 'png', 'retina', 'ships', 'ship_2.png'), join(out, 'ui', '2x', 'ship_player.png'));

  console.log(`[prepare-assets] runtime assets written to ${out}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
