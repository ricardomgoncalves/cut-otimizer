// The saw's cut table: each Breakdown cut as the person at the saw sets it up.
import type { Board, Plan, SheetPlan } from '../planner/index.ts';
import { edgeTrimFor } from '../settings.ts';
import { mmText, sizeText } from './format.ts';

export interface SawCutRow {
  /** `1`, `1a`, … as in the Breakdown drawing. */
  label: string;
  kind: 'rip' | 'cross';
  /** Fence (or track stop) setting in µm: from the edge in `from` to the near side of the blade. */
  fence: number;
  /** The edge the fence setting is measured from. */
  from: string;
  /** What the cut gives: a strip, a Blank or a Saw Part, with its size. */
  gives: string;
}

/**
 * The cuts of one Board in saw order. A rip is set from the front edge (after edge trim), then from the
 * edge the previous rip left; a crosscut from the strip's left end (after edge trim), then from the end
 * the previous crosscut left. The kerf falls beyond the fence setting, so it is in no setting.
 */
export function sawCuts(
  plan: Plan,
  sheet: SheetPlan,
  board: Board,
  nameOf: (partId: string) => string,
): SawCutRow[] {
  const trim = edgeTrimFor(plan.settings, sheet.sheetId);
  const kerf = plan.settings.sawKerf;
  const afterTrim = trim > 0 ? ' (after trim)' : '';
  const pieces = [
    ...board.blanks.map((b) => ({ ...b, label: b.id })),
    ...board.sawParts.map((p) => ({ ...p, label: `SAW · ${nameOf(p.partId)}` })),
  ];

  const rows: SawCutRow[] = [];
  let ripEdge = trim;
  let lastRip: string | null = null;
  let crossEdge = trim;
  let lastCross: string | null = null;
  let strip = '';
  for (const cut of board.cuts) {
    const cutStrip = /^\d+/.exec(cut.label)?.[0] ?? '';
    if (cutStrip !== strip) {
      crossEdge = trim;
      lastCross = null;
      strip = cutStrip;
    }
    if (cut.kind === 'rip') {
      const fence = cut.y - ripEdge;
      rows.push({
        label: cut.label,
        kind: 'rip',
        fence,
        from: lastRip === null ? `Front edge${afterTrim}` : `Cut ${lastRip}`,
        gives: `Strip ${cut.label} · ${mmText(fence)} wide`,
      });
      ripEdge = cut.y + kerf;
      lastRip = cut.label;
    } else {
      const fence = cut.x - crossEdge;
      const piece = pieces.find((p) => p.y === cut.y && p.x + p.length === cut.x);
      rows.push({
        label: cut.label,
        kind: 'cross',
        fence,
        from: lastCross === null ? `Left end${afterTrim}` : `Cut ${lastCross}`,
        gives: piece ? `${piece.label} · ${sizeText(piece.length, piece.width)}` : sizeText(fence, cut.length),
      });
      crossEdge = cut.x + kerf;
      lastCross = cut.label;
    }
  }
  return rows;
}
