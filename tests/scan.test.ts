import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { importExport } from '../src/core/import/index.ts';
import { generateJob, type Job } from '../src/core/job.ts';
import { apply, scan, scanPayload, type Progress, type ScanJob } from '../src/core/progress.ts';
import { DEFAULT_SETTINGS } from '../src/core/settings.ts';

// The synthetic fixture (see tests/progress.test.ts): the door has Cut, Side B and Banded; the rail only Cut.
const SHELF = 'c1/s0.shelf[0]';
const RAIL = 'c1/s0.rail[1]';
const DOOR = 'c1/s0.door.leaf[0]';
const T1 = '2026-11-24T10:00:00.000Z';
const T2 = '2026-11-24T11:00:00.000Z';

function syntheticJob(): Job {
  const { model } = importExport(JSON.parse(readFileSync(new URL('../fixtures/synthetic.parts.json', import.meta.url), 'utf8')));
  if (!model) throw new Error('synthetic fixture must import');
  return generateJob(model, DEFAULT_SETTINGS);
}

const job = syntheticJob();
const scanJob: ScanJob = { shortId: 'A1B2', aliases: {} };

describe('Scan mode', () => {
  it('ticks the chosen Step on the scanned Part', () => {
    const outcome = scan(job, scanJob, {}, { payload: 'A1B2:c1/s0.rail[1]', step: 'cut', at: T1 });
    expect(outcome).toEqual({ kind: 'ticked', partId: RAIL, step: 'cut', progress: { [RAIL]: { cut: T1 } }, openEarlier: [] });
  });

  it('reads the payload a label carries, short id in any case', () => {
    expect(scanPayload('A1B2', DOOR)).toBe('A1B2:c1/s0.door.leaf[0]');
    const outcome = scan(job, scanJob, {}, { payload: ` a1b2:${DOOR}\n`, step: 'cut', at: T1 });
    expect(outcome).toMatchObject({ kind: 'ticked', partId: DOOR });
  });

  it('rejects a label from another Job, and ticks nothing', () => {
    const payload = scanPayload('FFFF', RAIL);
    expect(scan(job, scanJob, {}, { payload, step: 'cut', at: T1 })).toEqual({ kind: 'rejected', reason: 'otherJob', payload });
  });

  it('rejects text that is not a label payload, and Parts this Job does not have', () => {
    expect(scan(job, scanJob, {}, { payload: 'hello', step: 'cut', at: T1 })).toMatchObject({ reason: 'unreadable' });
    expect(scan(job, scanJob, {}, { payload: 'A1B2:', step: 'cut', at: T1 })).toMatchObject({ reason: 'unreadable' });
    expect(scan(job, scanJob, {}, { payload: 'A1B2:c1/gone', step: 'cut', at: T1 })).toEqual({
      kind: 'rejected',
      reason: 'unknownPart',
      payload: 'A1B2:c1/gone',
    });
  });

  it('warns and ticks nothing when the Part has no such Step', () => {
    const progress: Progress = { [RAIL]: { cut: T1 } };
    const outcome = scan(job, scanJob, progress, { payload: scanPayload('A1B2', RAIL), step: 'banded', at: T2 });
    expect(outcome).toEqual({ kind: 'notTicked', reason: 'noSuchStep', partId: RAIL, step: 'banded' });
  });

  it('warns and keeps the first time when the Step is already ticked', () => {
    const progress: Progress = { [SHELF]: { cut: T1 } };
    const outcome = scan(job, scanJob, progress, { payload: scanPayload('A1B2', SHELF), step: 'cut', at: T2 });
    expect(outcome).toEqual({ kind: 'notTicked', reason: 'alreadyTicked', partId: SHELF, step: 'cut' });
  });

  it('ticks anyway, and warns, when an earlier Step is still open', () => {
    // The door's Steps: Cut, Side B, Banded. Only Cut is ticked.
    const progress: Progress = { [DOOR]: { cut: T1 } };
    const outcome = scan(job, scanJob, progress, { payload: scanPayload('A1B2', DOOR), step: 'banded', at: T2 });
    expect(outcome).toEqual({
      kind: 'ticked',
      partId: DOOR,
      step: 'banded',
      progress: { [DOOR]: { cut: T1, banded: T2 } },
      openEarlier: ['sideB'],
    });
    // Later Steps still open don't matter.
    const cut = scan(job, scanJob, {}, { payload: scanPayload('A1B2', DOOR), step: 'cut', at: T1 });
    expect(cut).toMatchObject({ kind: 'ticked', openEarlier: [] });
  });

  it('resolves old Part ids through the alias table, across several re-imports', () => {
    const aliased: ScanJob = { shortId: 'A1B2', aliases: { 'c1/oldRail': 'c1/olderRail', 'c1/olderRail': RAIL, 'c1/loop': 'c1/loop' } };
    expect(scan(job, aliased, {}, { payload: 'A1B2:c1/oldRail', step: 'cut', at: T1 })).toMatchObject({
      kind: 'ticked',
      partId: RAIL,
      progress: { [RAIL]: { cut: T1 } },
    });
    expect(scan(job, aliased, {}, { payload: 'A1B2:c1/loop', step: 'cut', at: T1 })).toMatchObject({ reason: 'unknownPart' });
    // A live id is never redirected.
    const progress = apply(job, {}, { kind: 'tick', partId: SHELF, step: 'cut', at: T1 });
    expect(scan(job, aliased, progress, { payload: scanPayload('A1B2', SHELF), step: 'cut', at: T2 })).toMatchObject({
      reason: 'alreadyTicked',
    });
  });
});
