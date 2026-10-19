import { expect, test, type GameDriver } from './fixtures';

/** Collects projectile ids fired by the player over `ms`, sampling every step. */
async function collectPlayerShots(game: GameDriver, ms: number): Promise<{ ids: Set<number>; perStep: number[] }> {
  const ids = new Set<number>();
  const perStep: number[] = [];
  const steps = Math.round(ms / (1000 / 60));
  for (let i = 0; i < steps; i++) {
    await game.advance(1000 / 60);
    const s = await game.state();
    const before = ids.size;
    for (const p of s.projectiles) if (p.faction === 'player') ids.add(p.id);
    perStep.push(ids.size - before);
  }
  return { ids, perStep };
}

test.describe('Combat', () => {
  test('bow cannon fires one shot forward and respects its cooldown', async ({ page, game }) => {
    await game.open();
    await game.startBattle();
    await page.keyboard.down('Space');
    const { ids, perStep } = await collectPlayerShots(game, 1000);
    await page.keyboard.up('Space');
    // Cooldown 0.45 s: shots at t = 0, 0.45, 0.9 → 3 volleys of 1 projectile.
    expect(ids.size).toBe(3);
    expect(perStep.filter((n) => n > 0)).toEqual([1, 1, 1]);

    const s = await game.state();
    const shot = s.projectiles.find((p) => p.faction === 'player');
    expect(shot?.vx).toBeGreaterThan(0);
    expect(Math.abs(shot?.vy ?? 1)).toBeLessThan(1e-6);
  });

  test('broadsides fire three parallel shots per side with their own cooldown', async ({ page, game }) => {
    await game.open();
    await game.startBattle();
    await page.keyboard.down('KeyQ');
    await game.advance(1000 / 60);
    let s = await game.state();
    const left = s.projectiles.filter((p) => p.faction === 'player');
    expect(left).toHaveLength(3);
    // Heading east: port (left) fires north, all parallel.
    for (const p of left) {
      expect(p.vy).toBeLessThan(0);
      expect(Math.abs(p.vx)).toBeLessThan(1e-6);
    }
    expect(new Set(left.map((p) => Math.round(p.x))).size).toBe(3);

    // Holding the key does not fire again before the 1.6 s cooldown.
    await game.advance(1000);
    s = await game.state();
    expect(s.player.cooldowns.left).toBeGreaterThan(0);
    await page.keyboard.up('KeyQ');

    // Starboard is independent of port.
    await page.keyboard.down('KeyE');
    await game.advance(1000 / 60);
    await page.keyboard.up('KeyE');
    s = await game.state();
    expect(s.projectiles.filter((p) => p.faction === 'player' && p.vy > 0)).toHaveLength(3);
  });

  test('damage is applied once per hit and kills score exactly one point', async ({ page, game }) => {
    await game.open();
    await game.startBattle();
    const start = await game.state();
    // Placed 280 px ahead; everything below happens before the first natural spawn (t = 1.5 s).
    const id = await game.spawn('shooter', start.player.x + 280, start.player.y);

    await page.keyboard.down('Space');
    await game.advance(1000 / 60);
    await page.keyboard.up('Space');
    await game.advance(450);
    let s = await game.state();
    expect(s.enemies.find((e) => e.id === id)?.health).toBe(75 - 34);
    expect(s.projectiles.filter((p) => p.faction === 'player')).toHaveLength(0);

    // Two more hits sink it (75 HP, 34 per shot).
    await page.keyboard.down('Space');
    for (let i = 0; i < 12 && s.enemies.some((e) => e.id === id); i++) {
      await game.advance(1000 / 15);
      s = await game.state();
    }
    await page.keyboard.up('Space');
    expect(s.time).toBeLessThan(1.5);
    expect(s.enemies.find((e) => e.id === id)).toBeUndefined();
    expect(s.score).toBe(1);
    expect(s.kills).toEqual({ chaser: 0, shooter: 1 });

    // Remaining shots and later frames never count the same kill twice.
    await game.advance(400);
    s = await game.state();
    expect(s.score).toBe(1);
    await expect(page.getByTestId('hud-score')).toContainText('1');
  });
});
