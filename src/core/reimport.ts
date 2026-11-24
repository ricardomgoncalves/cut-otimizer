// Re-import: loading an updated Parts Export into a Job that already has one (PRD stories 11.1–11.6,
// 11.11 and 11.12). `diff` matches the Job's Parts with the new export's and sorts them into categories;
// the maker reviews that, may unpair auto-paired Parts, and applies it all or nothing
// (job-store/document.ts `applyReimport`). This slice changes the data only: Layouts go stale and only
// Regenerate changes Blanks, Boards and Offcuts.
//
// Matching: exact Part id first. Then each leftover old Part and leftover new Part with the same Sheet,
// cut size (with the same Edgebands, the same finished size), grain, ops, Edgebands, Owner kind and Part
// `name`/kind are paired as the same physical piece, identical candidates in Run order (old Parts in the
// current Plan's Run order, new Parts in export order). The `name` is compared without its copy indices
// (`s0.shelf[2]` and `s0.shelf[3]` pair). That catches renamed Generated Item Parts and
// repeat-count renames.
import { freeSheetCode } from './import/index.ts';
import type { JobDocument } from './job-store/document.ts';
import type { CncOp, ManualOp, Model, Owner, Part, PartEdges, Sheet } from './model.ts';
import type { Plan } from './planner/index.ts';
import { boardId } from './progress.ts';

export type Category = 'same' | 'renamed' | 'changedCut' | 'changedFinishing' | 'added' | 'removed';

/** The diff screen's order. */
export const CATEGORIES: readonly Category[] = ['changedCut', 'changedFinishing', 'added', 'removed', 'renamed', 'same'];

/**
 * What differs between a Part and its match. `sheetDefinition`: its Sheet (same id) changed material,
 * thickness, size or grain. `cncOps` = top or bottom ops; `manualOps` = ops done by hand.
 */
export type Change =
  | 'id'
  | 'name'
  | 'owner'
  | 'sheet'
  | 'sheetDefinition'
  | 'size'
  | 'grain'
  | 'cncOps'
  | 'edgebands'
  | 'manualOps';

const CUT_CHANGES: readonly Change[] = ['sheet', 'sheetDefinition', 'size', 'grain', 'cncOps'];
const FINISHING_CHANGES: readonly Change[] = ['edgebands', 'manualOps'];

export interface DiffEntry {
  category: Category;
  /** The Part's id in the Job's current export. Absent for Added Parts. */
  oldId?: string;
  /** The Part's id in the new export. Absent for Removed Parts. */
  newId?: string;
  /** Matched by auto-pairing rather than by id: the maker can unpair it. */
  paired: boolean;
  /** The new display name (the old one for Removed Parts). */
  displayName: string;
  /** The current display name, when it changes. */
  oldDisplayName?: string;
  /** The Owner label (new, or old for Removed Parts). */
  ownerLabel: string;
  /** Where the current Plan cuts it (`W18-1-A #2`, `Saw · W18-1`). Absent when it isn't on a Board. */
  where?: string;
  /** Empty for Same, Added and Removed. */
  changes: Change[];
}

export interface Diff {
  hint: {
    currentProject: string;
    newProject: string;
    sameProject: boolean;
    /** Part ids found in both exports, over the larger Part count (0–1). */
    idMatchShare: number;
    /** Under about half the ids match: warn, don't block. */
    lowOverlap: boolean;
  };
  currentExportedAt?: string;
  newExportedAt?: string;
  /** The new file was exported before the current one: warn, don't block. */
  olderExport: boolean;
  /** Ids of Sheets in both exports whose definition changed. */
  changedSheets: string[];
  /** Grouped in CATEGORIES order; inside a group in export order (Removed in the current Run order). */
  entries: DiffEntry[];
  counts: Record<Category, number>;
  /** Labels of the Owners each category touches, in entry order. */
  owners: Record<Category, string[]>;
  /** Old Part id -> new Part id for every match whose id changes. Becomes the id alias on apply. */
  renames: Record<string, string>;
}

/** An auto-pairing the maker undid: both Parts are left out of pairing. */
export interface Unpair {
  oldId: string;
  newId: string;
}

export interface DiffChoices {
  unpaired?: readonly Unpair[];
}

/** What `diff` reads from the Job: its model and, once planned, its Plan. */
export interface DiffJob {
  model: Model;
  plan: Plan | null;
}

export const LOW_OVERLAP = 0.5;

/** Matches the Job's Parts with a new export's and sorts every Part into a category. */
export function diff(job: DiffJob, next: Model, choices: DiffChoices = {}): Diff {
  const old = job.model;
  const oldById = new Map(old.parts.map((p) => [p.id, p]));
  const newIds = new Set(next.parts.map((p) => p.id));
  const exact = old.parts.filter((p) => newIds.has(p.id)).length;
  const idMatchShare = Math.max(old.parts.length, next.parts.length) === 0 ? 1 : exact / Math.max(old.parts.length, next.parts.length);

  const changedSheets = next.sheets
    .filter((s) => {
      const before = old.sheets.find((o) => o.id === s.id);
      return before !== undefined && !sameSheet(before, s);
    })
    .map((s) => s.id);

  // Exact ids, then auto-pairs.
  const match = new Map<string, { part: Part; paired: boolean }>(); // new id -> old Part
  for (const p of next.parts) {
    const before = oldById.get(p.id);
    if (before) match.set(p.id, { part: before, paired: false });
  }
  const excluded = new Set((choices.unpaired ?? []).flatMap((u) => [`old:${u.oldId}`, `new:${u.newId}`]));
  const runOrder = oldRunOrder(job);
  const oldOwners = new Map(old.owners.map((o) => [o.id, o]));
  const newOwners = new Map(next.owners.map((o) => [o.id, o]));
  const leftOld = old.parts
    .filter((p) => !newIds.has(p.id) && !excluded.has(`old:${p.id}`))
    .sort((a, b) => (runOrder.get(a.id) ?? 0) - (runOrder.get(b.id) ?? 0));
  const candidates = new Map<string, Part[]>();
  for (const p of leftOld) {
    const key = pairKey(p, oldOwners.get(p.ownerId));
    candidates.set(key, [...(candidates.get(key) ?? []), p]);
  }
  for (const p of next.parts) {
    if (match.has(p.id) || excluded.has(`new:${p.id}`)) continue;
    const pool = candidates.get(pairKey(p, newOwners.get(p.ownerId)));
    const before = pool?.shift();
    if (before) match.set(p.id, { part: before, paired: true });
  }

  const where = locations(job.plan);
  const ownerLabel = (owners: Map<string, Owner>, p: Part) => owners.get(p.ownerId)?.label ?? p.ownerId;
  const entries: DiffEntry[] = [];
  const renames: Record<string, string> = {};
  for (const p of next.parts) {
    const m = match.get(p.id);
    if (!m) {
      entries.push({ category: 'added', newId: p.id, paired: false, displayName: p.displayName, ownerLabel: ownerLabel(newOwners, p), changes: [] });
      continue;
    }
    const before = m.part;
    if (before.id !== p.id) renames[before.id] = p.id;
    const changes = changesOf(before, p, oldOwners, newOwners, changedSheets);
    entries.push({
      category: categoryOf(changes),
      oldId: before.id,
      newId: p.id,
      paired: m.paired,
      displayName: p.displayName,
      ...(before.displayName === p.displayName ? {} : { oldDisplayName: before.displayName }),
      ownerLabel: ownerLabel(newOwners, p),
      ...withWhere(where.get(before.id)),
      changes,
    });
  }
  const matchedOld = new Set([...match.values()].map((m) => m.part.id));
  for (const p of [...old.parts].sort((a, b) => (runOrder.get(a.id) ?? 0) - (runOrder.get(b.id) ?? 0))) {
    if (matchedOld.has(p.id)) continue;
    entries.push({
      category: 'removed',
      oldId: p.id,
      paired: false,
      displayName: p.displayName,
      ownerLabel: ownerLabel(oldOwners, p),
      ...withWhere(where.get(p.id)),
      changes: [],
    });
  }
  entries.sort((a, b) => CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category));

  const counts = Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<Category, number>;
  const owners = Object.fromEntries(CATEGORIES.map((c) => [c, [] as string[]])) as Record<Category, string[]>;
  for (const e of entries) {
    counts[e.category]++;
    if (!owners[e.category].includes(e.ownerLabel)) owners[e.category].push(e.ownerLabel);
  }

  const olderExport =
    old.exportedAt !== undefined &&
    next.exportedAt !== undefined &&
    Date.parse(next.exportedAt) < Date.parse(old.exportedAt);

  return {
    hint: {
      currentProject: old.projectName,
      newProject: next.projectName,
      sameProject: old.projectName === next.projectName,
      idMatchShare,
      lowOverlap: idMatchShare < LOW_OVERLAP,
    },
    ...(old.exportedAt === undefined ? {} : { currentExportedAt: old.exportedAt }),
    ...(next.exportedAt === undefined ? {} : { newExportedAt: next.exportedAt }),
    olderExport,
    changedSheets,
    entries,
    counts,
    owners,
    renames,
  };
}

/** The Parts a re-import leaves to nest at the next Regenerate: Added and Changed (cut), by new id. */
export function needsNesting(d: Diff): string[] {
  return d.entries.flatMap((e) =>
    (e.category === 'added' || e.category === 'changedCut') && e.newId !== undefined ? [e.newId] : [],
  );
}

/** A Part id as it is now: an old id (on a printed sticker, say) resolves through the id alias. */
export function resolvePartId(aliases: Readonly<Record<string, string>>, id: string): string {
  return aliases[id] ?? id;
}

/**
 * The id alias after a re-import: every old id maps straight to the current one. Earlier aliases follow
 * the new renames, and an id that is live again stops being an alias.
 */
export function extendAliases(
  aliases: Readonly<Record<string, string>>,
  renames: Readonly<Record<string, string>>,
): Record<string, string> {
  const live = new Set(Object.values(renames));
  const out: Record<string, string> = {};
  for (const [from, to] of Object.entries(aliases)) {
    if (!live.has(from)) out[from] = renames[to] ?? to;
  }
  for (const [from, to] of Object.entries(renames)) out[from] = to;
  return Object.fromEntries(Object.entries(out).filter(([from, to]) => from !== to));
}

/** The new export, as loaded for the re-import. */
export interface NextExport {
  rawExport: string;
  fileName: string;
  /** What Import built from `rawExport`. */
  model: Model;
}

/**
 * Applies a reviewed diff to a Job document, all or nothing. `current` is the model Import builds from the
 * document's raw export, and `d` the diff of it against `next.model`.
 *
 * - The raw export (and its file name) is replaced; the Job name and settings snapshot are unchanged.
 * - Sheet codes carry over by Sheet id. A derived code is re-derived only if its Sheet changed; an
 *   unchanged Sheet keeps its code even when Import would now derive another; new Sheets get derived codes.
 * - Ticks and Saw/CNC choices move to the new Part ids (Removed Parts keep their ticks under the old id), and
 *   the id alias records old -> new for good.
 * - The stored Plan stays (only Regenerate changes Blanks, Boards and Offcuts) with its Part ids moved, and
 *   is marked stale with the Parts that need nesting. An unplanned Job has nothing to mark.
 * - A re-import log entry is added, and the document as it was is kept for "Revert last re-import".
 */
export function applyReimport(doc: JobDocument, current: Model, next: NextExport, d: Diff, now: string): JobDocument {
  const renames = d.renames;
  const live = new Set(next.model.parts.map((p) => p.id));
  const sawCncOverrides = Object.fromEntries(
    Object.entries(renameKeys(doc.sawCncOverrides, renames)).filter(([id]) => live.has(id)),
  );
  const carried = (doc.stale?.needsNesting ?? []).map((id) => renames[id] ?? id).filter((id) => live.has(id));
  const nesting = needsNesting(d);
  return {
    ...doc,
    fileName: next.fileName,
    rawExport: next.rawExport,
    sheetCodes: carrySheetCodes(current, next.model, doc.sheetCodes, d.changedSheets),
    sawCncOverrides,
    progress: renameKeys(doc.progress, renames),
    plan: doc.plan && renamePlanParts(doc.plan, renames),
    stale: doc.plan ? { needsNesting: [...carried.filter((id) => !nesting.includes(id)), ...nesting] } : null,
    aliases: extendAliases(doc.aliases, renames),
    reimportLog: [
      ...doc.reimportLog,
      {
        at: now,
        ...(next.model.exportedAt === undefined ? {} : { exportedAt: next.model.exportedAt }),
        fileName: next.fileName,
        counts: d.counts,
      },
    ],
    previous: { ...doc, previous: null },
    updatedAt: now,
  };
}

/** "Revert last re-import": the document as it was before it, or null when there's nothing to revert. */
export function revertReimport(doc: JobDocument): JobDocument | null {
  return doc.previous;
}

function renameKeys<T>(record: Readonly<Record<string, T>>, renames: Readonly<Record<string, string>>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [id, value] of Object.entries(record)) if (renames[id] === undefined) out[id] = value;
  for (const [id, value] of Object.entries(record)) {
    const to = renames[id];
    if (to !== undefined) out[to] = value;
  }
  return out;
}

/** The stored Plan with renamed Parts under their new ids. Nothing moves; unknown fields are kept. */
function renamePlanParts(plan: Plan, renames: Readonly<Record<string, string>>): Plan {
  if (Object.keys(renames).length === 0) return plan;
  const id = (partId: string) => renames[partId] ?? partId;
  return {
    ...plan,
    sheets: plan.sheets.map((sheet) => ({
      ...sheet,
      boards: sheet.boards.map((board) => ({
        ...board,
        blanks: board.blanks.map((blank) => ({ ...blank, parts: blank.parts.map((p) => ({ ...p, partId: id(p.partId) })) })),
        sawParts: board.sawParts.map((p) => ({ ...p, partId: id(p.partId) })),
      })),
      sawParts: sheet.sawParts.map(id),
      sawReasons: renameKeys(sheet.sawReasons, renames),
      unplaced: sheet.unplaced.map(id),
    })),
    sideB: plan.sideB.map((file) => ({ ...file, partIds: file.partIds.map(id) })),
    manualOps: plan.manualOps.map((op) => ({ ...op, partId: id(op.partId) })),
  };
}

/** The Sheet code overrides after a re-import (see applyReimport). */
function carrySheetCodes(
  current: Model,
  next: Model,
  codes: Readonly<Record<string, string>>,
  changedSheets: readonly string[],
): Record<string, string> {
  const out: Record<string, string> = {};
  const used = new Set<string>();
  const keep = (sheet: Sheet, code: string) => {
    used.add(code);
    if (code !== sheet.code) out[sheet.id] = code;
  };
  const fresh: Sheet[] = [];
  for (const sheet of next.sheets) {
    const before = current.sheets.find((s) => s.id === sheet.id);
    const edited = codes[sheet.id];
    if (edited !== undefined) keep(sheet, edited);
    else if (before && !changedSheets.includes(sheet.id)) keep(sheet, before.code);
    else fresh.push(sheet);
  }
  for (const sheet of fresh) {
    keep(sheet, used.has(sheet.code) ? freeSheetCode(sheet.name, sheet.thickness, used) : sheet.code);
  }
  return out;
}

function categoryOf(changes: readonly Change[]): Category {
  if (changes.some((c) => CUT_CHANGES.includes(c))) return 'changedCut';
  if (changes.some((c) => FINISHING_CHANGES.includes(c))) return 'changedFinishing';
  return changes.length > 0 ? 'renamed' : 'same';
}

function changesOf(
  a: Part,
  b: Part,
  oldOwners: Map<string, Owner>,
  newOwners: Map<string, Owner>,
  changedSheets: readonly string[],
): Change[] {
  const out: Change[] = [];
  if (a.id !== b.id) out.push('id');
  if (a.name !== b.name || a.partName !== b.partName || a.displayName !== b.displayName) out.push('name');
  const ownerA = oldOwners.get(a.ownerId);
  const ownerB = newOwners.get(b.ownerId);
  if (a.ownerId !== b.ownerId || !same(ownerA, ownerB)) out.push('owner');
  if (a.sheetId !== b.sheetId) out.push('sheet');
  else if (changedSheets.includes(b.sheetId)) out.push('sheetDefinition');
  if (a.cutLength !== b.cutLength || a.cutWidth !== b.cutWidth || a.thickness !== b.thickness) out.push('size');
  if (a.grain !== b.grain) out.push('grain');
  if (!same(cncOps(a), cncOps(b))) out.push('cncOps');
  if (!same(edges(a.edges), edges(b.edges))) out.push('edgebands');
  if (!same(manualOps(a.manualOps), manualOps(b.manualOps))) out.push('manualOps');
  return out;
}

/** Everything auto-pairing compares: what the piece is, not what it's called or who owns it. */
function pairKey(p: Part, owner: Owner | undefined): string {
  return JSON.stringify([
    p.sheetId,
    p.thickness,
    p.cutLength,
    p.cutWidth,
    p.grain,
    cncOps(p),
    manualOps(p.manualOps),
    edges(p.edges),
    owner?.kind ?? null,
    owner?.itemKind ?? null,
    pathOf(p.name),
  ]);
}

/** A Part `name` without its copy indices (`s0.shelf[2]` -> `s0.shelf`), so repeat-count renames still pair. */
const pathOf = (name: string) => name.replace(/\[[\d,\s]*\]/g, '');

const cncOps = (p: Part): { top: CncOp[]; bottom: CncOp[] } => ({ top: p.top, bottom: p.bottom });
const edges = (e: PartEdges) => [e.x0 ?? null, e.xL ?? null, e.y0 ?? null, e.yW ?? null];
const manualOps = (ops: readonly ManualOp[]) => ops.map((o) => [o.reason, o.face, o.text]);

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function sameSheet(a: Sheet, b: Sheet): boolean {
  return (
    a.name === b.name && a.thickness === b.thickness && a.length === b.length && a.width === b.width && a.grain === b.grain
  );
}

function withWhere(where: string | undefined): { where?: string } {
  return where === undefined ? {} : { where };
}

/** Old Part id -> position in the current Plan's Run order. Parts on no Board follow, in export order. */
function oldRunOrder(job: DiffJob): Map<string, number> {
  const ids = (job.plan?.sheets ?? []).flatMap((sheet) => [
    ...sheet.boards.flatMap((board) => [
      ...board.blanks.flatMap((blank) => blank.parts.map((p) => p.partId)),
      ...board.sawParts.map((p) => p.partId),
    ]),
    ...sheet.unplaced,
  ]);
  const order = new Map<string, number>();
  for (const id of [...ids, ...job.model.parts.map((p) => p.id)]) if (!order.has(id)) order.set(id, order.size);
  return order;
}

/** Where the Plan cuts each Part: `W18-1-A #2` on a Blank, `Saw · W18-1` for a Saw Part on a Board. */
function locations(plan: Plan | null): Map<string, string> {
  const where = new Map<string, string>();
  for (const sheet of plan?.sheets ?? []) {
    for (const board of sheet.boards) {
      for (const blank of board.blanks) for (const p of blank.parts) where.set(p.partId, `${blank.id} #${String(p.n)}`);
      for (const p of board.sawParts) where.set(p.partId, `Saw · ${boardId(sheet, board)}`);
    }
  }
  return where;
}
