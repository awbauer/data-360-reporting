import { expect, test } from '@playwright/test';
import { liveSignIn } from './live-session';

const LIVE = 'http://localhost:4174';

test('the planner works without connecting to an org, and saves to the account', async ({ page, context }) => {
  await liveSignIn(context, LIVE, 'presales@example.com');
  await page.goto(LIVE);
  await page.getByRole('link', { name: 'Plan credit consumption without connecting' }).click();
  await expect(page.getByRole('heading', { name: 'Credit plan' })).toBeVisible();
  await expect(page.getByText('The rates are unverified defaults.')).toBeVisible();
  // Nothing to read from an org, so there is no fill button, and no lines yet
  await expect(page.getByRole('button', { name: 'Fill from this org' })).toHaveCount(0);

  await page.getByLabel('Usage type for the new line').selectOption('unification');
  await page.getByRole('button', { name: /Add line/ }).click();
  await expect(page.getByRole('heading', { name: 'Lines (1)' })).toBeVisible();
  await page.getByLabel(/^Rows per run for/).fill('20m');
  await page.getByLabel(/^Rows per run for/).blur();
  await page.getByLabel(/^Runs per month for/).fill('30');
  // 20M profiles × 75,000 credits per million × 30 runs
  await expect(page.locator('ol li').first()).toContainText('45M');

  // The plan follows the account: reload (the save is debounced to 1.2s)
  await page.waitForTimeout(1800);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Lines (1)' })).toBeVisible();
  await expect(page.getByLabel(/^Rows per run for/)).toHaveValue('20,000,000');
});
