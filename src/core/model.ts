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
  /** Cabinet Label (`B3`) or the Generated Item's `label`. */
  label: string;
}

export interface Part {
  /** Export Part id. Opaque: never parsed. */
  id: string;
  /** The export's raw `name` (Part path or kind). */
  name: string;
  ownerId: string;
  sheetId: string;
  thickness: number;
  cutLength: number;
  cutWidth: number;
  /** `length`: the Part's X must follow the Board length. `none`: may rotate. */
  grain: 'length' | 'none';
  /** `top`-face ops, moved from the finished frame into the cut frame. */
  top: CncOp[];
  /** `bottom`-face ops in the cut frame (seen from the top, like `top`). Not on Side A. */
  bottom: CncOp[];
  /** Edge-face ops (`x0`, `xL`, `y0`, `yW`), kept verbatim from the export. Manual ops. */
  edgeOps: ExportOp[];
}

export interface Model {
  projectName: string;
  /** In export order (by id, shortest first). */
  sheets: Sheet[];
  /** Cabinets, then Generated Items, in export order. */
  owners: Owner[];
  /** In export order. */
  parts: Part[];
}
