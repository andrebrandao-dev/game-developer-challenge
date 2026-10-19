import { expect, test } from './fixtures';

test.describe("Captain's Log", () => {
  test('ranking lists entries for the current settings with pagination @mobile', async ({ page, game }) => {
    await game.open();
    await page.getByRole('button', { name: 'Ranking' }).click();
    await expect(page.getByRole('tab', { name: 'Ranking' })).toHaveAttribute('aria-selected', 'true');
    const rows = page.getByTestId('ranking-row');
    await expect(rows).toHaveCount(5);
    await expect(rows.first()).toContainText('01');
    await expect(page.getByTestId('page-indicator')).toHaveText('Page 1 of 3');

    const firstPage = await rows.allTextContents();
    await page.getByRole('button', { name: 'Next page' }).click();
    await expect(page.getByTestId('page-indicator')).toHaveText('Page 2 of 3');
    await expect(rows.first()).toContainText('06');
    expect(await rows.allTextContents()).not.toEqual(firstPage);
    await page.getByRole('button', { name: 'Next page' }).click();
    await expect(page.getByTestId('page-indicator')).toHaveText('Page 3 of 3');
    await expect(page.getByRole('button', { name: 'Next page' })).toBeDisabled();
    await expect(rows).toHaveCount(2);

    // Scores are sorted descending.
    await page.getByRole('button', { name: 'Previous page' }).click();
    await page.getByRole('button', { name: 'Previous page' }).click();
    const scores = (await page.locator('[data-testid=ranking-row] td:nth-child(3)').allTextContents()).map(Number);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });

  test('tabs are keyboard navigable', async ({ page, game }) => {
    await game.open({ hash: '#/ranking' });
    await page.getByRole('tab', { name: 'Ranking' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'Match history' })).toBeFocused();
    await expect(page.getByRole('tab', { name: 'Match history' })).toHaveAttribute('aria-selected', 'true');
    await expect(page).toHaveURL(/#\/history$/);
  });

  test('history pagination across many pages', async ({ page, game }) => {
    await game.open({ scenario: 'many-pages', hash: '#/history' });
    await expect(page.getByTestId('history-row')).toHaveCount(5);
    await expect(page.getByTestId('page-indicator')).toHaveText('Page 1 of 5');
    await page.getByRole('button', { name: 'Next page' }).click();
    await expect(page.getByTestId('page-indicator')).toHaveText('Page 2 of 5');
  });

  test('shows a loading state on slow networks', async ({ page, game }) => {
    await game.open({ scenario: 'slow' });
    await page.getByRole('button', { name: 'Ranking' }).click();
    await expect(page.getByTestId('ranking-loading')).toBeVisible();
    await expect(page.getByTestId('ranking-row').first()).toBeVisible({ timeout: 8000 });
    await expect(page.getByTestId('ranking-loading')).toHaveCount(0);
  });

  test('shows empty states', async ({ page, game }) => {
    await game.open({ scenario: 'empty', hash: '#/ranking' });
    await expect(page.getByTestId('ranking-empty')).toBeVisible();
    await expect(page.getByTestId('ranking-empty')).toContainText('No battles recorded');
    await page.getByRole('tab', { name: 'Match history' }).click();
    await expect(page.getByTestId('history-empty')).toBeVisible();
  });

  test('shows errors with retry, without blocking the game @network-failures', async ({ page, game }) => {
    // History works under this scenario...
    await game.open({ scenario: 'ranking-fails', hash: '#/history' });
    await expect(page.getByTestId('history')).toBeVisible();

    // ...while the ranking fails. Server errors are retried twice with backoff first.
    await page.getByRole('tab', { name: 'Ranking' }).click();
    await expect(page.getByTestId('ranking-error')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('alert')).toContainText('error 500');

    // Recover: switch scenario, retry manually.
    await game.selectScenario('normal');
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByTestId('ranking-row').first()).toBeVisible();

    // The game remains playable while the API fails.
    await game.selectScenario('offline');
    await page.getByRole('button', { name: 'Main menu' }).click();
    await game.startBattle();
    await game.advance(1000);
    expect((await game.state()).status).toBe('running');
  });

  test('client errors (4xx) are not retried @network-failures', async ({ page, game }) => {
    let calls = 0;
    page.on('request', (r) => {
      if (r.url().includes('/api/players/')) calls++;
    });
    await game.open({ scenario: 'http-400', hash: '#/history' });
    await expect(page.getByTestId('history-error')).toBeVisible();
    await expect(page.getByRole('alert')).toContainText('rejected as invalid');
    await page.waitForTimeout(1500);
    expect(calls).toBe(1);
  });

  test('timeouts surface as errors @network-failures', async ({ page, game }) => {
    await game.open({ scenario: 'timeout', apiTimeoutMs: 400, hash: '#/ranking' });
    await expect(page.getByTestId('ranking-error')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('alert')).toContainText('took too long');
  });
});
