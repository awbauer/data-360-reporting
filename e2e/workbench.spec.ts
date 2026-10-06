import { expect, test, type Page } from '@playwright/test';

/** Every tab stays mounted, so scope to the visible one. */
const panel = (page: Page) => page.locator('.qtab-panel:not([hidden])');
const editor = (page: Page) => panel(page).locator('.cm-content');

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
  const status = panel(page).locator('.statusbar');
  const tile = (label: string) => page.locator('.tile', { hasText: label }).locator('.num');
  await expect(tile('Data model objects')).toHaveText('5');
  await expect(tile('Data lake objects')).toHaveText('1');
  await expect(tile('Calculated insights')).toHaveText('1');
  await expect(page.getByRole('heading', { name: /Objects without relationships \(2\)/ })).toBeVisible(); // Account, Case
  await expect(tile('Data streams')).toHaveText('3');
  await expect(tile('Segments')).toHaveText('3');
  await expect(page.getByRole('heading', { name: /last run failed \(1\)/ })).toBeVisible();
  await expect(page.getByRole('cell', { name: /Ecommerce Orders/ })).toBeVisible();

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

  // Numeric fields get a histogram (bucketed), with the null share, and can flip to top values
  await page.locator('tr', { hasText: 'ssot__YearlyIncome__c' }).getByRole('button', { name: 'histogram' }).click();
  const income = page.locator('tr', { hasText: 'ssot__YearlyIncome__c' }).locator('xpath=following-sibling::tr[1]');
  await expect(income.locator('.chart .bar').first()).toBeVisible({ timeout: 20_000 });
  expect(await income.locator('.chart .bar').count()).toBeGreaterThan(5);
  await expect(income).toContainText(/null \(\d+\.\d%\)/);
  await expect(income).toContainText('buckets of');
  await income.locator('.chart .hit').nth(3).hover();
  await expect(income.locator('.chart-tip')).toContainText('Yearly Income:');
  await income.getByRole('button', { name: 'Top values' }).click();
  await expect(income.locator('.bar-row').first()).toBeVisible({ timeout: 20_000 });

  // Date fields are bucketed by a sensible unit, which can be changed
  await page.locator('tr', { hasText: 'ssot__CreatedDate__c' }).getByRole('button', { name: 'histogram' }).click();
  const created = page.locator('tr', { hasText: 'ssot__CreatedDate__c' }).locator('xpath=following-sibling::tr[1]');
  await expect(created).toContainText('bucketed by month', { timeout: 20_000 });
  await created.getByLabel('Bucket').selectOption('year');
  await expect(created).toContainText('bucketed by year', { timeout: 20_000 });
  expect(await created.locator('.chart .bar').count()).toBeLessThanOrEqual(4);

  // Relationship map: neighbours are drawn, and clicking one navigates
  const map = page.getByRole('group', { name: 'Relationships of Individual' });
  await expect(map).toBeVisible();
  await expect(map.getByRole('link', { name: 'Open Contact Point Email' })).toBeVisible();
  await expect(map).toContainText('N:1');
  // The JOIN builder opens a runnable JOIN in the editor without running it
  await page.getByRole('row', { name: /Contact Point Email/ }).getByRole('button', { name: 'Build JOIN' }).first().click();
  await expect(editor(page)).toContainText('JOIN "ssot__Individual__dlm" b ON a."ssot__PartyId__c" = b."ssot__Id__c"');
  await expect(status).toContainText('Ready');
  await page.getByRole('link', { name: 'Explorer' }).click();
  await page.getByPlaceholder(/Search \d+ objects/).fill('individual');
  await page.locator('.obj-item', { hasText: 'Individual' }).first().click();
  await map.getByRole('link', { name: 'Open Contact Point Email' }).click();
  await expect(page.getByRole('heading', { name: 'Contact Point Email', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Individual', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Individual', exact: true })).toBeVisible();

  // Preview opens the editor and runs
  await page.getByRole('button', { name: 'Preview 100 rows' }).click();
  await expect(status).toContainText('100 rows', { timeout: 20_000 });
  await expect(panel(page).locator('[role=row]').nth(1)).toContainText('IND-');

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
  await expect(status).toContainText('5 rows');

  // A bad parameter value is reported, not sent
  await page.getByLabel('min value').fill('lots');
  await page.getByRole('button', { name: '▶ Run' }).click();
  await expect(page.getByRole('alert')).toContainText('must be an integer');

  // Unbounded scans ask first, using the cached row count; the user can cancel or bound the query
  await setSql(page, 'SELECT * FROM "ssot__Individual__dlm"');
  await page.getByRole('button', { name: '▶ Run' }).click();
  const guard = page.getByRole('dialog', { name: /no LIMIT/ });
  await expect(guard).toContainText('every column of every row');
  await expect(guard).toContainText('2,500 rows');
  await guard.getByRole('button', { name: 'Cancel' }).click();
  await expect(guard).toBeHidden();
  await expect(status).not.toContainText('2,500 rows');
  await page.getByRole('button', { name: '▶ Run' }).click();
  await guard.getByRole('button', { name: 'Add LIMIT 1,000 and run' }).click();
  await expect(status).toContainText('1,000 rows');
  await expect(editor(page)).toContainText('LIMIT 1000');

  // SQL errors from the engine are shown (and "don't ask again" silences the guard for the session)
  await setSql(page, 'SELECT * FROM "nope"');
  await page.getByRole('button', { name: '▶ Run' }).click();
  await guard.getByLabel("Don't ask again in this browser session").check();
  await guard.getByRole('button', { name: 'Run anyway' }).click();
  await expect(page.getByRole('alert')).toContainText(/no such table/);

  // Large result: first chunk, polling to completion, paging, CSV export
  await setSql(page, 'SELECT * FROM "ssot__EmailEngagement__dlm"');
  await page.getByRole('button', { name: '▶ Run' }).click();
  await expect(status).toContainText('5,000 rows (1,000 loaded)', { timeout: 30_000 });
  await page.getByRole('button', { name: 'Load more rows' }).click();
  await expect(status).toContainText('2,000 loaded');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export CSV' }).click()]);
  const path = await download.path();
  const csv = (await import('node:fs')).readFileSync(path, 'utf8').trim().split('\n');
  expect(csv).toHaveLength(5001);
  expect(csv[0]).toBe('ssot__Id__c,ssot__IndividualId__c,ssot__EngagementType__c,ssot__EngagementDateTime__c');

  // Charts: an aggregate becomes a bar chart; a date_trunc series becomes a line
  await setSql(page, 'SELECT "ssot__EngagementType__c" AS "type", COUNT(*) AS "n" FROM "ssot__EmailEngagement__dlm" GROUP BY 1 ORDER BY 2 DESC');
  await page.getByRole('button', { name: '▶ Run' }).click();
  await expect(status).toContainText('4 rows');
  await page.getByRole('group', { name: 'Result view' }).getByRole('button', { name: 'Chart' }).click();
  await expect(panel(page).locator('.results .chart .bar')).toHaveCount(4);
  await panel(page).locator('.results .chart .hit').first().hover();
  await expect(panel(page).locator('.results .chart-tip')).toContainText('type:');
  await page.getByRole('group', { name: 'Result view' }).getByRole('button', { name: 'Table' }).click();
  await setSql(page, `SELECT DATE_TRUNC('month', "ssot__EngagementDateTime__c") AS "month", COUNT(*) AS "n" FROM "ssot__EmailEngagement__dlm" GROUP BY 1 ORDER BY 1`);
  await page.getByRole('button', { name: '▶ Run' }).click();
  await expect(status).toContainText(/\d+ rows/);
  await page.getByRole('group', { name: 'Result view' }).getByRole('button', { name: 'Chart' }).click();
  await expect(panel(page).locator('.results .chart path.line')).toBeVisible();

  // Format keeps parameters and quoted names
  await setSql(page, 'select "a" from "ssot__Individual__dlm" where "ssot__YearlyIncome__c" > :min limit 5');
  await page.getByRole('button', { name: 'Format' }).click();
  await expect.poll(() => panel(page).locator('.cm-line').count()).toBeGreaterThan(2); // formatting loads lazily
  await expect(editor(page)).toContainText('SELECT');
  await expect(page.getByLabel('min type')).toBeVisible();

  // Tabs keep their own text and results
  const before = await page.getByRole('tab').count();
  await page.getByRole('button', { name: 'New query tab' }).click();
  await expect(page.getByRole('tab')).toHaveCount(before + 1);
  await expect(editor(page)).toContainText('LIMIT 100'); // starter query
  await page.getByRole('tab').nth(before - 1).click();
  await expect(editor(page)).toContainText(/LIMIT\s+5/);
  await page.getByRole('button', { name: /^Close / }).last().click();
  await expect(page.getByRole('tab')).toHaveCount(before);

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
  await expect(status).toContainText('100 rows');

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
