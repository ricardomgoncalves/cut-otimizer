// Re-import: loading an updated Parts Export into a Job that already has one (PRD stories 11.1–11.6,
// 11.11 and 11.12). `diff` matches the Job's Parts with the new export's and sorts them into categories;
// the maker reviews that, may unpair auto-paired Parts, and applies it all or nothing
// (`applyDiff`). This slice changes the data only: Layouts go stale and only
// Regenerate changes Blanks, Boards and Offcuts.
//
// Matching: exact Part id first. Then each leftover old Part and leftover new Part with the same Sheet,
// cut size (with the same Edgebands, the same finished size), grain, ops, Edgebands, Owner kind and Part
// `name`/kind are paired as the same physical piece, identical candidates in Run order (old Parts in the
// current Plan's Run order, new Parts in export order). The `name` is compared without its copy indices
// (`s0.shelf[2]` and `s0.shelf[3]` pair). That catches renamed Generated Item Parts and
// repeat-count renames.
import { describeChange } from './change-text.ts';
import { freezeLockedPages } from './documents/index.ts';
import { partLocations, partRunOrder } from './documents/work.ts';
import { freeSheetCode } from './import/index.ts';
import { withHandFixes, type JobDocument, type Spare } from './job-store/document.ts';
import type { CncOp, ManualOp, Model, Owner, Part, PartEdges, Sheet } from './model.ts';
import {
  blankLocked,
  boardLocked,
  isLive,
  livePartIds,
  remakePart,
  sideB,
  type Placement,
  type Plan,
  type SawPlacement,
  type VoidReason,
} from './planner/index.ts';
import { boardId, isCut, type PartTicks, type Progress, type Step } from './progress.ts';

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
  /** What applying does to the work already done on it (Changed and Removed Parts; see `Treatment`). */
  treatment?: Treatment;
  /**
   * Changed (finishing) only: a Step whose data changed was already ticked, so its tick is cleared
   * ("banding changed after it was banded").
   */
  flags?: string[];
  /** Changed (cut) Parts already cut: what "Fix by hand" adds as a Manual op ("now 596 wide"). */
  fixText?: string;
}

/**
 * What a re-import does to a Changed or Removed Part's work (PRD 11.7–11.10):
 * - `remake`: Changed (cut) and already ticked Cut: ticks cleared, greyed on its old Blank, nested again.
 * - `fixByHand`: the maker's override of `remake`: ticks kept, plus an unticked Manual ops Step that
 *   describes the change.
 * - `nest`: Changed (cut), not cut yet: nested again (a greyed "moved to …" void on a Locked Blank).
 * - `clearSteps`: Changed (finishing): only the Steps whose data changed are cleared.
 * - `spare`: Removed, already cut: listed as a Spare until dismissed.
 * - `drop`: Removed, not cut: dropped (a void on a Locked Blank).
 */
export type Treatment = 'remake' | 'fixByHand' | 'nest' | 'clearSteps' | 'spare' | 'drop';

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
  /** New ids of Changed (cut) Parts already cut that are fixed by hand instead of remade. */
  fixByHand?: readonly string[];
}

/** What `diff` reads from the Job: its model, once planned its Plan, and its ticks. */
export interface DiffJob {
  model: Model;
  plan: Plan | null;
  /** The Job's ticks; none when left out. */
  progress?: Progress;
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
  const cutBefore = (oldId: string) => isCut(job.progress, oldId);
  const fixByHand = new Set(choices.fixByHand ?? []);
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
    const category = categoryOf(changes);
    entries.push({
      category,
      oldId: before.id,
      newId: p.id,
      paired: m.paired,
      displayName: p.displayName,
      ...(before.displayName === p.displayName ? {} : { oldDisplayName: before.displayName }),
      ownerLabel: ownerLabel(newOwners, p),
      ...withWhere(where.get(before.id)),
      changes,
      ...treatmentOf(category, cutBefore(before.id), fixByHand.has(p.id)),
      ...(category === 'changedFinishing' ? { flags: flagsOf(changes, job.progress?.[before.id]) } : {}),
      ...(category === 'changedCut' && cutBefore(before.id) ? { fixText: describeChange(before, p, old, next) } : {}),
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
      treatment: cutBefore(p.id) ? 'spare' : 'drop',
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

/**
 * The Parts a re-import leaves to nest at the next Regenerate, by new id: Added and Changed (cut), except
 * those fixed by hand.
 */
function diffNestTargets(d: Diff): string[] {
  return d.entries.flatMap((e) =>
    (e.category === 'added' || e.category === 'changedCut') && e.treatment !== 'fixByHand' && e.newId !== undefined
      ? [e.newId]
      : [],
  );
}

/** "Print labels for this re-import": the Renamed, Changed and Added Parts, by new id (diff order). */
function reimportLabelIds(d: Diff): string[] {
  const kinds: readonly Category[] = ['renamed', 'changedCut', 'changedFinishing', 'added'];
  return d.entries.flatMap((e) => (kinds.includes(e.category) && e.newId !== undefined ? [e.newId] : []));
}

/**
 * The id alias (`JobDocument.idAliases`, resolved by progress.ts `resolveAlias`) after a re-import: every
 * old id maps straight to the current one. Earlier aliases follow
 * the new renames, and an id that is live again stops being an alias.
 */
function extendAliases(
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
 * - Ticks and Saw/CNC choices move to the new Part ids, and the id alias records old -> new for good.
 * - Each Changed and Removed Part gets its `treatment` (see `Treatment`): a Remake is marked in the Plan
 *   and its ticks cleared; Fix by hand keeps its ticks, adds a `handFixes` text and clears Manual ops;
 *   Changed (finishing) clears Banded and/or Manual ops; a Removed Part already cut becomes a Spare
 *   (ticks kept under its old id) and one never cut loses its ticks.
 * - The stored Plan stays (only Regenerate changes Blanks, Boards and Offcuts) with its Part ids moved.
 *   A Changed (cut) Part not cut yet, and a Removed Part, leaves a greyed void where it sits on a Locked
 *   Blank (or a Locked Board, for a Saw Part), so that Blank's DXF and page don't change; anywhere else it
 *   is taken off, so the next Regenerate nests it in the needs-nesting order. Side B files and Manual ops
 *   are recomputed from the new export, so each Part's applicable Steps are. An unplanned Job has no Plan.
 * - The Plan is marked stale with the Parts that need nesting.
 * - A re-import log entry is added (with the label batch), and the document as it was is kept for
 *   "Revert last re-import".
 */
export function applyDiff(doc: JobDocument, current: Model, next: NextExport, d: Diff, now: string): JobDocument {
  const renames = d.renames;
  const live = new Set(next.model.parts.map((p) => p.id));
  const sawCncOverrides = Object.fromEntries(
    Object.entries(renameKeys(doc.sawCncOverrides, renames)).filter(([id]) => live.has(id)),
  );
  const carried = (doc.stale?.needsNesting ?? []).map((id) => renames[id] ?? id).filter((id) => live.has(id));
  const nesting = diffNestTargets(d);

  const oldParts = new Map(current.parts.map((p) => [p.id, p]));
  const oldWhere = locations(doc.plan);
  let progress = renameKeys(doc.progress, renames);
  // The Side A pages of Locked Blanks keep what they were printed with, whatever the new export says.
  let plan = doc.plan && renamePlanParts(freezeLockedPages(doc.plan, current, (id) => isCut(doc.progress, id)), renames);
  const handFixes: Record<string, string[]> = Object.fromEntries(
    Object.entries(renameKeys(doc.handFixes, renames)).filter(([id]) => live.has(id)),
  );
  const spares: Spare[] = doc.spares.filter((s) => !live.has(s.partId));
  const vacate = new Map<string, VoidReason>();

  for (const e of d.entries) {
    const id = e.newId ?? e.oldId;
    if (id === undefined) continue;
    switch (e.treatment) {
      case 'remake':
        if (plan) plan = remakePart(plan, id);
        progress = withoutPart(progress, id);
        break;
      case 'fixByHand':
        handFixes[id] = [...(handFixes[id] ?? []), e.fixText ?? 'changed'];
        progress = withoutSteps(progress, id, ['manualOps']);
        break;
      case 'nest':
        vacate.set(id, 'moved');
        break;
      case 'clearSteps':
        progress = withoutSteps(progress, id, clearedSteps(e.changes));
        break;
      case 'spare': {
        const before = oldParts.get(id);
        if (before) spares.push(spareOf(before, oldWhere.get(id), now));
        vacate.set(id, 'spare');
        break;
      }
      case 'drop':
        progress = withoutPart(progress, id);
        vacate.set(id, 'removed');
        break;
      case undefined:
        break;
    }
  }
  if (plan) {
    const cut = (id: string) => isCut(progress, id);
    plan = withSteps(vacatePlan(plan, vacate, cut), withHandFixes(next.model, handFixes));
  }

  return {
    ...doc,
    fileName: next.fileName,
    rawExport: next.rawExport,
    sheetCodes: carrySheetCodes(current, next.model, doc.sheetCodes, d.changedSheets),
    sawCncOverrides,
    progress,
    plan,
    stale: doc.plan
      ? {
          needsNesting: [...carried.filter((id) => !nesting.includes(id)), ...nesting],
          ...(doc.stale?.olderPlan ? { olderPlan: true as const } : {}),
        }
      : null,
    idAliases: extendAliases(doc.idAliases, renames),
    handFixes,
    spares,
    reimportLog: [
      ...doc.reimportLog,
      {
        at: now,
        ...(next.model.exportedAt === undefined ? {} : { exportedAt: next.model.exportedAt }),
        fileName: next.fileName,
        counts: d.counts,
        labelIds: reimportLabelIds(d),
      },
    ],
    previous: { ...doc, previous: null },
    updatedAt: now,
  };
}

/** The Steps a Changed (finishing) Part loses: Banded when its Edgebands changed, Manual ops when those did. */
export function clearedSteps(changes: readonly Change[]): Step[] {
  return [
    ...(changes.includes('edgebands') ? (['banded'] as const) : []),
    ...(changes.includes('manualOps') ? (['manualOps'] as const) : []),
  ];
}

function withoutPart(progress: Progress, id: string): Progress {
  return Object.fromEntries(Object.entries(progress).filter(([key]) => key !== id));
}

function withoutSteps(progress: Progress, id: string, clear: readonly Step[]): Progress {
  const ticks = progress[id];
  if (!ticks) return progress;
  const rest: PartTicks = Object.fromEntries(
    Object.entries(ticks).filter(([step]) => !(clear as readonly string[]).includes(step)),
  );
  const out = withoutPart(progress, id);
  if (Object.keys(rest).length > 0) out[id] = rest;
  return out;
}

function spareOf(part: Part, where: string | undefined, at: string): Spare {
  return {
    partId: part.id,
    displayName: part.displayName,
    cutLength: part.cutLength,
    cutWidth: part.cutWidth,
    thickness: part.thickness,
    ...(where === undefined ? {} : { where }),
    at,
  };
}

/**
 * Takes Parts off the stale Plan. On a Locked Blank (a Saw Part: on a Locked Board) the placement stays as
 * a greyed void, so nothing there is redrawn; anywhere else it goes, so the next Regenerate nests it.
 */
function vacatePlan(plan: Plan, vacate: ReadonlyMap<string, VoidReason>, cut: (id: string) => boolean): Plan {
  if (vacate.size === 0) return plan;
  const mark = <T extends Placement | SawPlacement>(list: readonly T[], keep: boolean): T[] =>
    list.flatMap((p) => {
      const reason = vacate.get(p.partId);
      if (reason === undefined || !isLive(p)) return [p];
      return keep ? [{ ...p, voided: reason }] : [];
    });
  return {
    ...plan,
    sheets: plan.sheets.map((sheet) => ({
      ...sheet,
      boards: sheet.boards.map((board) => {
        const locked = boardLocked(board, cut);
        return {
          ...board,
          blanks: board.blanks.map((blank) => ({
            ...blank,
            parts: mark(blank.parts, locked && blankLocked(blank, cut)),
          })),
          sawParts: mark(board.sawParts, locked),
        };
      }),
      unplaced: sheet.unplaced.filter((id) => !vacate.has(id)),
    })),
  };
}

/** The Plan with Side B files and Manual ops (so every Part's applicable Steps) recomputed for `model`. */
function withSteps(plan: Plan, model: Model): Plan {
  const order = partRunOrder(plan);
  const placed = new Set(order);
  const rest = model.parts.map((p) => p.id).filter((id) => !placed.has(id));
  const { files, manualOps } = sideB(model, plan.settings, [...order, ...rest]);
  return { ...plan, sideB: files, manualOps };
}

/**
 * What a greyed void left by a re-import says (`Placement.voided`): "moved to W18-2-A #1" (or "moved: needs
 * nesting" until a Regenerate nests it), "removed from the export", or "Spare". Undefined when the Part has
 * no void in the Plan.
 */
export function voidText(plan: Plan, partId: string): string | undefined {
  const reason = plan.sheets
    .flatMap((s) => s.boards.flatMap((b) => [...b.blanks.flatMap((x) => x.parts), ...b.sawParts]))
    .find((p) => p.partId === partId && p.voided !== undefined)?.voided;
  switch (reason) {
    case undefined:
      return undefined;
    case 'moved': {
      const where = partLocations(plan).get(partId);
      return where === undefined || where === 'needs nesting' ? 'moved: needs nesting' : `moved to ${where}`;
    }
    case 'removed':
      return 'removed from the export';
    case 'spare':
      return 'Spare';
  }
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

/** The Sheet code overrides after a re-import (see applyDiff). */
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

const FLAGS: Partial<Record<Step, string>> = {
  banded: 'banding changed after it was banded',
  manualOps: 'Manual ops changed after they were done',
};

function flagsOf(changes: readonly Change[], ticks: PartTicks | undefined): string[] {
  return clearedSteps(changes).flatMap((step) => (ticks?.[step] === undefined ? [] : [FLAGS[step] ?? step]));
}

function treatmentOf(category: Category, cut: boolean, fixByHand: boolean): { treatment?: Treatment } {
  if (category === 'changedCut') return { treatment: cut ? (fixByHand ? 'fixByHand' : 'remake') : 'nest' };
  if (category === 'changedFinishing') return { treatment: 'clearSteps' };
  return {};
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
/** Manual ops from the export: a Fix by hand text (`handFixes`) is the Job's, not the export's. */
const manualOps = (ops: readonly ManualOp[]) =>
  ops.filter((o) => o.reason !== 'fixByHand').map((o) => [o.reason, o.face, o.text]);

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
    ...sheet.boards.flatMap(livePartIds),
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
      // A Remake Part greyed on its old Blank (#37) is not cut there any more.
      for (const blank of board.blanks) {
        for (const p of blank.parts) if (isLive(p)) where.set(p.partId, `${blank.id} #${String(p.n)}`);
      }
      for (const p of board.sawParts) if (isLive(p)) where.set(p.partId, `Saw · ${boardId(sheet, board)}`);
    }
  }
  return where;
}
