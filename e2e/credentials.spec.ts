import { expect, test } from '@playwright/test';
import { liveSignIn } from './live-session';

const LIVE = 'http://localhost:4174';
const KEY = 'USERKEY1234567890';
const SECRET = 'super-secret-consumer-value';

test('signed-out visitors see only the sign-in screen', async ({ page }) => {
  await page.goto(LIVE);
  await expect(page.getByText('No sign-in provider is configured')).toBeVisible();
  await expect(page.getByLabel('Consumer key')).toHaveCount(0);
  expect((await page.request.post(`${LIVE}/auth/credentials`, { headers: { 'x-d360': '1' }, data: { clientId: KEY } })).status()).toBe(401);
});

test('user-supplied consumer key and secret: saved encrypted to the account, never in a URL', async ({ page, context }) => {
  await liveSignIn(context, LIVE, 'consultant@example.com');
  const urls: string[] = [];
  page.on('request', (r) => urls.push(r.url()));
  // Don't leave the box: stand in for Salesforce's authorize page.
  for (const host of ['https://login.salesforce.com/**', 'https://test.salesforce.com/**']) {
    await context.route(host, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: 'salesforce' }));
  }

  await page.goto(LIVE);
  await expect(page.getByText('consultant@example.com')).toBeVisible();
  // The preferred path is spelled out before the user types anything.
  await expect(page.getByText('Recommended: PKCE, no secret.')).toBeVisible();
  await expect(page.getByText(`${LIVE}/auth/callback`)).toBeVisible();
  await expect(page.getByText(/less safe than PKCE/)).toHaveCount(0);
  await page.getByLabel('Consumer key').fill(KEY);
  await page.getByLabel(/Consumer secret/).fill(SECRET);
  await expect(page.getByText(/less safe than PKCE/)).toBeVisible();
  await page.getByRole('radiogroup', { name: 'Org type' }).getByText('Sandbox').click();
  await page.getByLabel(/Save this connection to my account/).check();
  await page.getByLabel('Name').fill('Acme sandbox');
  await page.getByRole('button', { name: 'Connect to Salesforce' }).click();

  await page.waitForURL(/test\.salesforce\.com\/services\/oauth2\/authorize/);
  const authorize = new URL(page.url());
  expect(authorize.searchParams.get('client_id')).toBe(KEY);
  expect(authorize.searchParams.get('code_challenge_method')).toBe('S256');
  expect(urls.some((u) => u.includes(SECRET))).toBe(false);

  // Back on our origin: nothing in the browser, and the account lists it without the secret.
  await page.goto(LIVE);
  expect(JSON.stringify(await page.evaluate(() => ({ ...localStorage })))).not.toContain(KEY);
  expect(JSON.stringify(await context.cookies())).not.toContain(SECRET);
  const listed = await (await page.request.get(`${LIVE}/api/credentials`)).text();
  expect(listed).toContain('Acme sandbox');
  expect(listed).not.toContain(SECRET);

  // A saved connection needs nothing else: no org type, no setup notes, no secret, and never the whole key.
  const saved = page.getByRole('radiogroup', { name: 'Saved connections' });
  await expect(saved).toContainText('Acme sandbox · Sandbox · key USERKE…7890 · with secret');
  await expect(page.getByText(KEY)).toHaveCount(0);
  expect(await page.content()).not.toContain(KEY);
  await expect(page.getByRole('radiogroup', { name: 'Org type' })).toHaveCount(0);
  await expect(page.getByText('Recommended: PKCE, no secret.')).toHaveCount(0);
  await expect(page.getByLabel(/Consumer secret/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Connect to Acme sandbox' }).click();
  await page.waitForURL(/test\.salesforce\.com\/services\/oauth2\/authorize/);
  expect(new URL(page.url()).searchParams.get('client_id')).toBe(KEY);

  // "New connection" brings the full form back; deleting removes the saved one from the account.
  await page.goto(LIVE);
  await saved.getByText('New connection…').click();
  await expect(page.getByText('Recommended: PKCE, no secret.')).toBeVisible();
  await saved.getByText('Acme sandbox').click();
  await page.getByRole('button', { name: 'Delete “Acme sandbox”' }).click();
  await expect(page.getByLabel('Consumer key')).toBeVisible();
  expect(await (await page.request.get(`${LIVE}/api/credentials`)).json()).toEqual([]);
});

test('credentials saved by an older build in localStorage are removed', async ({ page, context }) => {
  await liveSignIn(context, LIVE, 'consultant@example.com');
  await page.goto(LIVE);
  await page.evaluate(() => localStorage.setItem('d360:creds', JSON.stringify({ clientId: 'OLDKEY1234567890', saved: 'AAAA' })));
  await page.reload();
  await expect(page.getByLabel('Consumer key')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('d360:creds'))).toBeNull();
});
