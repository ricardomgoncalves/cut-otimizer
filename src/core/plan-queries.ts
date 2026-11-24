// Plan queries and edits: what the rest of the core asks of a stored Plan (which Parts a Board gives now,
// what is Locked) and the two hand edits the Job makes to it between re-plans (Remake, Discard an Offcut),
// which the next `plan` reads back through `PlanPrior.plan`. The Planner itself only plans:
// `plan(model, settings, prior)`.
import type { Blank, Board, Offcut, Plan, VoidReason } from './planner/index.ts';

/** A Placement or Saw Part that is cut here now: not a greyed Remake and not a void. */
export function isLive(p: { remade?: boolean; voided?: VoidReason }): boolean {
  return p.remade !== true && p.voided === undefined;
}

/** The Parts a Board gives now: its Blanks' Parts, then its Saw Parts, leaving out Remakes and voids (greyed). */
export function livePartIds(board: Board): string[] {
  return [
    ...board.blanks.flatMap((b) => b.parts.filter(isLive).map((p) => p.partId)),
    ...board.sawParts.filter(isLive).map((p) => p.partId),
  ];
}

/**
 * Locked: a Part on it is ticked Cut, or a Remake Part was cut from it. A Remake clears the Part's ticks
 * but its old Blank stays Locked.
 */
export function boardLocked(board: Board, isCut: (partId: string) => boolean): boolean {
  return board.blanks.some((b) => blankLocked(b, isCut)) || board.sawParts.some((p) => p.remade === true || isCut(p.partId));
}

/** A Blank with a Part ticked Cut, or a Remake Part on it. */
export function blankLocked(blank: Blank, isCut: (partId: string) => boolean): boolean {
  return blank.parts.some((p) => p.remade === true || isCut(p.partId));
}

/**
 * Marks a Part **Remake** in a Plan: where it is on a Board now, it stays greyed out (`remade`), and the
 * next plan nests it again. Unchanged when the Part is on no Board.
 */
export function remakePart(plan: Plan, partId: string): Plan {
  const mark = <T extends { partId: string; remade?: boolean; voided?: VoidReason }>(p: T): T =>
    p.partId === partId && isLive(p) ? { ...p, remade: true } : p;
  return mapBoards(plan, (board) =>
    livePartIds(board).includes(partId)
      ? {
          ...board,
          blanks: board.blanks.map((b) => ({ ...b, parts: b.parts.map(mark) })),
          sawParts: board.sawParts.map(mark),
        }
      : board,
  );
}

/** Discards a kept Offcut (no longer stock), or undoes that. Unchanged for an unknown or used Offcut. */
export function discardOffcut(plan: Plan, offcutId: string, discarded: boolean): Plan {
  return mapBoards(plan, (board) =>
    board.offcuts.some((o) => o.id === offcutId && o.kept && !o.used)
      ? {
          ...board,
          offcuts: board.offcuts.map((o) => {
            if (o.id !== offcutId) return o;
            const rest: Offcut = Object.fromEntries(Object.entries(o).filter(([k]) => k !== 'discarded')) as Offcut;
            return discarded ? { ...rest, discarded: true } : rest;
          }),
        }
      : board,
  );
}

function mapBoards(plan: Plan, f: (board: Board) => Board): Plan {
  let changed = false;
  const sheets = plan.sheets.map((sheet) => {
    const boards = sheet.boards.map((b) => {
      const out = f(b);
      if (out !== b) changed = true;
      return out;
    });
    return boards.some((b, i) => b !== sheet.boards[i]) ? { ...sheet, boards } : sheet;
  });
  return changed ? { ...plan, sheets } : plan;
}
