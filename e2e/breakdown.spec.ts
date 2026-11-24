import { expect, test } from '@playwright/test';

const fixture = new URL('../fixtures/synthetic.parts.json', import.meta.url).pathname;

test('the Breakdown view shows each Board with numbered rips and crosscuts, Saw Parts and Offcuts', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByLabel('Load export').setInputFiles(fixture);

  const drawing = page.getByRole('img', { name: 'Breakdown of W18 Board 1' });
  await expect(drawing).toBeVisible();

  // The cut list and the drawing carry the same numbers: rips 1, 2…, crosscuts 1a, 1b….
  const cuts = page.getByRole('table', { name: 'Cuts of W18 Board 1' });
  const labels = await cuts.locator('tbody tr th').allTextContents();
  expect(labels).toEqual(['1', '1a', '2', '2a', '3', '3a']);
  for (const label of labels) {
    await expect(drawing.locator('text.cut-label', { hasText: new RegExp(`^${label}$`) })).toHaveCount(1);
  }
  await expect(cuts.locator('tbody tr').first()).toContainText('rip');

  // Pieces are named: the Blank by its id, Saw Parts by their Part, kept Offcuts marked Keep.
  await expect(drawing.locator('text.piece-label', { hasText: 'W18-1-A' })).toHaveCount(1);
  await expect(drawing.locator('text.piece-label', { hasText: 'c1/leftSide' })).toHaveCount(1);
  await expect(drawing.locator('text.piece-label', { hasText: 'Keep' }).first()).toBeVisible();
});

test('the narrow op-less Part is a Saw Part, and toggling it to CNC nests it with a warning', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByLabel('Load export').setInputFiles(fixture);

  const parts = page.getByRole('table', { name: 'Parts of W18' });
  const rail = parts.getByRole('row', { name: /c1\/s0\.rail\[1\]/ });
  await expect(rail).toContainText('Saw · Board 1');
  await expect(rail).toContainText('narrow');

  // The 2100 mm side can't go to the CNC.
  await expect(
    parts.getByRole('row', { name: /c1\/leftSide/ }).getByRole('checkbox', { name: 'Saw' }),
  ).toBeDisabled();

  await rail.getByRole('checkbox', { name: 'Saw' }).uncheck();

  await expect(rail).toContainText(/W18-1-[A-Z] #\d/);
  await expect(rail).toContainText('narrow: check tabs');
  // The Layout view marks it too.
  await expect(page.locator('svg g.narrow title', { hasText: 'c1/s0.rail[1]' })).toHaveCount(1);
});
