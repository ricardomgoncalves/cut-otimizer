// Import: Parts Export JSON -> domain model + issues.
// Validates against the vendored v1 schema (ajv), then builds Sheets, Owners and Parts.
import { Ajv2020 } from 'ajv/dist/2020.js';
import schema from '../../../vendor/parts-export/parts-export.v1.schema.json';
import { describeCncOp, describeExportOp, mitreOp } from '../manual-ops.ts';
import type { CncOp, ManualOp, Model, Owner, Part, Point, Sheet } from '../model.ts';
import { mmToken } from '../units.ts';
import { fullPartName, nameParts } from './names.ts';
import type {
  FacePoint,
  Op as ExportOp,
  Part as ExportPart,
  PartsExport,
  Sheet as ExportSheet,
  Skipped,
} from './parts-export.v1.generated.ts';

export type ImportIssue =
  /** The file does not match the schema. Nothing is loaded. */
  | { kind: 'schema'; path: string; message: string }
  /** Loaded, but something is not handled yet or needs attention. */
  | { kind: 'warning'; partId?: string; message: string }
  /** Something cabinet-planner left out of the export: the Job is incomplete. */
  | {
      kind: 'skipped';
      ownerKind: Skipped['kind'];
      id: string;
      label: string;
      /** The Library Cabinet name or the Generated Item kind. */
      name: string;
      reason: Skipped['reason'];
      /** Violation codes, for `invalid`. */
      problems: string[];
    }
  /** A Part path key the derive table doesn't know: those Parts are named with spaces added. */
  | { kind: 'unknownKey'; key: string; partIds: string[] };

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
    ...file.cabinets.map(
      (c): Owner => ({ kind: 'cabinet', id: c.id, label: c.label, cabinetName: c.libraryCabinetName }),
    ),
    ...file.generatedItems.map(
      (g): Owner => ({ kind: 'generatedItem', id: g.id, label: g.label, itemKind: g.kind }),
    ),
  ];
  const ownerLabel = new Map(owners.map((o) => [o.id, o.label]));
  const naming = nameParts(
    owners,
    file.parts.map((p) => ({ id: p.id, name: p.name, ownerId: p.owner.id, ...exportLabel(p) })),
  );

  const parts = file.parts.map((p, i): Part => {
    const partName = naming.parts[i]?.partName ?? p.name;
    const offset = {
      x: p.edges.x0 === undefined ? 0 : (bandThickness.get(p.edges.x0) ?? 0),
      y: p.edges.y0 === undefined ? 0 : (bandThickness.get(p.edges.y0) ?? 0),
    };
    const top: CncOp[] = [];
    const bottom: CncOp[] = [];
    const manualOps: ManualOp[] = [];
    for (const end of ['x0', 'xL'] as const) {
      const mitre = p.ends?.[end]?.mitre;
      if (mitre) manualOps.push(mitreOp(end, mitre.angle, mitre.longFace));
    }
    for (const op of p.ops) {
      if (op.face !== 'top' && op.face !== 'bottom') {
        manualOps.push({ reason: 'edge', face: op.face, text: describeExportOp(op) });
        continue;
      }
      const cnc = toCncOp(op, offset);
      if (!drawable(cnc)) {
        manualOps.push({ reason: 'notDrawable', face: op.face, text: describeCncOp(cnc, op.face) });
      } else if (op.face === 'top' || (cnc.kind === 'drill' && cnc.depth === 'through')) {
        // A through op is the same hole seen from either face (same x, y in the Part frame): Side A runs it.
        top.push(cnc);
      } else {
        bottom.push(cnc);
      }
    }
    if (manualOps.length > 0) {
      const count = manualOps.length === 1 ? '1 Manual op' : `${String(manualOps.length)} Manual ops`;
      issues.push({ kind: 'warning', partId: p.id, message: `${count}, not in any file: done by hand` });
    }
    return {
      id: p.id,
      name: p.name,
      partName,
      displayName: fullPartName(ownerLabel.get(p.owner.id) ?? p.owner.id, partName),
      ownerId: p.owner.id,
      sheetId: p.sheetId,
      thickness: p.thickness,
      cutLength: p.cutLength,
      cutWidth: p.cutWidth,
      grain: p.grain,
      top,
      bottom,
      manualOps,
      edges: { ...p.edges },
    };
  });

  issues.push(
    ...naming.unknownKeys.map((u): ImportIssue => ({ kind: 'unknownKey', key: u.key, partIds: u.partIds })),
    ...file.skipped.map(
      (s): ImportIssue => ({
        kind: 'skipped',
        ownerKind: s.kind,
        id: s.id,
        label: s.label,
        name: s.name,
        reason: s.reason,
        problems: s.problems,
      }),
    ),
  );
  const edgebands = file.materials.edgebands.map((e) => ({
    id: e.id,
    name: e.name,
    thickness: e.thickness,
    width: e.width,
  }));
  return { model: { projectName: file.project.name, exportedAt: file.exportedAt, sheets, edgebands, owners, parts }, issues };
}

/**
 * The optional Part `label` (the Library Part's Cut-list text) planned for a v1 minor release. A v1.0
 * file can't carry it (the schema is strict); a newer minor is validated against its own schema.
 */
function exportLabel(p: ExportPart): { label?: string } {
  const label: unknown = (p as ExportPart & { label?: unknown }).label;
  return typeof label === 'string' && label !== '' ? { label } : {};
}

/**
 * Whether the DXF grammar can draw an op: drills are circles; grooves and pockets are axis-aligned closed
 * rectangles. A diagonal groove can't be drawn (pocket corner radii are ignored).
 */
function drawable(op: CncOp): boolean {
  return op.kind !== 'groove' || op.from.x === op.to.x || op.from.y === op.to.y;
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
 * The derived Sheet code for a Sheet name and thickness that no code in `used` has: `W18`, else `W18B`,
 * `W18C`, ... Re-import uses it to give new Sheets codes beside the Job's existing ones.
 */
export function freeSheetCode(name: string, thickness: number, used: ReadonlySet<string>): string {
  const initial = (/[A-Za-z0-9]/.exec(name)?.[0] ?? 'S').toUpperCase();
  const base = `${initial}${mmToken(thickness)}`;
  let code = base;
  for (let i = 1; used.has(code); i++) code = `${base}${String.fromCharCode(65 + i)}`;
  return code;
}

/**
 * Sheet code: the first letter of the Sheet name and its thickness in mm (`W18`).
 * A clash with an earlier Sheet gets a letter suffix (`W18B`, `W18C`, ...).
 */
function sheetsWithCodes(sheets: ExportSheet[]): Sheet[] {
  const used = new Set<string>();
  return sheets.map((s) => {
    const code = freeSheetCode(s.name, s.thickness, used);
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
