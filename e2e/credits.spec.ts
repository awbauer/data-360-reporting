import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

/** The editable row for an activity, found by its label. */
const row = (page: Page, label: string) =>
  page.locator('.act-table > tbody > tr').filter({ has: page.getByRole('button', { name: `Details for ${label}`, exact: true }) });

test('credit plans: estimate without an org, persist, export, then seed from the org', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Continue as demo user' }).click();

  // Before connecting any org, the Connect page offers the estimator on its own.
  await page.getByRole('link', { name: 'Estimate Data 360 credits' }).click();
  await expect(page.getByRole('heading', { name: 'Credit plans' })).toBeVisible();
  await page.getByRole('button', { name: 'New plan' }).last().click();
  await expect(page.getByLabel('Plan name')).toHaveValue('Untitled plan');
  await page.getByLabel('Plan name').fill('Acme year 1');
  await page.getByLabel('Client', { exact: true }).fill('Acme');

  // A first identity resolution run over 8M source profiles: 600,000 credits at the base rate
  // would cross the 300,000 tier, so the whole run bills at tier 2 (60,000/M) = 480,000.
  await page.getByLabel('Add an activity').selectOption('unification');
  const ir = row(page, 'Identity resolution');
  await ir.getByLabel('One-time volume').fill('8m');
  await ir.getByLabel('One-time volume').press('Enter');
  await expect(ir.locator('td').nth(4)).toContainText('480,000');
  await expect(page.locator('.tile', { hasText: 'Flex Credits over 12 months' }).locator('.num')).toHaveText('480,000');

  // Batch ingestion has no Flex usage type, so it isn't billed. Only Flex Credits are estimated.
  await page.getByLabel('Add an activity').selectOption('ingest_batch');
  const ingest = row(page, 'Batch ingestion from external sources');
  await ingest.getByLabel('rows per run').fill('1m');
  await ingest.getByLabel('rows per run').press('Enter');
  await expect(ingest.getByText('not billed')).toBeVisible();
  await expect(page.getByLabel('Rate card')).toHaveCount(0);
  await expect(page.getByText(/Data Services|order form/i)).toHaveCount(0);

  // The entitlement runway.
  await page.getByLabel('Credits in the contract').fill('400k');
  await page.getByLabel('Credits in the contract').press('Enter');
  await expect(page.locator('.tile.bad')).toContainText(/Runs out in/);

  // Months commit when the field is left, so typing 24 never passes through a 2-month plan.
  await page.getByLabel('Months', { exact: true }).fill('24');
  await page.getByLabel('Months', { exact: true }).press('Enter');
  await expect(page.locator('.tile', { hasText: 'Flex Credits over 24 months' })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible({ timeout: 10_000 });

  // Saved on the server: a reload brings it back.
  await page.reload();
  await expect(page.getByLabel('Plan name')).toHaveValue('Acme year 1');
  await expect(page.getByRole('link', { name: /Acme year 1/ })).toBeVisible();
  await expect(row(page, 'Identity resolution').locator('td').nth(4)).toContainText('480,000');

  // Export carries the rate card and the numbers.
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Markdown' }).click();
  const md = readFileSync(await (await download).path(), 'utf8');
  expect(md).toContain('# Credit estimate: Acme year 1');
  expect(md).toContain('Salesforce Flex Credits Rate Card, updated August 31, 2026');
  expect(md).not.toMatch(/Data Services|order form/i);
  expect(md).toContain('480000');

  // Connected: the plan is under Credits in the workbench, and activities can come from the org.
  await page.getByRole('link', { name: 'Connect an org' }).click();
  await page.getByRole('button', { name: 'Start with sample data' }).click();
  await page.getByRole('link', { name: 'Credits', exact: true }).click();
  await page.getByRole('link', { name: /Acme year 1/ }).click();
  await page.getByRole('button', { name: 'Add from this org…' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('This runs no queries');
  await expect(dialog).toContainText('Web SDK Events');
  await expect(dialog).toContainText('Classified as streaming from connector Website');
  await dialog.getByRole('button', { name: /^Add \d+ activit/ }).click();
  await expect(row(page, 'Web SDK Events')).toBeVisible();
  await expect(row(page, 'Ecommerce Orders').getByText('not billed')).toBeVisible();

  // At 2M events a day, streaming is worth questioning: the lever prices the batch alternative.
  await row(page, 'Web SDK Events').getByLabel('rows per day').fill('2m');
  await row(page, 'Web SDK Events').getByLabel('rows per day').press('Enter');
  const lever = page.locator('.lever', { hasText: 'Run “Web SDK Events” as a daily batch' });
  await expect(lever).toBeVisible();
  await lever.getByRole('button', { name: 'Apply' }).click();
  await expect(row(page, 'Web SDK Events').getByText('not billed')).toBeVisible();

  // Actual consumption, read from the mock org's Digital Wallet feeds (on request, with its cost stated).
  await expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible({ timeout: 10_000 });
  await page.getByRole('link', { name: /Actual consumption/ }).click();
  await expect(page.getByRole('heading', { name: 'Actual consumption' })).toBeVisible();
  await expect(page.getByText('Where this comes from')).toBeVisible();
  await page.getByRole('button', { name: /^Read consumption \(4 queries/ }).click();
  await expect(page.locator('.tile', { hasText: 'last 30 days' })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.tile', { hasText: 'purchased' })).toContainText(/left of 1,600,000 purchased/);
  const top = page.locator('section', { hasText: 'What consumed it' });
  await expect(top.getByRole('row').nth(1)).toContainText('Individual_Default_Ruleset');
  await expect(top.getByRole('link', { name: 'Lapsed VIPs' })).toBeVisible();

  // Track the plan against it: months since its start, Data 360 card only, production only.
  const d = new Date();
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 3, 1)).toISOString().slice(0, 7);
  await page.getByRole('button', { name: 'AgentforceCredits' }).click(); // leave Agentforce out
  await page.getByRole('link', { name: /Acme year 1/ }).click();
  await page.getByLabel('Contract start').fill(start);
  await expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible({ timeout: 10_000 });
  await page.getByRole('link', { name: /Actual consumption/ }).click();
  await page.getByRole('button', { name: 'Fill actuals' }).click();
  await expect(page.getByText('Filled 3 months of “Acme year 1”.')).toBeVisible();
  await page.getByRole('link', { name: 'Open the plan' }).click();
  await expect(page.getByText('(3 months entered)')).toBeVisible();

  // Beside the estimates: each segment's actual consumption.
  await page.getByRole('link', { name: 'Segments' }).click();
  await expect(page.getByRole('columnheader', { name: 'Actual, 30 days' })).toBeVisible();
  await page.getByRole('button', { name: 'Details for Lapsed VIPs' }).click();
  await expect(page.locator('.forecast-card .actual-line')).toContainText(/Actually consumed since .*: [\d,]+/);
  await page.getByRole('link', { name: 'Credits', exact: true }).click();
  await page.getByRole('link', { name: /Acme year 1/ }).click();

  // Delete.
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('button', { name: 'Delete plan' }).click();
  await expect(page.getByText('No plans yet.')).toBeVisible();
});
