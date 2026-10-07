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

test('sign in → connect → explore → query → library → admin → disconnect → sign out', async ({ page, browser }) => {
  // App sign-in comes first; in mock mode a local demo user stands in for GitHub/Google.
  await page.goto('/');
  await page.getByRole('button', { name: 'Continue as demo user' }).click();
  // The Salesforce connection is user-initiated: signing in does not redirect.
  await expect(page.getByRole('button', { name: 'Start with sample data' })).toBeVisible();
  await expect(page.getByText('demo@example.com')).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/');
  await page.getByRole('button', { name: 'Start with sample data' }).click();

  // Overview: metadata-only abstracts
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
  const status = panel(page).locator('.statusbar');
  const tile = (label: string) => page.locator('.tile', { hasText: label }).locator('.num');
  await expect(tile('Data model objects')).toHaveText('7');
  await expect(tile('Data lake objects')).toHaveText('4'); // Contact Home and three Digital Wallet consumption feeds
  await expect(tile('Calculated insights')).toHaveText('1');
  await expect(page.getByRole('heading', { name: /Objects without relationships \(2\)/ })).toBeVisible(); // Account, Case
  await expect(tile('Data streams')).toHaveText('3');
  await expect(tile('Segments')).toHaveText('3');
  await expect(page.getByRole('heading', { name: /last run failed \(1\)/ })).toBeVisible();
  await expect(page.getByRole('cell', { name: /Ecommerce Orders/ })).toBeVisible();

  // Row counts only run after an explicit, confirmed action
  await expect(page.getByText('never started automatically')).toBeVisible();
  await page.getByRole('button', { name: 'Count rows for 12 objects' }).click();
  await expect(page.getByRole('dialog')).toContainText('12 queries');
  await page.getByRole('button', { name: 'Run 12 queries' }).click();
  await expect(page.getByText(/rows across 12 counted objects/)).toBeVisible({ timeout: 20_000 });

  // Explorer + object detail + profile
  await page.getByRole('link', { name: 'Explorer' }).click();
  await page.getByPlaceholder(/Search \d+ objects/).fill('individual');
  await page.locator('.obj-item', { hasText: 'Individual' }).first().click();
  await expect(page.getByRole('heading', { name: 'Individual', exact: true })).toBeVisible();
  await expect(page.locator('.kv, .obj-head, main').getByText('2,500 rows', { exact: true }).first()).toBeVisible(); // from the cached count
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

  // Lineage: where a DMO's fields come from, and what a DLO feeds (metadata only)
  const lineage = page.locator('.card', { has: page.getByRole('heading', { name: 'Where this data comes from' }) });
  await expect(lineage).toContainText('loaded by Salesforce CRM Contact');
  await expect(lineage.getByRole('row', { name: /Email Address/ })).toContainText('Email__c');
  await expect(lineage).toContainText('3 fields with no source mapping');
  await lineage.getByRole('link', { name: 'Contact Home' }).click();
  // Salesforce can only list mappings into one DMO at a time, so the DLO side walks them on request
  const feeds = page.locator('.card', { has: page.getByRole('heading', { name: 'What this feeds' }) });
  await expect(feeds).toContainText('Loaded by data stream Salesforce CRM Contact');
  await expect(feeds).toContainText('7 API calls, no query credits');
  await expect(feeds.getByRole('heading', { name: /Feeds/ })).toHaveCount(0); // nothing is looked up automatically
  await feeds.getByRole('button', { name: 'Find the objects this feeds' }).click();
  await expect(feeds.getByRole('heading', { name: /Feeds/ })).toHaveCount(2);
  await feeds.getByText('Raw API response').click();
  await expect(feeds.locator('pre')).toContainText('objectSourceTargetMaps');
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Contact Point Email', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Individual', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Individual', exact: true })).toBeVisible();

  // A calculated insight shows its definition
  await page.getByRole('link', { name: 'Explorer' }).click();
  await page.getByPlaceholder(/Search \d+ objects/).fill('avg');
  await page.locator('.obj-item', { hasText: 'Avg Spends' }).click();
  const definition = page.locator('.card', { has: page.getByRole('heading', { name: 'Definition' }) });
  await expect(definition).toContainText('Average order value per individual');
  await expect(definition).toContainText('in use'); // definition status
  await expect(definition).toContainText('not scheduled');
  await expect(definition.locator('pre.sql').first()).toContainText('SELECT AVG(');
  const avg = definition.getByRole('row', { name: /Avg Spend/ });
  await expect(avg).toContainText('measure');
  await expect(avg).toContainText('AVG(SalesOrder__dlm.grand_total_amount__c)');
  await expect(avg).not.toContainText('AGGREGATABLE'); // an enum, never shown as the formula

  // Segments with their rules, read-only
  await page.getByRole('link', { name: 'Segments' }).click();
  await expect(page.getByRole('heading', { name: 'Segments' })).toBeVisible();
  const vip = page.getByRole('row', { name: /Lapsed VIPs/ });
  await expect(vip).toContainText('312');
  await expect(vip.getByRole('link', { name: 'Unified Individual' })).toBeVisible();
  // Rows counted earlier size each refresh: Unified Individual, Individual and Email Engagement.
  await expect(vip).toContainText('9K'); // 9,006 rows
  await expect(page.getByText(/active segments? that can be priced/)).toBeVisible();
  await vip.getByRole('button', { name: 'Details for Lapsed VIPs' }).click();
  await expect(page.getByText(/Publishes every 24 hours · next /)).toBeVisible();
  await expect(page.locator('pre.sql').first()).toContainText('"operator": "greaterThan"');
  const segCredits = page.locator('.forecast-card', { hasText: 'Credits for this segment' });
  await expect(segCredits.getByRole('cell', { name: 'At its schedule (every 24 hours)' })).toBeVisible();
  await expect(segCredits.getByRole('cell', { name: /Activating its 312 members/ })).toBeVisible();
  await page.getByRole('button', { name: 'Details for Draft Test' }).click();
  await expect(page.getByText('The API returned no rules for this segment.')).toBeVisible();

  // Exports: no queries run, files come straight from what's loaded and cached
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Overview' }).click();
  const dictionary = page.getByRole('group', { name: 'Data dictionary export' });
  const [xlsx] = await Promise.all([page.waitForEvent('download'), dictionary.getByRole('button', { name: 'Excel' }).click()]);
  expect(xlsx.suggestedFilename()).toMatch(/^data-dictionary_mock-org\.my\.salesforce\.com_default_\d{4}-\d{2}-\d{2}\.xlsx$/);
  const [md] = await Promise.all([page.waitForEvent('download'), dictionary.getByRole('button', { name: 'Markdown' }).click()]);
  const mdText = (await import('node:fs')).readFileSync((await md.path())!, 'utf8');
  expect(mdText).toContain('| ssot__Individual__dlm | Individual | Data model object | Profile |');
  const [html] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('group', { name: 'Health check export' }).getByRole('button', { name: 'HTML' }).click(),
  ]);
  const report = (await import('node:fs')).readFileSync((await html.path())!, 'utf8');
  expect(report).toContain('<h2>Field completeness</h2>');
  expect(report).toContain('Ecommerce_Orders'); // the failed stream
  expect(report).toContain('ssot__YearlyIncome__c'); // profiled earlier in this test

  // Preview opens the editor and runs
  await page.getByRole('link', { name: 'Explorer' }).click();
  await page.getByPlaceholder(/Search \d+ objects/).fill('individual');
  await page.locator('.obj-item', { hasText: 'Individual' }).first().click();
  await page.getByRole('button', { name: 'Preview 100 rows' }).click();
  await expect(status).toContainText('100 rows', { timeout: 20_000 });
  await expect(panel(page).locator('[role=row]').nth(1)).toContainText('IND-');

  // The editor estimates what the query reads from counts already cached: no query needed to know
  const chip = panel(page).locator('span.est');
  await expect(chip).toContainText('est. ≈ <0.01 credits'); // 2,500 rows at 3 credits per million
  await expect(chip).toHaveAttribute('title', /Reads up to 2,500 rows, about <0\.01 credits at 3 credits per million rows/);
  await expect(chip).toHaveAttribute('title', /a query reports no credits of its own/);

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

  // History: the user's own editor runs, read back from the server
  await page.getByRole('link', { name: 'History' }).click();
  await expect(page.locator('.card').first()).toBeVisible();
  await expect(page.locator('pre.sql').first()).toContainText('ssot__CreatedDate__c');
  await expect(page.locator('pre.sql', { hasText: 'COUNT(*) AS "rows"' })).toHaveCount(0); // row counts aren't editor runs

  // Admin (demo user is an admin here). Queries: every run, including Overview/Explorer ones
  await page.getByRole('link', { name: 'Admin' }).click();
  await page.getByRole('navigation', { name: 'Admin' }).getByRole('link', { name: 'Queries' }).click();
  await expect(page.getByRole('heading', { name: 'Audit log' })).toBeVisible();
  await expect(page.locator('table.t tbody tr').first()).toContainText('demo@example.com');
  await expect(page.locator('table.t tbody tr', { hasText: 'overview' }).first()).toBeVisible();
  await expect(page.locator('table.t tbody tr', { hasText: 'explorer' }).first()).toBeVisible();
  await expect(page.locator('table.t tbody tr', { hasText: 'failed' }).first()).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Est. credits' })).toBeVisible();
  await expect(page.getByText(/carried a cost estimate, about .* credits in total/)).toBeVisible();
  await expect(page.locator('table.t tbody tr', { hasText: '<0.01' }).first()).toBeVisible(); // the Preview run carried its estimate

  // Usage: estimated reads by person and org, with its limits stated
  await page.getByRole('navigation', { name: 'Admin' }).getByRole('link', { name: 'Usage' }).click();
  await expect(page.getByText('counts only queries run here')).toBeVisible();
  await expect(page.locator('table.t tbody tr', { hasText: 'demo@example.com' })).toContainText('mock-org.my.salesforce.com');
  await expect(page.getByText(/estimated credits/).first()).toBeVisible();

  // Users: block someone, and their open session stops working at once
  const other = await browser.newContext({ baseURL: 'http://localhost:4173' });
  const creds = { email: 'colleague@example.com', password: 'colleague-password', name: 'Colleague' };
  expect((await other.request.post('/api/auth/sign-up/email', { data: creds, headers: { origin: 'http://localhost:4173' } })).ok()).toBe(true);
  expect((await other.request.get('/api/history')).status()).toBe(200);
  await page.getByRole('navigation', { name: 'Admin' }).getByRole('link', { name: 'Users' }).click();
  await page.getByRole('link', { name: 'colleague@example.com' }).click();
  await expect(page.getByRole('heading', { name: 'Active sessions (1)' })).toBeVisible();
  await page.getByRole('button', { name: 'Block…' }).click();
  await page.getByLabel(/Reason/).fill('left the project');
  await page.getByRole('dialog').getByRole('button', { name: 'Block', exact: true }).click();
  await expect(page.getByText(/Blocked by demo@example.com .*left the project/)).toBeVisible();
  expect((await other.request.get('/api/history')).status()).toBe(401);
  expect((await other.request.post('/api/auth/sign-in/email', { data: creds, headers: { origin: 'http://localhost:4173' } })).ok()).toBe(false);
  await page.reload(); // the refused sign-in happened elsewhere
  await expect(page.locator('table.t tbody tr', { hasText: 'blocked' }).first()).toContainText('left the project');
  await page.getByRole('navigation', { name: 'Admin' }).getByRole('link', { name: 'Admin log' }).click();
  await expect(page.locator('table.t tbody tr').first()).toContainText('block');
  await page.getByRole('navigation', { name: 'Admin' }).getByRole('link', { name: 'Sign-ins' }).click();
  await page.getByLabel('Outcome').selectOption('blocked');
  await expect(page.locator('table.t tbody tr').first()).toContainText('colleague@example.com');
  await other.close();

  // Data space switch re-reads metadata
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Overview' }).click();
  await page.getByLabel('Data space').selectOption('marketing');
  await expect(tile('Data model objects')).toHaveText('2');

  // Disconnect returns to the connect screen; signing out returns to sign-in
  await page.getByRole('link', { name: 'Query' }).click();
  const tabs = await page.getByRole('tab').count();
  await page.waitForTimeout(1800); // tabs save to the account 1.5s after the last change
  await page.getByRole('button', { name: 'Disconnect' }).click();
  await expect(page.getByRole('button', { name: 'Start with sample data' })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('button', { name: 'Continue as demo user' })).toBeVisible();
  expect((await (await page.request.get('/api/history')).json()).error).toBe('unauthenticated');

  // Tabs follow the account, not the browser
  await page.evaluate(() => localStorage.clear());
  await page.getByRole('button', { name: 'Continue as demo user' }).click();
  await page.getByRole('button', { name: 'Start with sample data' }).click();
  await page.getByRole('link', { name: 'Query' }).click();
  await expect(page.getByRole('tab')).toHaveCount(tabs);
});
