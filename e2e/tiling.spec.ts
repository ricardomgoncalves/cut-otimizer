import { expect, test } from '@playwright/test';

// A tall cabinet whose 2000 × 600 door has hinge cups: longer than the 1300 mm bed, so with Allow
// tiling on it goes on a Tiled Blank that CAM cuts in Tiles.
const fixture = new URL('../fixtures/long-door.parts.json', import.meta.url).pathname;

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Load export').setInputFiles(fixture);
  await page.getByRole('button', { name: 'Plan' }).click();
});

test('a door longer than the bed goes on a Tiled Blank, and the cut sheet says it is cut in Tiles', async ({ page }) => {
  const parts = page.getByRole('table', { name: 'Parts of W18' });
  const door = parts.getByRole('row').filter({ hasText: 'T1 · Door' });
  await expect(door).toContainText('W18-1-A #');
  await expect(door.getByLabel('Saw')).not.toBeChecked();
  await expect(page.getByText('Tiled Blank: longer than the bed, CAM cuts it in Tiles')).toHaveCount(1);
  // The op-less side is longer than the bed too: a Saw Part by default, but the toggle works.
  const side = parts.getByRole('row').filter({ hasText: 'T1 · Left side' });
  await expect(side).toContainText('longer than the bed');
  await expect(side.getByLabel('Saw')).toBeEnabled();

  const sheet = page.getByRole('region', { name: 'Cut sheet' });
  await sheet.getByRole('button', { name: 'Cut sheet' }).click();
  const sideA = sheet.getByRole('img', { name: /^Cut sheet page/ }).filter({ hasText: 'CNC Side A · W18-1-A' });
  await expect(sideA).toContainText('Tiled Blank, ');
  await expect(sideA).toContainText('longer than the bed (1300 mm): cut in Tiles');
  const sideB = sheet.getByRole('img', { name: /^Cut sheet page/ }).filter({ hasText: 'CNC Side B batch' });
  await expect(sideB).toContainText('Tiled Part, 1998 mm long, longer than the bed (1300 mm): cut in Tiles');
});

test('with Allow tiling off, the door is a Saw Part again after Regenerate', async ({ page }) => {
  await page.getByRole('button', { name: 'Machine settings' }).click();
  await expect(page.getByLabel('Allow tiling')).toBeChecked();
  await page.getByLabel('Allow tiling').uncheck();
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByRole('status')).toContainText('Settings saved');
  await page.getByRole('button', { name: 'Job', exact: true }).click();

  await expect(page.getByText(/different Machine settings \(Allow tiling\)/)).toBeVisible();
  await page.getByRole('button', { name: 'Regenerate' }).click();

  const door = page.getByRole('table', { name: 'Parts of W18' }).getByRole('row').filter({ hasText: 'T1 · Door' });
  await expect(door).toContainText('bigger than the bed');
  await expect(door.getByLabel('Saw')).toBeDisabled();
});
