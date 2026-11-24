import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';

const fixture = new URL('../fixtures/synthetic.parts.json', import.meta.url).pathname;

async function downloadZip(page: Page): Promise<Record<string, string>> {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download DXFs' }).click(),
  ]);
  const path = await download.path();
  const files = unzipSync(new Uint8Array(readFileSync(path)));
  return Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, strFromU8(bytes)]));
}

async function loadAndPlan(page: Page) {
  await page.getByLabel('Load export').setInputFiles(fixture);
  await page.getByRole('button', { name: 'Plan' }).click();
}

async function setClampMargin(page: Page, mm: string) {
  await page.getByRole('button', { name: 'Machine settings' }).click();
  await page.getByLabel('Clamp margin (mm)').fill(mm);
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByRole('status')).toContainText('Settings saved');
  await page.getByRole('button', { name: 'Job', exact: true }).click();
}

test('Machine settings show the defaults and are kept in the browser', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Machine settings' }).click();

  await expect(page.getByLabel('Bed length (mm)')).toHaveValue('1300');
  await expect(page.getByLabel('Bed width (mm)')).toHaveValue('1300');
  await expect(page.getByLabel('Clamp margin (mm)')).toHaveValue('40');
  await expect(page.getByLabel('Bit diameter (mm)')).toHaveValue('6');
  await expect(page.getByLabel('Saw kerf (mm)')).toHaveValue('3.2');
  await expect(page.getByLabel('Edge trim (mm)')).toHaveValue('0');
  await expect(page.getByLabel('Min CNC width (mm)')).toHaveValue('50');
  await expect(page.getByLabel('Min Offcut size (mm)')).toHaveValue('150');
  await expect(page.getByLabel('pocket')).not.toBeChecked();

  await page.getByLabel('Clamp margin (mm)').fill('35');
  await page.getByLabel('pocket').check();
  await page.getByLabel('Fence height note').fill('Fence at 12 mm');
  await page.getByRole('button', { name: 'Save settings' }).click();

  await page.reload();
  await page.getByRole('button', { name: 'Machine settings' }).click();
  await expect(page.getByLabel('Clamp margin (mm)')).toHaveValue('35');
  await expect(page.getByLabel('pocket')).toBeChecked();
  await expect(page.getByLabel('Fence height note')).toHaveValue('Fence at 12 mm');
});

test('settings that leave no room on the bed are not saved', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Machine settings' }).click();
  await page.getByLabel('Clamp margin (mm)').fill('700');
  await page.getByRole('button', { name: 'Save settings' }).click();

  await expect(page.getByRole('alert')).toContainText('Clamp margin leaves no room on the bed');
  await page.reload();
  await page.getByRole('button', { name: 'Machine settings' }).click();
  await expect(page.getByLabel('Clamp margin (mm)')).toHaveValue('40');
});

test("a Job's DXFs keep its settings snapshot until it is regenerated", async ({ page }) => {
  await page.goto('/');
  await loadAndPlan(page);
  await expect(page.getByRole('img', { name: 'Layout of W18-1-A' })).toBeVisible();
  const before = await downloadZip(page);

  await setClampMargin(page, '100');
  await expect(page.getByRole('status')).toContainText('Clamp margin');
  expect(await downloadZip(page)).toEqual(before);

  await page.getByRole('button', { name: 'Regenerate' }).click();
  await expect(page.getByRole('status')).toHaveCount(0);
  const after = await downloadZip(page);
  // A 100 mm clamp margin leaves less room, so the Layout changes.
  expect(after['W18-1-A.side-a.dxf']).not.toEqual(before['W18-1-A.side-a.dxf']);
});

test('an edited Sheet code shows up in Blank ids and file names', async ({ page }) => {
  await page.goto('/');
  await loadAndPlan(page);

  const code = page.getByLabel('Sheet code for White melamine chipboard 18');
  await expect(code).toHaveValue('W18');
  await code.fill('wh18');
  await code.press('Enter');

  // Only Regenerate changes the Plan.
  const waiting = page.getByRole('status', { name: 'Changes wait for Regenerate' });
  await expect(waiting).toContainText('Sheet code WH18');
  await expect(page.getByRole('img', { name: 'Layout of W18-1-A' })).toBeVisible();
  await waiting.getByRole('button', { name: 'Regenerate' }).click();
  await expect(page.getByRole('img', { name: 'Layout of WH18-1-A' })).toBeVisible();
  expect(Object.keys(await downloadZip(page)).filter((n) => n.endsWith('.side-a.dxf'))).toEqual([
    'WH18-1-A.side-a.dxf',
    'O16-1-A.side-a.dxf',
  ]);

  await code.fill('O16');
  await code.press('Enter');
  await expect(page.getByRole('alert')).toContainText('O16 is already the code of Oak MDF 16.');
  await expect(page.getByRole('img', { name: 'Layout of WH18-1-A' })).toBeVisible();
});
