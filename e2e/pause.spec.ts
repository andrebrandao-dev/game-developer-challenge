import { expect, test } from './fixtures';

test.describe('Pause', () => {
  test('manual pause freezes the real-time clock and resume needs an action', async ({ page, game }) => {
    await game.open({ manualClock: false });
    await game.startBattle();
    await page.waitForTimeout(500);

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('pause-dialog')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Paused' })).toBeVisible();
    const paused = await game.state();
    expect(paused.phase).toBe('paused');

    // Real time passes, game time does not.
    await page.waitForTimeout(1500);
    const still = await game.state();
    expect(still.time).toBe(paused.time);
    expect(still.step).toBe(paused.step);

    await page.getByRole('button', { name: 'Resume' }).click();
    await game.waitForPhase('running');
    await page.waitForTimeout(500);
    const resumed = await game.state();
    expect(resumed.time).toBeGreaterThan(paused.time);
    // No catch-up of the paused period (≈0.5 s of play, never 2 s).
    expect(resumed.time - paused.time).toBeLessThan(1.2);
  });

  test('pauses automatically on focus loss and on hidden tab', async ({ page, game }) => {
    await game.open();
    await game.startBattle();

    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await expect(page.getByTestId('pause-dialog')).toContainText('lost focus');
    expect((await game.state()).pauseReason).toBe('focus-lost');
    expect(await game.advance(1000)).toBe(0);
    await page.getByRole('button', { name: 'Resume' }).click();
    await game.waitForPhase('running');

    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(page.getByTestId('pause-dialog')).toContainText('tab was hidden');
    expect((await game.state()).pauseReason).toBe('hidden');
  });

  test('input held across a pause is not replayed and cooldowns stay frozen', async ({ page, game }) => {
    await game.open();
    await game.startBattle();
    await page.keyboard.down('Space');
    await page.keyboard.down('KeyW');
    await game.advance(100);
    const before = await game.state();
    expect(before.player.cooldowns.front).toBeGreaterThan(0);

    await page.getByTestId('pause-button').click();
    await page.keyboard.up('Space');
    await page.keyboard.up('KeyW');
    await page.waitForTimeout(600);
    expect((await game.state()).player.cooldowns).toEqual(before.player.cooldowns);

    await page.getByRole('button', { name: 'Resume' }).click();
    await game.waitForPhase('running');
    const speed = (await game.state()).player.speed;
    await game.advance(1000);
    const after = await game.state();
    // Keys released during the pause: the ship coasts down and fires nothing new.
    expect(after.player.speed).toBeLessThan(speed);
    expect(after.projectiles.filter((p) => p.faction === 'player').length).toBeLessThanOrEqual(1);
  });

  test('pause dialog traps focus and Escape resumes', async ({ page, game }) => {
    await game.open();
    await game.startBattle();
    await page.keyboard.press('KeyP');
    const dialog = page.getByTestId('pause-dialog');
    await expect(dialog).toBeVisible();
    await expect(page.getByRole('button', { name: 'Resume' })).toBeFocused();
    for (let i = 0; i < 6; i++) await page.keyboard.press('Tab');
    const focusedInside = await page.evaluate(() => !!document.activeElement?.closest('dialog'));
    expect(focusedInside).toBe(true);
    await page.keyboard.press('Escape');
    await game.waitForPhase('running');
    await expect(dialog).toHaveCount(0);
  });
});
