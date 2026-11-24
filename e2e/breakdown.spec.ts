import { expect, test, type Page } from '@playwright/test';

const fixture = new URL('../fixtures/synthetic.parts.json', import.meta.url).pathname;

async function loadAndPlan(page: Page) {
  await page.goto('/');
  await page.getByLabel('Load export').setInputFiles(fixture);
  await page.getByRole('button', { name: 'Plan' }).click();
}

test('the Breakdown view shows each Board with numbered rips and crosscuts, Saw Parts and Offcuts', async ({
  page,
}) => {
  await loadAndPlan(page);

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
  await expect(drawing.locator('text.piece-label', { hasText: 'T1 · Left side' })).toHaveCount(1);
  await expect(drawing.locator('text.piece-label', { hasText: 'Keep' }).first()).toBeVisible();
});

test('the narrow op-less Part is a Saw Part, and toggling it to CNC nests it with a warning', async ({
  page,
}) => {
  await loadAndPlan(page);

  const parts = page.getByRole('table', { name: 'Parts of W18' });
  const rail = parts.getByRole('row', { name: /T1 · Rail/i });
  await expect(rail).toContainText('W18-1 saw (narrow)');
  await expect(rail).toContainText('narrow');

  // The 2100 mm side can't go to the CNC.
  await expect(
    parts.getByRole('row', { name: /T1 · Left side/ }).getByRole('checkbox', { name: 'Saw' }),
  ).toBeDisabled();

  await rail.getByRole('checkbox', { name: 'Saw' }).uncheck();

  // Only Regenerate changes the Plan.
  const waiting = page.getByRole('status', { name: 'Changes wait for Regenerate' });
  await expect(waiting).toContainText('T1 · Rail to the CNC');
  await expect(rail).toContainText('W18-1 saw (narrow)');
  await waiting.getByRole('button', { name: 'Regenerate' }).click();
  await expect(waiting).toHaveCount(0);

  await expect(rail).toContainText(/W18-1-[A-Z] #\d/);
  await expect(rail).toContainText('narrow: check tabs');
  // The Layout view marks it too.
  await expect(page.locator('svg g.narrow title', { hasText: /Rail/i })).toHaveCount(1);
});
