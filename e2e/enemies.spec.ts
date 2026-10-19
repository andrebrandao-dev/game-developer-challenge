import { expect, test } from './fixtures';

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

test.describe('Enemies', () => {
  test('chaser pursues, rams the player, explodes and does not score', async ({ game }) => {
    await game.open();
    await game.startBattle();
    const s0 = await game.state();
    const id = await game.spawn('chaser', s0.player.x - 320, s0.player.y + 40);

    await game.advance(500);
    const s1 = await game.state();
    const chaser = s1.enemies.find((e) => e.id === id);
    expect(chaser).toBeDefined();
    expect(dist(chaser ?? s1.player, s1.player)).toBeLessThan(dist({ x: s0.player.x - 320, y: s0.player.y + 40 }, s0.player));

    await game.advance(2500);
    const s2 = await game.state();
    expect(s2.enemies.find((e) => e.id === id)).toBeUndefined();
    expect(s2.player.health).toBe(85);
    expect(s2.score).toBe(0);
    expect(s2.kills.chaser).toBe(0);
  });

  test('shooter approaches and fires once within range', async ({ game }) => {
    await game.open();
    await game.startBattle();
    const s0 = await game.state();
    // Open water to the west of the start position, outside attack range.
    const spawnAt = { x: 60, y: s0.player.y + 40 };
    const id = await game.spawn('shooter', spawnAt.x, spawnAt.y);

    let fired = false;
    let closest = Infinity;
    for (let i = 0; i < 24 && !fired; i++) {
      await game.advance(250);
      const s = await game.state();
      const shooter = s.enemies.find((e) => e.id === id);
      if (shooter) closest = Math.min(closest, dist(shooter, s.player));
      fired = s.projectiles.some((p) => p.faction === 'enemy');
    }
    expect(fired).toBe(true);
    expect(closest).toBeLessThan(dist(spawnAt, s0.player));
  });

  test('enemies spawn on the configured interval and both kinds appear', async ({ game }) => {
    await game.open();
    await game.setOptions(120, 2);
    await game.startBattle();
    // First spawn after 1.5 s, then every 2 s: 1.5, 3.5, 5.5, 7.5.
    await game.advance(1400);
    expect((await game.state()).spawned).toEqual({ chaser: 0, shooter: 0 });
    await game.advance(200);
    let s = await game.state();
    expect(s.spawned.chaser + s.spawned.shooter).toBe(1);
    await game.advance(2000);
    s = await game.state();
    expect(s.spawned.chaser + s.spawned.shooter).toBe(2);
    await game.advance(4000);
    s = await game.state();
    expect(s.spawned.chaser + s.spawned.shooter).toBe(4);
    expect(s.spawned.chaser).toBeGreaterThan(0);
    expect(s.spawned.shooter).toBeGreaterThan(0);
  });
});
