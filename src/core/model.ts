// The domain model built by Import from a Parts Export, read by the Planner.
// All lengths are integer µm, as in the export.
import type { Op as ExportOp } from './import/parts-export.v1.generated.ts';

/** A point in a Part's cut frame: origin at the min-X, min-Y corner of the cut piece. */
export interface Point {
  x: number;
  y: number;
}

/** A machining op on one face, in the Part's cut frame. Depths in µm; `through` = the full thickness. */
export type CncOp =
  | { kind: 'drill'; at: Point; diameter: number; depth: number | 'through' }
  | { kind: 'groove'; from: Point; to: Point; width: number; depth: number }
  | {
      kind: 'pocket';
      centre: Point;
      /** Along the Part's X. */
      length: number;
      /** Along the Part's Y. */
      width: number;
      depth: number;
    };

export interface Sheet {
  id: string;
  name: string;
  /** Short code used in Blank ids, e.g. `W18`. Derived; editable later. */
  code: string;
  thickness: number;
  length: number;
  width: number;
  grain: 'length' | 'none';
}

export interface Owner {
  kind: 'cabinet' | 'generatedItem';
  id: string;
  /** The Owner label: the Cabinet Label (`B3`) or the Generated Item's `label` ("Toe Kick B2"). */
  label: string;
  /** Cabinets only: the Library Cabinet name, shown after the label where there is room ("B3 · Base door"). */
  cabinetName?: string;
  /** Generated Items only: the kind (`toeKick`). */
  itemKind?: string;
}

export interface Part {
  /** Export Part id. Opaque: never parsed. */
  id: string;
  /** The export's raw `name` (Part path or kind). Shown only in the Part detail panel. */
  name: string;
  /** The Part name ("Left side", "Section 2 · Shelf 1"); `""` when it only repeated the Generated Item kind. */
  partName: string;
  /** How the Part is shown everywhere: `<Owner label> · <Part name>` ("B3 · Left side", "Toe Kick B2"). */
  displayName: string;
  ownerId: string;
  sheetId: string;
  thickness: number;
  cutLength: number;
  cutWidth: number;
  /** `length`: the Part's X must follow the Board length. `none`: may rotate. */
  grain: 'length' | 'none';
  /** `top`-face ops, moved from the finished frame into the cut frame. */
  top: CncOp[];
  /**
   * Blind `bottom`-face ops in the cut frame (seen from the top, like `top`). Not on Side A: the ones whose
   * kind isn't set to manual in Machine settings make this a Flip Part (the Planner decides, ticket #28).
   * Through `bottom` ops are mirrored into `top` on import.
   */
  bottom: CncOp[];
  /** Ops no file can carry: edge-face ops and ops the DXF grammar can't draw. Done by hand. */
  manualOps: ManualOp[];
  /** Edgeband ids by edge, as in the export (`{}` = unbanded). A banded Part gets the Banded Step. */
  edges: PartEdges;
}

/** Edgeband id per banded edge of a Part. A missing edge is unbanded. */
export interface PartEdges {
  x0?: string;
  xL?: string;
  y0?: string;
  yW?: string;
}

/** An edge of a Part: `x0`/`xL` at the ends of its X (they run along Y), `y0`/`yW` along X. */
export type PartEdge = keyof PartEdges;

/** An Edgeband from the export's library. */
export interface Edgeband {
  id: string;
  name: string;
  thickness: number;
  width: number;
}

/** A Part face, as the export names it. */
export type Face = ExportOp['face'];

/**
 * An op done by hand, on paper only: an edge-face op (`edge`), a `bottom` op whose kind is set to manual
 * in Machine settings (`manualKind`, added by the Planner), or something the DXF grammar can't draw, such
 * as a mitred end or a diagonal groove (`notDrawable`).
 */
export interface ManualOp {
  reason: 'edge' | 'manualKind' | 'notDrawable';
  face: Face;
  /**
   * Spelled out for the PDF and the label, in mm ("Drill Ø8 × 30 deep on x0 at y 260, z 9"). Edge-face ops
   * and mitres use the export's finished frame (they're done after banding); `bottom` and `top` ops use the
   * cut frame, measured from the cut edges like Side B.
   */
  text: string;
}

export interface Model {
  projectName: string;
  /** In export order (by id, shortest first). */
  sheets: Sheet[];
  /** In export order. */
  edgebands: Edgeband[];
  /** Cabinets, then Generated Items, in export order. */
  owners: Owner[];
  /** In export order. */
  parts: Part[];
}
