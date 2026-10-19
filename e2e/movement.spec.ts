import { expect, test } from './fixtures';

test.describe('Movement', () => {
  test('starts a match, moves forward and rotates both ways @mobile', async ({ game, isMobile }) => {
    test.skip(isMobile, 'Keyboard flow; touch is covered in touch.spec.ts');
    await game.open();
    await game.startBattle();
    const start = await game.state();
    expect(start).toMatchObject({ time: 0, score: 0, status: 'running' });
    expect(start.player.health).toBe(100);

    await game.hold(['KeyW'], 1000);
    const moved = await game.state();
    expect(moved.player.x).toBeGreaterThan(start.player.x + 60);
    expect(moved.player.y).toBeCloseTo(start.player.y, 3);

    await game.hold(['KeyD'], 500);
    const right = await game.state();
    expect(right.player.angle).toBeGreaterThan(moved.player.angle + 1);

    await game.hold(['ArrowLeft'], 1000);
    const left = await game.state();
    expect(left.player.angle).toBeLessThan(right.player.angle - 2);

    // Moving and turning at the same time.
    await game.hold(['ArrowUp', 'ArrowRight'], 500);
    const both = await game.state();
    expect(both.player.angle).toBeGreaterThan(left.player.angle);
    expect(Math.hypot(both.player.x - left.player.x, both.player.y - left.player.y)).toBeGreaterThan(20);
  });

  test('keeps the ship inside the arena', async ({ game }) => {
    await game.open();
    await game.startBattle();
    // Turn around (heading π) and sail into the west edge through open water.
    await game.hold(['KeyA'], (Math.PI / 2.6) * 1000);
    await game.hold(['KeyW'], 6000);
    const s = await game.state();
    // Hull capsule: bow sample at x >= hull radius, so the centre stays >= 24 + 28.
    expect(s.player.x).toBeGreaterThanOrEqual(52 - 0.5);
    expect(s.player.x).toBeLessThan(90);
    expect(s.player.y).toBeGreaterThan(0);
    expect(s.player.y).toBeLessThan(s.arena.height);
  });

  test('cannot sail through islands', async ({ game }) => {
    await game.open();
    await game.startBattle();
    const s0 = await game.state();
    const centre = s0.arena.islands.find((i) => i.id === 'centre');
    expect(centre).toBeDefined();
    if (!centre) return;
    // The start position faces the centre island straight ahead (east).
    expect(s0.player.y).toBeGreaterThan(centre.y);
    expect(s0.player.y).toBeLessThan(centre.y + centre.height);

    await game.hold(['KeyW'], 6000);
    const s = await game.state();
    // Bow (centre + half length + hull radius) stays at the coastline.
    expect(s.player.x + 28 + 24).toBeLessThanOrEqual(centre.x + 2);
    expect(s.player.speed).toBeLessThan(60);
  });
});
