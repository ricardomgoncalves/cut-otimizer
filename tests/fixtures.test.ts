import { readdirSync, readFileSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

// Every Parts Export in fixtures/ must validate against the vendored v1 schema.
const root = new URL('../', import.meta.url);
const readJson = (path: string): unknown => JSON.parse(readFileSync(new URL(path, root), 'utf8'));

const schema = readJson('vendor/parts-export/parts-export.v1.schema.json') as object;
const ajv = new Ajv2020({ allErrors: true, strict: false });
// RFC 3339 date-time, as cabinet-planner's own tests check it (no ajv-formats).
ajv.addFormat('date-time', /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?(Z|[+-]\d\d:\d\d)$/i);
const validate = ajv.compile(schema);

function schemaErrors(file: unknown): string[] {
  return validate(file) ? [] : (validate.errors ?? []).map((e) => `${e.instancePath} ${e.message ?? ''}`);
}

const fixtures = readdirSync(new URL('fixtures/', root)).filter((name) => name.endsWith('.json'));

describe('fixtures', () => {
  it('has at least one Parts Export fixture', () => {
    expect(fixtures).toContain('synthetic.parts.json');
  });

  it.each(fixtures)('%s validates against the vendored Parts Export v1 schema', (name) => {
    expect(schemaErrors(readJson(`fixtures/${name}`))).toEqual([]);
  });

  it('rejects a file from an unknown major version', () => {
    const file = readJson('fixtures/synthetic.parts.json') as Record<string, unknown>;
    expect(schemaErrors({ ...file, schemaVersion: '2.0.0' })).not.toEqual([]);
  });
});

// Just enough of the export's shape to check what the synthetic fixture covers.
interface FixtureOp {
  face: string;
  through?: true;
}
interface FixturePart {
  owner: { kind: string };
  cutLength: number;
  cutWidth: number;
  ops: FixtureOp[];
}
interface FixtureExport {
  materials: { sheets: { thickness: number }[]; edgebands: unknown[] };
  parts: FixturePart[];
}

describe('synthetic fixture', () => {
  const file = readJson('fixtures/synthetic.parts.json') as FixtureExport;
  const mm = (n: number) => n * 1000;
  const bed = mm(1300); // PROVerXL 4X4 working area, the PRD's default bed size
  const minCncWidth = mm(50); // the PRD's default Min CNC width

  it('has a Part bigger than the bed (a Saw Part)', () => {
    expect(file.parts.some((p) => Math.max(p.cutLength, p.cutWidth) > bed)).toBe(true);
  });

  it('has a Flip Part that also has a through bottom op', () => {
    const bottom = (p: FixturePart) => p.ops.filter((op) => op.face === 'bottom');
    const flip = file.parts.filter(
      (p) => bottom(p).some((op) => !op.through) && bottom(p).some((op) => op.through),
    );
    expect(flip).toHaveLength(1);
  });

  it('has a Part narrower than Min CNC width with no ops', () => {
    expect(
      file.parts.some((p) => Math.min(p.cutLength, p.cutWidth) < minCncWidth && p.ops.length === 0),
    ).toBe(true);
  });

  it('has an edge-face op (a Manual op)', () => {
    const edgeFaces = ['x0', 'xL', 'y0', 'yW'];
    expect(file.parts.some((p) => p.ops.some((op) => edgeFaces.includes(op.face)))).toBe(true);
  });

  it('has a Generated Item Part', () => {
    expect(file.parts.some((p) => p.owner.kind === 'generatedItem')).toBe(true);
  });

  it('has two Sheets of different thickness and an Edgeband', () => {
    expect(new Set(file.materials.sheets.map((s) => s.thickness)).size).toBe(2);
    expect(file.materials.edgebands.length).toBeGreaterThan(0);
  });
});
