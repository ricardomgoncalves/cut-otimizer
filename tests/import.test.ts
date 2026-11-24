import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { importExport } from '../src/core/import/index.ts';

const readFixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'));

describe('importExport', () => {
  it('builds Sheets with derived Sheet codes from the synthetic fixture', () => {
    const { model, issues } = importExport(readFixture('synthetic.parts.json'));

    expect(issues.filter((i) => i.kind === 'schema')).toEqual([]);
    expect(model?.sheets.map((s) => [s.name, s.code])).toEqual([
      ['White melamine chipboard 18', 'W18'],
      ['Oak MDF 16', 'O16'],
    ]);
  });

  it('lists Owners with their labels: Cabinets, then Generated Items', () => {
    const { model } = importExport(readFixture('synthetic.parts.json'));

    expect(model?.owners).toEqual([
      { kind: 'cabinet', id: 'c1', label: 'T1', cabinetName: 'Tall door' },
      {
        kind: 'generatedItem',
        id: 'w1.left.lower.c1/toeKick',
        label: 'Toe Kick T1',
        itemKind: 'toeKick',
      },
    ]);
    expect(model?.parts.map((p) => p.ownerId)).toEqual([
      'c1',
      'c1',
      'c1',
      'c1',
      'w1.left.lower.c1/toeKick',
    ]);
  });

  it('names every Part after its Owner label', () => {
    const { model } = importExport(readFixture('synthetic.parts.json'));

    expect(model?.parts.map((p) => [p.name, p.partName, p.displayName])).toEqual([
      ['leftSide', 'Left side', 'T1 · Left side'],
      ['s0.shelf[0]', 'Shelf', 'T1 · Shelf'],
      ['s0.rail[1]', 'Rail', 'T1 · Rail'],
      ['s0.door.leaf[0]', 'Door', 'T1 · Door'],
      ['toeKick', '', 'Toe Kick T1'],
    ]);
  });

  it('reports unknown Part path keys', () => {
    const { issues } = importExport(readFixture('synthetic.parts.json'));

    expect(issues.filter((i) => i.kind === 'unknownKey')).toEqual([
      { kind: 'unknownKey', key: 'rail', partIds: ['c1/s0.rail[1]'] },
    ]);
  });

  it('reports Skipped items with their reasons', () => {
    const { issues } = importExport(readFixture('synthetic.parts.json'));

    expect(issues.filter((i) => i.kind === 'skipped')).toEqual([
      {
        kind: 'skipped',
        ownerKind: 'cabinet',
        id: 'c2',
        label: 'T2',
        name: 'Tall pantry',
        reason: 'invalid',
        problems: ['check.minWidth'],
      },
    ]);
  });

  it('moves face ops into the cut frame, off the x0 and y0 Edgebands', () => {
    // The door is banded on all four edges with 1 mm ABS; its through drill is at (650, 560) mm
    // in the finished frame, so (649, 559) mm on the cut piece.
    const { model } = importExport(readFixture('synthetic.parts.json'));
    const door = model?.parts.find((p) => p.id === 'c1/s0.door.leaf[0]');

    expect(door?.cutLength).toBe(698000);
    expect(door?.top).toEqual([]);
    expect(door?.bottom[0]).toEqual({
      kind: 'drill',
      at: { x: 649000, y: 559000 },
      diameter: 5000,
      depth: 'through',
    });
    expect(door?.bottom[1]).toMatchObject({ diameter: 35000, depth: 13000 });
  });

  it('warns about bottom-face ops (no Flip Parts yet) and edge-face ops', () => {
    const { issues } = importExport(readFixture('synthetic.parts.json'));

    expect(issues.filter((i) => i.kind === 'warning')).toEqual([
      expect.objectContaining({ kind: 'warning', partId: 'c1/s0.shelf[0]' }),
      expect.objectContaining({ kind: 'warning', partId: 'c1/s0.door.leaf[0]' }),
    ]);
  });

  it('shows every schema error and loads nothing for an invalid file', () => {
    const file = readFixture('synthetic.parts.json') as Record<string, unknown>;
    const { model, issues } = importExport({ ...file, units: 'mm', schemaVersion: '2.0.0' });

    expect(model).toBeNull();
    expect(issues.map((i) => i.kind === 'schema' && i.path)).toEqual(
      expect.arrayContaining(['/schemaVersion', '/units']),
    );
  });

  it('rejects something that is not a Parts Export at all', () => {
    const { model, issues } = importExport('hello');

    expect(model).toBeNull();
    expect(issues.length).toBeGreaterThan(0);
  });
});

describe('Sheet codes', () => {
  it('give a clashing Sheet a letter suffix', () => {
    const file = readFixture('synthetic.parts.json') as {
      materials: { sheets: { id: string; name: string; thickness: number }[] };
    };
    const [white, oak] = file.materials.sheets;
    if (!white || !oak) throw new Error('fixture has two Sheets');
    oak.name = 'Walnut 18';
    oak.thickness = 18000;

    const { model } = importExport(file);

    expect(model?.sheets.map((s) => s.code)).toEqual(['W18', 'W18B']);
  });

  it('write a fractional thickness with P', () => {
    const file = readFixture('synthetic.parts.json') as {
      materials: { sheets: { thickness: number }[] };
    };
    const oak = file.materials.sheets[1];
    if (!oak) throw new Error('fixture has two Sheets');
    oak.thickness = 18450; // 18.45 mm rounds to 18.5

    const { model } = importExport(file);

    expect(model?.sheets.map((s) => s.code)).toEqual(['W18', 'O18P5']);
  });
});
