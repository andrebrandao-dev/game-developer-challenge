import { expect, STURDY_PLAYER, test } from './fixtures';

test.describe('Result & navigation', () => {
  test('the result is shown and survives a refresh @mobile', async ({ page, game }) => {
    await game.open({ configOverrides: STURDY_PLAYER });
    await game.setOptions(60, 3);
    await game.startBattle();
    await game.playUntilTimeUp();
    const score = await page.getByTestId('result-score').textContent();
    await expect(page.getByTestId('record-status')).toHaveAttribute('data-state', 'saved');

    await page.reload();
    await expect(page.getByTestId('result-screen')).toBeVisible();
    await expect(page.getByTestId('result-score')).toHaveText(score ?? '');
    await expect(page.getByTestId('result-duration')).toHaveText('01:00');
    await expect(page.getByTestId('record-status')).toHaveAttribute('data-state', 'saved');

    await page.getByRole('button', { name: 'Main menu' }).click();
    await expect(page.getByTestId('last-battle')).toContainText('01:00');
  });

  test('abandoning a match records nothing', async ({ page, game }) => {
    await game.open();
    const before = await game.serverRecordCount();
    await game.startBattle();
    await game.advance(3000);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Main menu' }).click();
    await expect(page.getByRole('heading', { name: 'Abandon battle?' })).toBeVisible();
    await page.getByRole('button', { name: 'Abandon' }).click();
    await expect(page.getByTestId('main-menu')).toBeVisible();
    await expect(page.getByTestId('last-battle')).toHaveCount(0);
    expect((await game.outbox())?.pending).toHaveLength(0);
    expect(await game.serverRecordCount()).toBe(before);
  });

  test('refreshing during a battle abandons it', async ({ page, game }) => {
    await game.open();
    await game.startBattle();
    await game.advance(2000);
    await page.reload();
    await expect(page.getByTestId('main-menu')).toBeVisible();
    await expect(page).toHaveURL(/#\/$/);
    expect(await page.evaluate(() => window.__pirateBattle?.session.active())).toBe(false);
    expect((await game.outbox())?.pending).toHaveLength(0);
  });

  test('repeated navigation between screens stays consistent', async ({ page, game }) => {
    await game.open();
    for (let i = 0; i < 3; i++) {
      await page.getByRole('button', { name: 'Options' }).click();
      await expect(page.getByTestId('options-screen')).toBeVisible();
      await page.getByRole('button', { name: 'Main menu' }).click();
      await page.getByRole('button', { name: 'Ranking' }).click();
      await expect(page.getByTestId('ranking-row').first()).toBeVisible();
      await page.getByRole('tab', { name: 'Match history' }).click();
      await page.getByRole('button', { name: 'Main menu' }).click();
      await game.startBattle();
      await game.advance(500);
      // Browser back leaves the battle (abandoned) and frees the session.
      await page.goBack();
      await expect(page.getByTestId('main-menu')).toBeVisible();
      expect(await page.evaluate(() => window.__pirateBattle?.session.active())).toBe(false);
    }
    // Only one canvas ever exists, and none is left after leaving.
    await expect(page.locator('canvas')).toHaveCount(0);
  });

  test('touch controls steer and fire, several at once @mobile', async ({ page, game, isMobile }) => {
    test.skip(!isMobile, 'Touch controls are shown on coarse pointers');
    await game.open();
    await game.startBattle();
    await expect(page.getByTestId('touch-controls')).toBeVisible();
    const start = await game.state();

    // Hold forward + turn right + bow cannon with three pointers at once.
    const press = async (testId: string, pointerId: number, type: 'pointerdown' | 'pointerup') => {
      await page.getByTestId(testId).dispatchEvent(type, { pointerId, pointerType: 'touch', isPrimary: pointerId === 1, bubbles: true });
    };
    await press('touch-forward', 1, 'pointerdown');
    await press('touch-turnRight', 2, 'pointerdown');
    await press('touch-fireFront', 3, 'pointerdown');
    await expect(page.getByTestId('touch-forward')).toHaveAttribute('data-pressed', 'true');
    await game.advance(100);
    // The bow shot is checked right away: later it may hit an island and expire.
    expect((await game.state()).projectiles.some((p) => p.faction === 'player')).toBe(true);
    await game.advance(700);
    const held = await game.state();
    expect(held.player.angle).toBeGreaterThan(start.player.angle + 1);
    expect(Math.hypot(held.player.x - start.player.x, held.player.y - start.player.y)).toBeGreaterThan(40);

    await press('touch-forward', 1, 'pointerup');
    await press('touch-turnRight', 2, 'pointerup');
    await press('touch-fireFront', 3, 'pointerup');
    const angle = (await game.state()).player.angle;
    await game.advance(300);
    expect((await game.state()).player.angle).toBeCloseTo(angle, 6);

    // A real tap (down + up before any simulation step) still fires once.
    await page.getByTestId('touch-fireLeft').tap();
    await game.advance(1000 / 60);
    const tapped = await game.state();
    expect(tapped.player.cooldowns.left).toBeGreaterThan(0);
    expect(tapped.projectiles.filter((p) => p.faction === 'player')).toHaveLength(3);
  });
});
