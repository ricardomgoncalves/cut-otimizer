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
    // The door is banded on all four edges with 1 mm ABS; its hinge cup is at (100, 22.5) mm
    // in the finished frame, so (99, 21.5) mm on the cut piece.
    const { model } = importExport(readFixture('synthetic.parts.json'));
    const door = model?.parts.find((p) => p.id === 'c1/s0.door.leaf[0]');

    expect(door?.cutLength).toBe(698000);
    expect(door?.bottom).toEqual([{ kind: 'drill', at: { x: 99000, y: 21500 }, diameter: 35000, depth: 13000 }]);
  });

  it('mirrors a through bottom op onto top, where Side A runs it', () => {
    // The door's through Ø5 drill is at (650, 560) mm on the bottom face: the same hole seen from the top.
    const { model } = importExport(readFixture('synthetic.parts.json'));
    const door = model?.parts.find((p) => p.id === 'c1/s0.door.leaf[0]');

    expect(door?.top).toEqual([{ kind: 'drill', at: { x: 649000, y: 559000 }, diameter: 5000, depth: 'through' }]);
  });

  it('makes edge-face ops Manual ops, spelled out in the finished frame', () => {
    const { model } = importExport(readFixture('synthetic.parts.json'));
    const shelf = model?.parts.find((p) => p.id === 'c1/s0.shelf[0]');

    expect(shelf?.top).toEqual([]);
    expect(shelf?.bottom).toEqual([]);
    expect(shelf?.manualOps).toEqual([{ reason: 'edge', face: 'x0', text: 'Drill Ø8 × 30 deep on x0 at y 260, z 9' }]);
  });

  it('makes ops the DXF grammar cannot draw Manual ops: a mitre, a diagonal groove', () => {
    const file = readFixture('synthetic.parts.json') as { parts: Record<string, unknown>[] };
    const toeKick = file.parts[4];
    if (!toeKick) throw new Error('fixture has a toe kick');
    toeKick['ends'] = { xL: { mitre: { angle: 45, longFace: 'top' } } };
    toeKick['ops'] = [
      {
        type: 'groove',
        face: 'top',
        from: { x: 10000, y: 10000 },
        to: { x: 110000, y: 60500 },
        width: 4000,
        depth: 5000,
        source: { kind: 'op', index: 0 },
      },
    ];

    const { model } = importExport(file);
    const part = model?.parts[4];

    expect(part?.top).toEqual([]);
    expect(part?.manualOps).toEqual([
      { reason: 'notDrawable', face: 'xL', text: 'Mitre the xL end 45° (long point on top)' },
      {
        reason: 'notDrawable',
        face: 'top',
        text: 'Groove 4 wide × 5 deep on top from x 10, y 10 to x 110, y 60.5',
      },
    ]);
  });

  it('warns about Parts with Manual ops', () => {
    const { issues } = importExport(readFixture('synthetic.parts.json'));

    expect(issues.filter((i) => i.kind === 'warning')).toEqual([
      { kind: 'warning', partId: 'c1/s0.shelf[0]', message: '1 Manual op, not in any file: done by hand' },
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
