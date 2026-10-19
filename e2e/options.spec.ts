import { expect, test } from './fixtures';

test.describe('Options', () => {
  test('navigates, validates and persists options after refresh', async ({ page, game }) => {
    await game.open();
    await page.getByRole('button', { name: 'Options' }).click();
    await expect(page.getByRole('heading', { name: 'Options' })).toBeVisible();

    const session = page.getByRole('spinbutton', { name: 'Game session time' });
    const spawn = page.getByRole('spinbutton', { name: 'Enemy spawn time' });
    const save = page.getByRole('button', { name: 'Save' });
    await expect(session).toHaveValue('120');
    await expect(spawn).toHaveValue('3');

    // Out of range, not on step, zero and empty values are rejected with accessible errors.
    await session.fill('200');
    await expect(page.getByRole('alert').filter({ hasText: 'between 60 and 180' })).toBeVisible();
    await expect(session).toHaveAttribute('aria-invalid', 'true');
    await expect(save).toBeDisabled();
    await session.fill('65');
    await expect(page.getByRole('alert').filter({ hasText: 'steps of 10' })).toBeVisible();
    await spawn.fill('0');
    await expect(page.getByRole('alert').filter({ hasText: 'greater than 0' })).toBeVisible();
    await spawn.fill('');
    await expect(page.getByRole('alert').filter({ hasText: 'Enter a number' })).toBeVisible();
    await expect(save).toBeDisabled();

    // Steppers snap to the grid and respect the limits.
    await session.fill('180');
    await expect(page.getByRole('button', { name: 'Increase game session time' })).toBeDisabled();
    await page.getByRole('button', { name: 'Decrease game session time' }).click();
    await expect(session).toHaveValue('170');
    await spawn.fill('2.5');
    await page.getByRole('button', { name: 'Increase enemy spawn time' }).click();
    await expect(spawn).toHaveValue('3');
    await spawn.fill('2.5');

    await expect(save).toBeEnabled();
    await save.click();
    await expect(page.getByRole('status').filter({ hasText: 'Options saved.' })).toBeVisible();

    await page.reload();
    await expect(page.getByRole('spinbutton', { name: 'Game session time' })).toHaveValue('170');
    await expect(page.getByRole('spinbutton', { name: 'Enemy spawn time' })).toHaveValue('2.5');

    await page.getByRole('button', { name: 'Main menu' }).click();
    await expect(page.getByTestId('main-menu')).toBeVisible();
  });

  test('a match keeps the config snapshot taken at start', async ({ page, game }) => {
    await game.open();
    await game.setOptions(90, 4);
    await game.startBattle();
    expect((await game.state()).config).toEqual({ durationSec: 90, spawnIntervalSec: 4 });

    // Change options from the pause menu: the running match is unaffected.
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Options' }).click();
    await page.getByRole('spinbutton', { name: 'Game session time' }).fill('150');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Changes apply to your next battle.')).toBeVisible();
    await page.getByRole('button', { name: 'Back' }).click();
    await page.getByRole('button', { name: 'Resume' }).click();
    expect((await game.state()).config).toEqual({ durationSec: 90, spawnIntervalSec: 4 });
    await expect(page.getByTestId('hud-time')).toContainText('01:30');
  });
});
