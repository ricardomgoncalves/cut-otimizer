import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

const fixture = new URL('../fixtures/synthetic.parts.json', import.meta.url).pathname;
const TOE = 'w1.left.lower.c1/toeKick/0';
const RAIL = 'c1/s0.rail[1]';
const SHELF = 'c1/s0.shelf[0]';

interface ExportPart {
  id: string;
  cutWidth: number;
  width: number;
  owner: { id: string };
}
interface ExportFile {
  exportedAt: string;
  generatedItems: { id: string; label: string }[];
  parts: ExportPart[];
}

/** The synthetic export with the toe kick's Generated Item renamed (new Part id), the rail removed and the shelf narrower. */
function updatedExport(edit: (file: ExportFile) => void = () => undefined): Buffer {
  const file = JSON.parse(readFileSync(fixture, 'utf8')) as ExportFile;
  const item = file.generatedItems[0];
  if (item) {
    item.id = 'w1.left.lower.c3/toeKick';
    item.label = 'Toe Kick T3';
  }
  file.parts = file.parts.filter((p) => p.id !== RAIL);
  for (const p of file.parts) {
    if (p.id === TOE) {
      p.id = 'w1.left.lower.c3/toeKick/0';
      p.owner.id = 'w1.left.lower.c3/toeKick';
    }
    if (p.id === SHELF) {
      p.cutWidth -= 2000;
      p.width -= 2000;
    }
  }
  edit(file);
  return Buffer.from(JSON.stringify(file));
}

async function reimport(page: Page, buffer: Buffer) {
  await page.getByLabel('Re-import export…').setInputFiles({ name: 'kitchen-v2.parts.json', mimeType: 'application/json', buffer });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Load export').setInputFiles(fixture);
  await page.getByRole('button', { name: 'Plan' }).click();
});

test('re-import: diff, apply, ticks follow the new id, revert', async ({ page }) => {
  await page.getByLabel('Cut: Toe Kick T1').check();
  await reimport(page, updatedExport());

  const screen = page.getByRole('region', { name: 'Re-import' });
  await expect(screen).toContainText('Synthetic fixture (same as this Job)');
  const counts = screen.getByRole('list', { name: 'Re-import counts' });
  await expect(counts).toContainText('Changed (cut): 1');
  await expect(counts).toContainText('Removed: 1');
  await expect(counts).toContainText('Renamed: 1');
  await expect(counts).toContainText('Same: 2');
  await expect(screen.getByRole('table', { name: 'Renamed Parts' })).toContainText('Toe Kick T3');
  await expect(screen.getByRole('table', { name: 'Renamed Parts' })).toContainText('O16-1-A #1');
  await expect(screen.getByRole('table', { name: 'Removed Parts' })).toContainText('Saw · W18-1');
  await expect(screen.getByRole('table', { name: 'Changed (cut) Parts' })).toContainText('W18-1-A #2');

  await screen.getByRole('button', { name: 'Apply re-import' }).click();
  await expect(screen).toHaveCount(0);
  const stale = page.getByRole('status', { name: 'Export updated' });
  await expect(stale).toContainText('Export updated, 1 Part needs nesting');
  await expect(stale).toContainText('T1 · Shelf');
  await expect(page.getByLabel('Cut: Toe Kick T3')).toBeChecked();
  await expect(page.getByRole('table', { name: 'Re-import log' })).toContainText('kitchen-v2.parts.json');

  await page.reload();
  await expect(page.getByLabel('Cut: Toe Kick T3')).toBeChecked();
  await expect(page.getByRole('status', { name: 'Export updated' })).toBeVisible();

  await page.getByRole('button', { name: 'Revert last re-import' }).click();
  await expect(page.getByLabel('Cut: Toe Kick T1')).toBeChecked();
  await expect(page.getByRole('status', { name: 'Export updated' })).toHaveCount(0);
  await expect(page.getByRole('table', { name: 'Re-import log' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Revert last re-import' })).toHaveCount(0);
});

test('re-import: older file warning, unpairing, and Regenerate clears the stale Layouts', async ({ page }) => {
  await reimport(
    page,
    updatedExport((f) => {
      f.exportedAt = '2026-01-01T09:00:00Z';
    }),
  );
  const screen = page.getByRole('region', { name: 'Re-import' });
  await expect(screen.getByRole('status')).toContainText("before this Job's current export");

  await screen.getByRole('button', { name: 'Unpair Toe Kick T3' }).click();
  const counts = screen.getByRole('list', { name: 'Re-import counts' });
  await expect(counts).toContainText('Added: 1');
  await expect(counts).toContainText('Removed: 2');
  await expect(counts).toContainText('Renamed: 0');

  await screen.getByRole('button', { name: 'Apply re-import' }).click();
  await expect(page.getByRole('status', { name: 'Export updated' })).toContainText('2 Parts need nesting');
  await page.getByRole('status', { name: 'Export updated' }).getByRole('button', { name: 'Regenerate' }).click();
  await expect(page.getByRole('status', { name: 'Export updated' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Revert last re-import' })).toHaveCount(0);
  await expect(page.getByRole('table', { name: 'Parts of O16' })).toContainText('Toe Kick T3');
});
