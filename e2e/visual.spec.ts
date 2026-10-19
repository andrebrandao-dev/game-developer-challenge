import { expect, STURDY_PLAYER, test } from './fixtures';

/**
 * Visual regression baselines (versioned in e2e/__screenshots__).
 * The arena shot uses the manual clock and a fixed seed, so ships, effects
 * and the water drift are identical on every run.
 */
test.describe('Visual regression', () => {
  test('main menu @mobile', async ({ page, game }) => {
    await game.open();
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot('menu.png');
  });

  test('arena in a stable state @mobile', async ({ page, game }) => {
    await game.open({ seed: 1234 });
    await game.startBattle();
    // 2 s in: one enemy spawned, the player has sailed and fired.
    await page.keyboard.down('KeyW');
    await game.advance(1200);
    await page.keyboard.up('KeyW');
    await game.advance(800);
    await expect(page.getByTestId('battle')).toHaveScreenshot('arena.png', { maxDiffPixelRatio: 0.02 });
  });

  test('result screen @mobile', async ({ page, game }) => {
    await game.open({ seed: 1234, configOverrides: STURDY_PLAYER });
    await game.setOptions(60, 3);
    await game.startBattle();
    await game.playUntilTimeUp();
    await expect(page.getByTestId('record-status')).toHaveAttribute('data-state', 'saved');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot('result.png', { mask: [page.getByTestId('result-score')] });
  });
});
