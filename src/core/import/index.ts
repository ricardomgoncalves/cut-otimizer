// Import: Parts Export JSON -> domain model + issues.
// Validates against the vendored v1 schema (ajv), then builds Sheets, Owners and Parts.
import { Ajv2020 } from 'ajv/dist/2020.js';
import schema from '../../../vendor/parts-export/parts-export.v1.schema.json';
import type { CncOp, Model, Owner, Part, Point, Sheet } from '../model.ts';
import { mmToken } from '../units.ts';
import type {
  FacePoint,
  Op as ExportOp,
  Part as ExportPart,
  PartsExport,
  Sheet as ExportSheet,
} from './parts-export.v1.generated.ts';

export type ImportIssue =
  /** The file does not match the schema. Nothing is loaded. */
  | { kind: 'schema'; path: string; message: string }
  /** Loaded, but something is not handled yet or needs attention. */
  | { kind: 'warning'; partId?: string; message: string };

export interface ImportResult {
  /** `null` when the file fails schema validation. */
  model: Model | null;
  issues: ImportIssue[];
}

const ajv = new Ajv2020({ allErrors: true, strict: false });
// RFC 3339 date-time, as cabinet-planner checks it (no ajv-formats).
ajv.addFormat('date-time', /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?(Z|[+-]\d\d:\d\d)$/i);
const validate = ajv.compile<PartsExport>(schema);

/** Validates a parsed Parts Export and builds the domain model from it. */
export function importExport(json: unknown): ImportResult {
  if (!validate(json)) {
    const issues: ImportIssue[] = (validate.errors ?? []).map((e) => ({
      kind: 'schema',
      path: e.instancePath || '/',
      message: e.message ?? 'is invalid',
    }));
    return { model: null, issues };
  }
  return buildModel(json);
}

function buildModel(file: PartsExport): ImportResult {
  const issues: ImportIssue[] = [];
  const bandThickness = new Map(file.materials.edgebands.map((e) => [e.id, e.thickness]));

  const sheets = sheetsWithCodes(file.materials.sheets);
  const owners: Owner[] = [
    ...file.cabinets.map((c) => ({ kind: 'cabinet' as const, id: c.id, label: c.label })),
    ...file.generatedItems.map((g) => ({ kind: 'generatedItem' as const, id: g.id, label: g.label })),
  ];

  const parts = file.parts.map((p): Part => {
    const offset = {
      x: p.edges.x0 === undefined ? 0 : (bandThickness.get(p.edges.x0) ?? 0),
      y: p.edges.y0 === undefined ? 0 : (bandThickness.get(p.edges.y0) ?? 0),
    };
    const top: CncOp[] = [];
    const bottom: CncOp[] = [];
    const edgeOps: ExportOp[] = [];
    for (const op of p.ops) {
      if (op.face === 'top') top.push(toCncOp(op, offset));
      else if (op.face === 'bottom') bottom.push(toCncOp(op, offset));
      else edgeOps.push(op);
    }
    issues.push(...partWarnings(p, bottom.length, edgeOps.length));
    return {
      id: p.id,
      name: p.name,
      ownerId: p.owner.id,
      sheetId: p.sheetId,
      thickness: p.thickness,
      cutLength: p.cutLength,
      cutWidth: p.cutWidth,
      grain: p.grain,
      top,
      bottom,
      edgeOps,
    };
  });

  return { model: { projectName: file.project.name, sheets, owners, parts }, issues };
}

function partWarnings(p: ExportPart, bottom: number, edgeOps: number): ImportIssue[] {
  const issues: ImportIssue[] = [];
  if (bottom > 0) {
    issues.push({
      kind: 'warning',
      partId: p.id,
      message: `${String(bottom)} bottom-face op(s) ignored: Flip Parts are not supported yet`,
    });
  }
  if (edgeOps > 0) {
    issues.push({
      kind: 'warning',
      partId: p.id,
      message: `${String(edgeOps)} edge-face op(s) are Manual ops and are not in any file`,
    });
  }
  return issues;
}

/** Moves an export op from the finished frame into the cut frame (banding off `x0`/`y0`). */
function toCncOp(op: ExportOp, offset: Point): CncOp {
  const at = (p: FacePoint): Point => ({ x: (p.x ?? 0) - offset.x, y: (p.y ?? 0) - offset.y });
  switch (op.type) {
    case 'drill':
      return {
        kind: 'drill',
        at: at(op.at),
        diameter: op.diameter,
        depth: op.through === true ? 'through' : (op.depth ?? 0),
      };
    case 'groove':
      return { kind: 'groove', from: at(op.from), to: at(op.to), width: op.width, depth: op.depth };
    case 'pocket':
      return {
        kind: 'pocket',
        centre: at(op.centre),
        length: op.length,
        width: op.width,
        depth: op.depth,
      };
  }
}

/**
 * Sheet code: the first letter of the Sheet name and its thickness in mm (`W18`).
 * A clash with an earlier Sheet gets a letter suffix (`W18B`, `W18C`, ...).
 */
function sheetsWithCodes(sheets: ExportSheet[]): Sheet[] {
  const used = new Set<string>();
  return sheets.map((s) => {
    const initial = (/[A-Za-z0-9]/.exec(s.name)?.[0] ?? 'S').toUpperCase();
    const base = `${initial}${mmToken(s.thickness)}`;
    let code = base;
    for (let i = 1; used.has(code); i++) code = `${base}${String.fromCharCode(65 + i)}`;
    used.add(code);
    return {
      id: s.id,
      name: s.name,
      code,
      thickness: s.thickness,
      length: s.sheetLength,
      width: s.sheetWidth,
      grain: s.grain,
    };
  });
}
