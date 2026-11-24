import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { partLocations } from '../src/core/documents/index.ts';
import { labelOrder } from '../src/core/documents/labels.ts';
import { partRunOrder } from '../src/core/documents/work.ts';
import { importExport } from '../src/core/import/index.ts';
import { generateJob, regenerate, remake } from '../src/core/job.ts';
import { DEFAULT_SETTINGS } from '../src/core/settings.ts';

const SHELF = 'c1/s0.shelf[0]';

describe('documents after a Remake', () => {
  const { model } = importExport(
    JSON.parse(readFileSync(new URL('../fixtures/synthetic.parts.json', import.meta.url), 'utf8')),
  );
  if (!model) throw new Error('synthetic fixture must import');
  const marked = remake(generateJob(model, DEFAULT_SETTINGS), { [SHELF]: { cut: '2026-11-24T10:00:00.000Z' } }, SHELF);
  if ('error' in marked) throw new Error(marked.error);
  const job = regenerate(marked.job, DEFAULT_SETTINGS, marked.progress);

  it('list the Remake Part once, where it is cut again, not on its old Blank', () => {
    expect(partRunOrder(job.plan).filter((id) => id === SHELF)).toHaveLength(1);
    expect(partLocations(job.plan).get(SHELF)).toBe('W18-1-B #1');
    expect(labelOrder(job.plan).filter((e) => e.partId === SHELF)).toEqual([{ partId: SHELF, where: 'W18-1-B #1' }]);
  });

  it('list a Part waiting for nesting at the end of its Sheet, as needing nesting', () => {
    expect(partRunOrder(marked.job.plan)).toContain(SHELF);
    expect(partLocations(marked.job.plan).get(SHELF)).toBe('needs nesting');
  });
});
