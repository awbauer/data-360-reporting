import { expect, test, type Page } from '@playwright/test';

const editor = (page: Page) => page.locator('.cm-content');

async function setSql(page: Page, sql: string) {
  await editor(page).click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Delete');
  await page.keyboard.type(sql);
  // dismiss any autocomplete popup
  await page.keyboard.press('Escape');
}

test.describe.configure({ mode: 'serial' });

test('connect → explore → query → library → disconnect', async ({ page }) => {
  // The connection is user-initiated: loading the app does not redirect.
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Start with sample data' })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/');
  await page.getByRole('button', { name: 'Start with sample data' }).click();

  // Overview: metadata-only abstracts
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
  const tile = (label: string) => page.locator('.tile', { hasText: label }).locator('.num');
  await expect(tile('Data model objects')).toHaveText('5');
  await expect(tile('Data lake objects')).toHaveText('1');
  await expect(tile('Calculated insights')).toHaveText('1');
  await expect(page.getByRole('heading', { name: /Objects without relationships \(2\)/ })).toBeVisible(); // Account, Case

  // Row counts only run after an explicit, confirmed action
  await expect(page.getByText('never started automatically')).toBeVisible();
  await page.getByRole('button', { name: 'Count rows for 7 objects' }).click();
  await expect(page.getByRole('dialog')).toContainText('7 queries');
  await page.getByRole('button', { name: 'Run 7 queries' }).click();
  await expect(page.getByText(/rows across 7 counted objects/)).toBeVisible({ timeout: 20_000 });

  // Explorer + object detail + profile
  await page.getByRole('link', { name: 'Explorer' }).click();
  await page.getByPlaceholder(/Search \d+ objects/).fill('individual');
  await page.locator('.obj-item', { hasText: 'Individual' }).first().click();
  await expect(page.getByRole('heading', { name: 'Individual', exact: true })).toBeVisible();
  await expect(page.getByText('2,500 rows')).toBeVisible(); // from the cached count
  await page.getByRole('button', { name: 'Profile fields' }).click();
  await page.getByRole('button', { name: 'Run 1 query' }).click();
  await expect(page.getByText(/profiled just now/)).toBeVisible({ timeout: 20_000 });
  const idRow = page.locator('tr', { hasText: 'ssot__Id__c' }).first();
  await expect(idRow).toContainText('100.0%');
  await page.locator('tr', { hasText: 'ssot__DataSourceId__c' }).getByRole('button', { name: 'top values' }).click();
  await expect(page.locator('.bar-row', { hasText: 'Salesforce_CRM' })).toBeVisible();

  // Preview opens the editor and runs
  await page.getByRole('button', { name: 'Preview 100 rows' }).click();
  await expect(page.locator('.statusbar')).toContainText('100 rows', { timeout: 20_000 });
  await expect(page.locator('[role=row]').nth(1)).toContainText('IND-');

  // Autocomplete from metadata
  await setSql(page, 'SELECT * FROM ssot__Ind');
  await page.keyboard.press('Control+Space');
  await expect(page.locator('.cm-tooltip-autocomplete')).toContainText('ssot__Individual__dlm');
  await page.keyboard.press('Escape');

  // Parameterised query with Ctrl/Cmd+Enter
  await setSql(page, 'SELECT "ssot__Id__c" FROM "ssot__Individual__dlm" WHERE "ssot__YearlyIncome__c" > :min ORDER BY 1 LIMIT 5');
  await expect(page.getByLabel('min type')).toBeVisible();
  await page.getByLabel('min type').selectOption('integer');
  await page.getByLabel('min value').fill('100000');
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(page.locator('.statusbar')).toContainText('5 rows');

  // A bad parameter value is reported, not sent
  await page.getByLabel('min value').fill('lots');
  await page.getByRole('button', { name: '▶ Run' }).click();
  await expect(page.getByRole('alert')).toContainText('must be an integer');

  // SQL errors from the engine are shown
  await setSql(page, 'SELECT * FROM "nope"');
  await page.getByRole('button', { name: '▶ Run' }).click();
  await expect(page.getByRole('alert')).toContainText(/no such table/);

  // Large result: first chunk, polling to completion, paging, CSV export
  await setSql(page, 'SELECT * FROM "ssot__EmailEngagement__dlm"');
  await page.getByRole('button', { name: '▶ Run' }).click();
  await expect(page.locator('.statusbar')).toContainText('5,000 rows (1,000 loaded)', { timeout: 30_000 });
  await page.getByRole('button', { name: 'Load more rows' }).click();
  await expect(page.locator('.statusbar')).toContainText('2,000 loaded');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export CSV' }).click()]);
  const path = await download.path();
  const csv = (await import('node:fs')).readFileSync(path, 'utf8').trim().split('\n');
  expect(csv).toHaveLength(5001);
  expect(csv[0]).toBe('ssot__Id__c,ssot__IndividualId__c,ssot__EngagementType__c,ssot__EngagementDateTime__c');

  // Propose to the shared library via GitHub
  await page.getByRole('button', { name: 'Propose to library…' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('Title').fill('All email engagement');
  await dlg.getByLabel('Folder').fill('email');
  const href = await dlg.getByRole('link').getAttribute('href');
  expect(href).toContain('https://github.com/awbauer/data-360-reporting/new/main?filename=queries%2Femail%2Fall-email-engagement.sql');
  expect(decodeURIComponent(href!)).toContain('title: "All email engagement"');
  await dlg.getByRole('button', { name: 'Close' }).click();

  // Library: run a parameterised shared query with its defaults
  await page.getByRole('link', { name: 'Library' }).click();
  await expect(page.getByRole('heading', { name: 'Query library' })).toBeVisible();
  await page.locator('.lib-item', { hasText: 'Individuals created since a date' }).click();
  await page.getByRole('button', { name: 'Open in editor' }).click();
  await expect(page.getByLabel('since value')).toHaveValue('2024-01-01');
  await page.getByRole('button', { name: '▶ Run' }).click();
  await expect(page.locator('.statusbar')).toContainText('100 rows');

  // History records completed runs
  await page.getByRole('link', { name: 'History' }).click();
  await expect(page.locator('.card').first()).toBeVisible();
  await expect(page.locator('pre.sql').first()).toContainText('ssot__CreatedDate__c');

  // Data space switch re-reads metadata
  await page.getByRole('link', { name: 'Overview' }).click();
  await page.getByLabel('Data space').selectOption('marketing');
  await expect(tile('Data model objects')).toHaveText('2');

  // Disconnect returns to the connect screen
  await page.getByRole('button', { name: 'Disconnect' }).click();
  await expect(page.getByRole('button', { name: 'Start with sample data' })).toBeVisible();
});
