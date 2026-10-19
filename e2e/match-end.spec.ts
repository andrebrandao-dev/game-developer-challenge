import { expect, STURDY_PLAYER, test } from './fixtures';

test.describe('Match end', () => {
  test('ends on time up, freezes the simulation and shows the result @mobile', async ({ page, game }) => {
    await game.open({ configOverrides: STURDY_PLAYER });
    await game.setOptions(60, 3);
    await game.startBattle();
    await game.advance(60_000);
    const ended = await game.state();
    expect(ended).toMatchObject({ status: 'ended', endReason: 'time_up', time: 60 });

    // Nothing moves, fires or scores after the end. (Game keys only: Space/Enter
    // would activate the focused "Play again" button once the result is shown.)
    await page.keyboard.down('KeyW');
    await page.keyboard.down('KeyK');
    expect(await game.advance(1000)).toBe(0);
    await page.keyboard.up('KeyW');
    await page.keyboard.up('KeyK');
    const after = await game.state();
    expect(after.step).toBe(ended.step);
    expect(after.player).toEqual(ended.player);
    expect(after.score).toBe(ended.score);

    await expect(page.getByTestId('result-screen')).toBeVisible();
    await expect(page.getByTestId('result-reason')).toHaveText('Time up');
    await expect(page.getByTestId('result-duration')).toHaveText('01:00');
    await expect(page.getByTestId('result-score')).toContainText(String(ended.score));
  });

  test('ends when the player is destroyed', async ({ page, game }) => {
    await game.open();
    await game.startBattle();
    // Seven chaser rams (15 damage each) sink the ship.
    for (let i = 0; i < 8; i++) {
      const s = await game.state();
      if (s.status !== 'running') break;
      await game.spawn('chaser', s.player.x + 160, s.player.y);
      await game.advance(1200);
    }
    const s = await game.state();
    expect(s).toMatchObject({ status: 'ended', endReason: 'destroyed' });
    expect(s.player.health).toBe(0);
    await expect(page.getByTestId('result-reason')).toHaveText('Ship sunk');
    await expect(page.getByRole('heading', { name: 'Defeated' })).toBeVisible();
  });

  test('play again starts a clean match', async ({ page, game }) => {
    await game.open({ configOverrides: STURDY_PLAYER });
    await game.setOptions(60, 1);
    await game.startBattle();
    await page.keyboard.down('Space');
    await game.advance(60_000);
    await page.keyboard.up('Space');
    await expect(page.getByTestId('result-screen')).toBeVisible();

    await page.getByRole('button', { name: 'Play again' }).click();
    await game.waitForPhase('running');
    const s = await game.state();
    expect(s).toMatchObject({ time: 0, step: 0, score: 0, status: 'running', endReason: null });
    expect(s.player.health).toBe(100_000);
    expect(s.enemies).toHaveLength(0);
    expect(s.projectiles).toHaveLength(0);
    await expect(page.getByTestId('hud-time')).toContainText('01:00');
    await expect(page.getByTestId('hud-score')).toContainText('0');
  });
});
