import { expect, test } from '@playwright/test';

const LIVE = 'http://localhost:4174';
const KEY = 'USERKEY1234567890';
const SECRET = 'super-secret-consumer-value';

test('user-supplied consumer key and secret: encrypted at rest, never in a URL', async ({ page, context }) => {
  const urls: string[] = [];
  page.on('request', (r) => urls.push(r.url()));
  // Don't leave the box: stand in for Salesforce's authorize page.
  await context.route('https://login.salesforce.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: 'salesforce' }));

  await page.goto(LIVE);
  await page.getByLabel('Consumer key').fill(KEY);
  await page.getByLabel('Consumer secret (optional)').fill(SECRET);
  await page.getByLabel(/Remember on this device/).check();
  await page.getByRole('button', { name: 'Connect to Salesforce' }).click();

  await page.waitForURL(/login\.salesforce\.com\/services\/oauth2\/authorize/);
  const authorize = new URL(page.url());
  expect(authorize.searchParams.get('client_id')).toBe(KEY);
  expect(authorize.searchParams.get('code_challenge_method')).toBe('S256');
  expect(urls.some((u) => u.includes(SECRET))).toBe(false);

  // Back on our origin: the browser keeps only ciphertext.
  await page.goto(LIVE);
  const stored = await page.evaluate(() => localStorage.getItem('d360:creds'));
  expect(stored).toBeTruthy();
  expect(stored).not.toContain(SECRET);
  expect(JSON.parse(stored!).clientId).toBe(KEY);
  const cookies = JSON.stringify(await context.cookies());
  expect(cookies).not.toContain(SECRET);

  // The saved credentials are used without retyping the secret.
  await expect(page.getByText(KEY)).toBeVisible();
  await expect(page.getByLabel('Consumer secret (optional)')).toHaveCount(0);
  await page.getByRole('button', { name: 'Connect to Salesforce' }).click();
  await page.waitForURL(/login\.salesforce\.com\/services\/oauth2\/authorize/);
  expect(new URL(page.url()).searchParams.get('client_id')).toBe(KEY);

  // Forgetting clears the browser copy.
  await page.goto(LIVE);
  await page.getByRole('button', { name: /Forget and enter different credentials/ }).click();
  expect(await page.evaluate(() => localStorage.getItem('d360:creds'))).toBeNull();
  await expect(page.getByLabel('Consumer key')).toBeVisible();
});

test('an unreadable saved blob is dropped with a clear message', async ({ page }) => {
  await page.goto(LIVE);
  await page.evaluate(() => localStorage.setItem('d360:creds', JSON.stringify({ clientId: 'OLDKEY1234567890', saved: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' })));
  await page.reload();
  await page.getByRole('button', { name: 'Connect to Salesforce' }).click();
  await expect(page.getByRole('alert')).toContainText('Saved credentials can no longer be read');
  expect(await page.evaluate(() => localStorage.getItem('d360:creds'))).toBeNull();
  await expect(page.getByLabel('Consumer key')).toBeVisible();
});
