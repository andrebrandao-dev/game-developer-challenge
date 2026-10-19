/**
 * "Contain" fit of the fixed-size arena into the screen: the whole arena is
 * always visible, proportions are preserved and the remainder is letterboxed.
 * All values are in CSS pixels; device pixel density is handled by Pixi's
 * `resolution` + `autoDensity`, so gameplay never sees physical pixels.
 */
export interface Viewport {
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly screenWidth: number;
  readonly screenHeight: number;
}

export function computeViewport(screenWidth: number, screenHeight: number, worldWidth: number, worldHeight: number): Viewport {
  const scale = Math.max(0.01, Math.min(screenWidth / worldWidth, screenHeight / worldHeight));
  return {
    scale,
    offsetX: (screenWidth - worldWidth * scale) / 2,
    offsetY: (screenHeight - worldHeight * scale) / 2,
    screenWidth,
    screenHeight,
  };
}

export const screenToWorld = (vp: Viewport, x: number, y: number): { x: number; y: number } => ({
  x: (x - vp.offsetX) / vp.scale,
  y: (y - vp.offsetY) / vp.scale,
});

export const worldToScreen = (vp: Viewport, x: number, y: number): { x: number; y: number } => ({
  x: x * vp.scale + vp.offsetX,
  y: y * vp.scale + vp.offsetY,
});
