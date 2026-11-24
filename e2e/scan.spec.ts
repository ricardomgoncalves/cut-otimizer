import { expect, test, type Page } from '@playwright/test';

const fixture = new URL('../fixtures/synthetic.parts.json', import.meta.url).pathname;

async function openScanMode(page: Page): Promise<string> {
  await page.goto('/');
  await page.getByLabel('Load export').setInputFiles(fixture);
  await page.getByRole('button', { name: 'Plan' }).click();
  const shortId = (await page.getByText(/^Short id/).locator('code').textContent()) ?? '';
  await page.getByRole('button', { name: 'Scan mode' }).click();
  return shortId;
}

/** A wedge scanner: the payload as a fast burst of keys, then Enter, with no field focused. */
async function wedgeScan(page: Page, payload: string) {
  await page.keyboard.type(payload);
  await page.keyboard.press('Enter');
}

test('a wedge scan ticks the chosen Step and shows the feedback', async ({ page }) => {
  const shortId = await openScanMode(page);
  await page.getByLabel('Banded').check();
  await expect(page.getByRole('heading', { name: 'Scanning: Banded' })).toBeVisible();
  // Nothing is focused, so the keys only reach the wedge listener.
  await page.locator('h2').click();

  await wedgeScan(page, `${shortId}:c1/s0.shelf[0]`);
  const feedback = page.getByRole('status', { name: 'Scan feedback' });
  await expect(feedback.locator('.scan-headline')).toHaveText('Banded ticked');
  await expect(feedback.locator('.scan-part')).toHaveText('T1 · Shelf');
  await expect(feedback.locator('.scan-where')).toHaveText('W18-1-A #2');
  await expect(feedback.locator('.scan-owner')).toHaveText('T1: 0 / 4 Done');
  // Ticked anyway, with a warning: the shelf is not Cut yet.
  await expect(feedback.locator('.scan-warning')).toHaveText('Still open before Banded: Cut');

  // The same label again: already ticked, nothing changes.
  await wedgeScan(page, `${shortId}:c1/s0.shelf[0]`);
  await expect(feedback.locator('.scan-headline')).toHaveText('Banded was already ticked: nothing ticked');

  // Cut on the rail (a Saw Part with only Cut) makes it Done.
  await page.getByLabel('Cut', { exact: true }).check();
  await wedgeScan(page, `${shortId}:c1/s0.rail[1]`);
  await expect(feedback.locator('.scan-headline')).toHaveText('Cut ticked');
  await expect(feedback.locator('.scan-owner')).toHaveText('T1: 1 / 4 Done');

  await page.getByRole('button', { name: 'Job', exact: true }).click();
  await expect(page.getByLabel('Banded: T1 · Shelf')).toBeChecked();
  await expect(page.getByLabel('Cut: T1 · Rail')).toBeChecked();
  await expect(page.getByLabel('Cut: T1 · Shelf')).not.toBeChecked();

  // The ticks were saved.
  await page.reload();
  await expect(page.getByLabel('Banded: T1 · Shelf')).toBeChecked();
});

test('typing at a person’s speed is not a scan, and labels from another Job are rejected', async ({ page }) => {
  const shortId = await openScanMode(page);
  const feedback = page.getByRole('status', { name: 'Scan feedback' });

  await page.keyboard.type(`${shortId}:c1/s0.rail[1]`, { delay: 120 });
  await page.keyboard.press('Enter');
  await expect(feedback).toHaveText('Waiting for a scan…');

  const other = shortId === 'FFFF' ? 'EEEE' : 'FFFF';
  await wedgeScan(page, `${other}:c1/s0.rail[1]`);
  await expect(feedback.locator('.scan-headline')).toHaveText('Not this Job: this label is from another Job');

  await page.getByRole('button', { name: 'Job', exact: true }).click();
  await expect(page.getByLabel('Cut: T1 · Rail')).not.toBeChecked();
});
