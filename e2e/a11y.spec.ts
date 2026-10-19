import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, STURDY_PLAYER, test } from './fixtures';

/** WCAG 2.1 A/AA checks (contrast, labels, roles, names) with axe-core. */
async function audit(page: Page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    // The canvas is decorative for assistive tech (aria-hidden); its state is in the HUD.
    .exclude('canvas')
    .analyze();
  const summary = results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
  expect(summary, `axe violations on ${label}`).toEqual([]);
}

test.describe('Accessibility', () => {
  test('menus, forms and dialogs pass axe WCAG 2.1 AA', async ({ page, game }) => {
    await game.open();
    await page.waitForLoadState('networkidle');
    await audit(page, 'main menu');

    await page.getByRole('button', { name: 'Controls' }).click();
    await audit(page, 'controls dialog');
    await page.getByRole('button', { name: 'Close' }).click();

    await page.getByRole('button', { name: 'Options' }).click();
    await page.getByRole('spinbutton', { name: 'Game session time' }).fill('5');
    await audit(page, 'options with a validation error');
    await page.getByRole('button', { name: 'Main menu' }).click();

    await page.getByRole('button', { name: 'Ranking' }).click();
    await expect(page.getByTestId('ranking-row').first()).toBeVisible();
    await audit(page, 'ranking');
    await page.getByRole('tab', { name: 'Match history' }).click();
    await audit(page, 'history');
    await page.getByRole('button', { name: 'Main menu' }).click();

    await page.getByTestId('open-network-lab').click();
    await audit(page, 'network lab');
  });

  test('battle HUD, pause dialog and result pass axe WCAG 2.1 AA', async ({ page, game }) => {
    await game.open({ configOverrides: STURDY_PLAYER });
    await game.setOptions(60, 3);
    await game.startBattle();
    await game.advance(500);
    await audit(page, 'battle HUD');
    await expect(page.getByTestId('battle-state')).toHaveText('Battle status: in progress');

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('battle-state')).toHaveText('Battle status: paused');
    await audit(page, 'pause dialog');
    await page.getByRole('button', { name: 'Resume' }).click();

    await game.playUntilTimeUp();
    await expect(page.getByTestId('record-status')).toHaveAttribute('data-state', 'saved');
    await audit(page, 'result');
  });
});
