import { expect, test } from './fixtures';

test.describe('Asset loading', () => {
  test('shows progress, reports failures and recovers on retry @network-failures', async ({ page, context, game }) => {
    // Hold the ship atlas image so the loading state is observable, then fail it.
    const gate: { release: (() => void) | null; fail: boolean } = { release: null, fail: true };
    await context.route('**/game/atlases/ships.png', async (route) => {
      if (!gate.fail) return route.continue();
      await new Promise<void>((resolve) => (gate.release = resolve));
      return route.abort('failed');
    });

    await game.open();
    await page.getByRole('button', { name: 'Play' }).click();
    await expect(page.getByRole('progressbar', { name: 'Loading game assets' })).toBeVisible();
    await expect(page.getByText(/Loading assets…/)).toBeVisible();

    await expect.poll(() => gate.release !== null).toBe(true);
    gate.release?.();
    await expect(page.getByRole('alert')).toContainText('Could not load the game assets.');
    await expect(page.getByTestId('battle')).toHaveCount(0);

    // Retry with the network back: the battle starts.
    gate.fail = false;
    await page.getByRole('button', { name: 'Try again' }).click();
    await game.waitForPhase('running');
    await expect(page.getByTestId('game-canvas')).toBeVisible();
  });

  test('can go back to the menu after a failure @network-failures', async ({ page, context, game }) => {
    await context.route('**/game/atlases/tiles*.json', (route) => route.abort('failed'));
    await game.open();
    await page.getByRole('button', { name: 'Play' }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await page.getByRole('button', { name: 'Main menu' }).click();
    await expect(page.getByTestId('main-menu')).toBeVisible();
  });
});
