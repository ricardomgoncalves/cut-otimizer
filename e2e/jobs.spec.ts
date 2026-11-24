import { readFileSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

const fixture = new URL('../fixtures/synthetic.parts.json', import.meta.url).pathname;
const today = () => new Date().toISOString().slice(0, 10);

async function createJob(page: Page) {
  await page.goto('/');
  await page.getByLabel('Load export').setInputFiles(fixture);
  await page.getByRole('button', { name: 'Plan' }).click();
  await expect(page.getByRole('img', { name: 'Layout of W18-1-A' })).toBeVisible();
}

async function downloadJob(page: Page): Promise<{ name: string; text: string }> {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download Job' }).click(),
  ]);
  return { name: download.suggestedFilename(), text: readFileSync(await download.path(), 'utf8') };
}

test('a new Job is saved in the browser and comes back after a reload', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Load export').setInputFiles(fixture);
  const jobs = page.getByRole('region', { name: 'Jobs' });
  await expect(jobs).toContainText(`Synthetic fixture ${today()}`);

  // Saved before it is planned: the import summary comes back.
  await page.reload();
  await expect(page.getByRole('region', { name: 'Import summary' })).toBeVisible();
  await page.getByRole('button', { name: 'Plan' }).click();
  await expect(page.getByRole('img', { name: 'Layout of W18-1-A' })).toBeVisible();

  await page.getByLabel('Sheet code for White melamine chipboard 18').fill('WH18');
  await page.getByLabel('Sheet code for White melamine chipboard 18').press('Enter');
  await page.getByRole('status', { name: 'Changes wait for Regenerate' }).getByRole('button', { name: 'Regenerate' }).click();
  await expect(page.getByRole('img', { name: 'Layout of WH18-1-A' })).toBeVisible();

  await page.reload();

  await expect(page.getByRole('img', { name: 'Layout of WH18-1-A' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Layout of O16-1-A' })).toBeVisible();
  await expect(jobs).toContainText(`Synthetic fixture ${today()}`);
});

test('rename, archive and delete Jobs from the Job list', async ({ page }) => {
  await createJob(page);
  await page.getByLabel('Job name').fill('Kitchen carcasses');
  await page.getByLabel('Job name').press('Enter');
  const jobs = page.getByRole('region', { name: 'Jobs' });
  await expect(jobs).toContainText('Kitchen carcasses');

  await page.reload();
  await expect(page.getByLabel('Job name')).toHaveValue('Kitchen carcasses');

  await jobs.getByRole('button', { name: 'Archive Kitchen carcasses' }).click();
  await expect(jobs.getByText('Kitchen carcasses')).toBeHidden();
  await jobs.getByLabel('Show archived Jobs').check();
  await expect(jobs.getByText('Kitchen carcasses')).toBeVisible();

  await jobs.getByRole('button', { name: 'Delete Kitchen carcasses' }).click();
  await jobs.getByRole('button', { name: 'Yes, delete Kitchen carcasses' }).click();
  await expect(jobs.getByText('Kitchen carcasses')).toBeHidden();
  await expect(page.getByRole('img', { name: 'Layout of W18-1-A' })).toBeHidden();

  await page.reload();
  await expect(page.getByRole('region', { name: 'Jobs' })).toContainText('No Jobs yet');
});

test('Download Job and Open Job move a Job to another browser', async ({ page, browser }, testInfo) => {
  await createJob(page);
  await page.getByLabel('Sheet code for White melamine chipboard 18').fill('WH18');
  await page.getByLabel('Sheet code for White melamine chipboard 18').press('Enter');
  await page.getByRole('status', { name: 'Changes wait for Regenerate' }).getByRole('button', { name: 'Regenerate' }).click();
  await expect(page.getByRole('img', { name: 'Layout of WH18-1-A' })).toBeVisible();

  const file = await downloadJob(page);
  expect(file.name).toBe(`Synthetic-fixture-${today()}.job.json`);
  const saved = testInfo.outputPath('saved.job.json');
  writeFileSync(saved, file.text);

  const other = await browser.newPage();
  await other.goto('/');
  await other.getByLabel('Open Job').setInputFiles(saved);
  await expect(other.getByRole('img', { name: 'Layout of WH18-1-A' })).toBeVisible();
  await expect(other.getByRole('region', { name: 'Jobs' })).toContainText(`Synthetic fixture ${today()}`);
  await other.reload();
  await expect(other.getByRole('img', { name: 'Layout of WH18-1-A' })).toBeVisible();
  await other.close();
});

test('Open Job never overwrites newer work, and asks before replacing an older saved copy', async ({ page, browser }, testInfo) => {
  await createJob(page);
  const first = testInfo.outputPath('first.job.json');
  writeFileSync(first, (await downloadJob(page)).text);
  await page.getByLabel('Job name').fill('Kitchen carcasses');
  await page.getByLabel('Job name').press('Enter');
  await expect(page.getByRole('region', { name: 'Jobs' })).toContainText('Kitchen carcasses');
  const second = testInfo.outputPath('second.job.json');
  writeFileSync(second, (await downloadJob(page)).text);

  // The saved copy changed after the first file: refused, nothing lost.
  await page.getByLabel('Open Job').setInputFiles(first);
  await expect(page.getByRole('alert')).toContainText('changed after this file');
  await page.reload();
  await expect(page.getByLabel('Job name')).toHaveValue('Kitchen carcasses');

  // Another browser has the older copy: the newer file replaces it only after asking.
  const other = await browser.newPage();
  await other.goto('/');
  await other.getByLabel('Open Job').setInputFiles(first);
  await expect(other.getByLabel('Job name')).toHaveValue(`Synthetic fixture ${today()}`);
  await other.getByLabel('Open Job').setInputFiles(second);
  const ask = other.getByRole('alertdialog', { name: 'Confirm replace' });
  await ask.getByRole('button', { name: 'Keep saved copy' }).click();
  await expect(other.getByLabel('Job name')).toHaveValue(`Synthetic fixture ${today()}`);
  await other.getByLabel('Open Job').setInputFiles(second);
  await ask.getByRole('button', { name: 'Replace' }).click();
  await expect(other.getByLabel('Job name')).toHaveValue('Kitchen carcasses');
  await other.close();
});

test('a .job.json whose Plan is from an older version opens as stale until Regenerate', async ({ page, browser }, testInfo) => {
  await createJob(page);
  const file = JSON.parse((await downloadJob(page)).text) as {
    plan: { sideB?: unknown; manualOps?: unknown; sheets: { boards: Record<string, unknown>[] }[] };
  };
  delete file.plan.sideB;
  delete file.plan.manualOps;
  for (const sheet of file.plan.sheets) {
    for (const board of sheet.boards) {
      delete board['sawParts'];
      delete board['offcuts'];
      delete board['cuts'];
    }
  }
  const older = testInfo.outputPath('older.job.json');
  writeFileSync(older, JSON.stringify(file));

  const other = await browser.newPage();
  await other.goto('/');
  await other.getByLabel('Open Job').setInputFiles(older);
  const box = other.getByRole('status', { name: 'Plan from an older version' });
  await expect(box).toBeVisible();
  await expect(other.getByRole('img', { name: 'Layout of W18-1-A' })).toBeVisible();
  await box.getByRole('button', { name: 'Regenerate' }).click();
  await expect(box).toBeHidden();
  await expect(other.getByRole('region', { name: 'Side B' })).toBeVisible();
  await other.close();
});

test('a .job.json from a newer version is refused', async ({ page }, testInfo) => {
  await createJob(page);
  const file = await downloadJob(page);
  const newer = testInfo.outputPath('newer.job.json');
  writeFileSync(newer, JSON.stringify({ ...(JSON.parse(file.text) as object), jobFormat: 2 }));

  await page.getByLabel('Open Job').setInputFiles(newer);
  await expect(page.getByRole('alert')).toContainText('saved by a newer version of Cut Optimizer (jobFormat 2)');
});
