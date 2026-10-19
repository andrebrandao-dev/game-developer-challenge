import { expect, STURDY_PLAYER, test, type GameDriver } from './fixtures';

async function finishShortMatch(game: GameDriver): Promise<void> {
  await game.setOptions(60, 3);
  await game.startBattle();
  await game.playUntilTimeUp();
}

test.describe('Match records', () => {
  test('a finished match appears once in history and once in ranking @mobile', async ({ page, game }) => {
    await game.open({ configOverrides: STURDY_PLAYER });
    const before = await game.serverRecordCount();
    await finishShortMatch(game);
    await expect(page.getByTestId('record-status')).toHaveAttribute('data-state', 'saved');
    expect(await game.serverRecordCount()).toBe(before + 1);

    await page.getByRole('button', { name: 'Main menu' }).click();
    await page.getByRole('button', { name: 'Match history' }).click();
    await expect(page.getByTestId('history-row')).toHaveCount(1);
    await expect(page.getByTestId('history-row')).toContainText('Time up');

    await page.getByRole('tab', { name: 'Ranking' }).click();
    // Find the player's entry (badge "YOU") across every ranking page for 60 s / 3 s.
    const indicator = page.getByTestId('page-indicator');
    await expect(indicator).toHaveText(/Page 1 of \d+/);
    const total = Number(/of (\d+)/.exec((await indicator.textContent()) ?? '')?.[1] ?? '1');
    let found = 0;
    for (let p = 1; p <= total; p++) {
      if (p > 1) {
        await page.getByRole('button', { name: 'Next page' }).click();
        await expect(indicator).toHaveText(`Page ${p} of ${total}`);
        await expect(page.getByTestId('ranking')).toHaveAttribute('data-stale', 'false');
      }
      found += await page.locator('[data-testid=ranking-row][data-me=true]').count();
    }
    expect(found).toBe(1);
  });

  test('repeated retries do not duplicate a record @network-failures', async ({ page, game }) => {
    await game.open({ scenario: 'record-unavailable', configOverrides: STURDY_PLAYER });
    const before = await game.serverRecordCount();
    await finishShortMatch(game);
    const status = page.getByTestId('record-status');
    await expect(status).toHaveAttribute('data-state', 'failed', { timeout: 10_000 });

    // Back to normal, then spam the retry button.
    await game.selectScenario('normal');
    await expect(status).toHaveAttribute('data-state', 'saved');
    expect(await game.serverRecordCount()).toBe(before + 1);
    await page.evaluate(() => window.__pirateBattle?.mocks.select('normal'));
    await page.waitForTimeout(500);
    expect(await game.serverRecordCount()).toBe(before + 1);
  });

  test('a pending record survives a refresh and is sent after recovery @network-failures', async ({ page, game }) => {
    await game.open({ scenario: 'record-unavailable', configOverrides: STURDY_PLAYER });
    const before = await game.serverRecordCount();
    await finishShortMatch(game);
    await expect(page.getByTestId('record-status')).toHaveAttribute('data-state', 'failed', { timeout: 10_000 });
    await expect(page.getByTestId('record-status')).toContainText('kept on this device');

    // The player can start another match while the record is pending.
    await page.getByRole('button', { name: 'Play again' }).click();
    await game.waitForPhase('running');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Main menu' }).click();
    await page.getByRole('button', { name: 'Abandon' }).click();

    await page.reload();
    expect((await game.outbox())?.pending).toHaveLength(1);
    await page.getByRole('button', { name: 'Match history' }).click();
    await expect(page.getByTestId('pending-notice')).toBeVisible();

    // Recovery: the scenario change triggers the resend.
    await game.selectScenario('normal');
    await expect(page.getByTestId('pending-notice')).toHaveCount(0);
    await expect(page.getByTestId('history-row')).toHaveCount(1);
    expect(await game.serverRecordCount()).toBe(before + 1);
    expect((await game.outbox())?.pending).toHaveLength(0);
  });

  test('timeout after the server stored the record recovers without duplication @network-failures', async ({ page, game }) => {
    await game.open({ scenario: 'record-timeout', apiTimeoutMs: 800, configOverrides: STURDY_PLAYER });
    const before = await game.serverRecordCount();
    await finishShortMatch(game);
    // First PUT is stored but never answered → client times out → retry gets 200 (existing).
    await expect(page.getByTestId('record-status')).toHaveAttribute('data-state', 'saved', { timeout: 10_000 });
    expect(await game.serverRecordCount()).toBe(before + 1);

    await page.getByRole('button', { name: 'Main menu' }).click();
    await page.getByRole('button', { name: 'Match history' }).click();
    await expect(page.getByTestId('history-row')).toHaveCount(1);
  });

  test('late responses do not overwrite newer data', async ({ page, game }) => {
    // Alternating 2.5 s / 100 ms latency makes responses arrive out of order.
    await game.open({ scenario: 'out-of-order', hash: '#/ranking' });
    const indicator = page.getByTestId('page-indicator');
    await expect(indicator).toHaveText('Page 1 of 3', { timeout: 8000 });

    await page.getByRole('button', { name: 'Next page' }).click(); // fast
    await expect(indicator).toHaveText('Page 2 of 3');
    await page.getByRole('button', { name: 'Previous page' }).click(); // cached + slow refetch
    await page.getByRole('button', { name: 'Next page' }).click(); // cached + fast refetch
    await expect(indicator).toHaveText('Page 2 of 3');
    const page2 = await page.getByTestId('ranking-row').allTextContents();

    // Let every slow response land: page 2 stays on screen with page 2 data.
    await page.waitForTimeout(3000);
    await expect(indicator).toHaveText('Page 2 of 3');
    expect(await page.getByTestId('ranking-row').allTextContents()).toEqual(page2);
    await expect(page.getByTestId('ranking-row').first()).toContainText('06');
  });

  test('registering a match refreshes a tab that is open @network-failures', async ({ page, game }) => {
    await game.open({ scenario: 'record-unavailable', configOverrides: STURDY_PLAYER });
    await finishShortMatch(game);
    await expect(page.getByTestId('record-status')).toHaveAttribute('data-state', 'failed', { timeout: 10_000 });
    await page.getByRole('button', { name: 'Main menu' }).click();
    await page.getByRole('button', { name: 'Match history' }).click();
    await expect(page.getByTestId('history-empty')).toBeVisible();

    // While the tab is visible, the queued record is sent and the tab updates by itself.
    await game.selectScenario('normal');
    await expect(page.getByTestId('history-row')).toHaveCount(1);
  });
});
