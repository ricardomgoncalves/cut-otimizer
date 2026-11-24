/* Generated from vendor/parts-export/parts-export.v1.schema.json by scripts/gen-types.ts. Do not edit; run `bun run gen:types`. */

/**
 * Semver version of the Parts Export format this file conforms to. This schema accepts major version 1 only.
 *
 * This interface was referenced by `PartsExport`'s JSON-Schema
 * via the `definition` "SchemaVersion".
 */
export type SchemaVersion = string;
/**
 * A Library id: a 64-bit snowflake written as a decimal string. Opaque.
 *
 * This interface was referenced by `PartsExport`'s JSON-Schema
 * via the `definition` "LibraryId".
 */
export type LibraryId = string;
/**
 * A strictly positive length in integer micrometres.
 *
 * This interface was referenced by `PartsExport`'s JSON-Schema
 * via the `definition` "Size".
 */
export type Size = number;
/**
 * A planner id (Room, Wall, Cabinet, Generated Item or Part). Opaque: never parse it. Unique within its table in one file.
 *
 * This interface was referenced by `PartsExport`'s JSON-Schema
 * via the `definition` "Id".
 */
export type Id = string;
/**
 * A length or position in integer micrometres.
 *
 * This interface was referenced by `PartsExport`'s JSON-Schema
 * via the `definition` "Length".
 */
export type Length = number;
/**
 * This interface was referenced by `PartsExport`'s JSON-Schema
 * via the `definition` "GeneratedItemKind".
 */
export type GeneratedItemKind = 'filler' | 'endPanel' | 'islandPanel' | 'toeKick' | 'crown' | 'lightRail';
/**
 * A signed axis of the owner's frame.
 *
 * This interface was referenced by `PartsExport`'s JSON-Schema
 * via the `definition` "Axis".
 */
export type Axis = '+X' | '-X' | '+Y' | '-Y' | '+Z' | '-Z';
/**
 * This interface was referenced by `PartsExport`'s JSON-Schema
 * via the `definition` "Op".
 */
export type Op = Drill | Groove | Pocket;
/**
 * A hole into `face` at `at`: vertical on top/bottom, horizontal on an edge. Exactly one of `depth` or `through`.
 *
 * This interface was referenced by `PartsExport`'s JSON-Schema
 * via the `definition` "Drill".
 */
export type Drill = {
  type: 'drill';
  face: Face;
  at: FacePoint;
  diameter: Size;
  depth?: Size;
  through?: true;
  source: Source;
} & Drill1;
/**
 * A face of a Part, named by its local axis as in the Library: `top`/`bottom` (normal ±Z), `x0`/`xL` the ends (normal −X/+X), `y0`/`yW` the long edges (normal −Y/+Y).
 *
 * This interface was referenced by `PartsExport`'s JSON-Schema
 * via the `definition` "Face".
 */
export type Face = 'top' | 'bottom' | 'x0' | 'xL' | 'y0' | 'yW';
/**
 * Why the op exists. Consumers may ignore it.
 *
 * This interface was referenced by `PartsExport`'s JSON-Schema
 * via the `definition` "Source".
 */
export type Source = OpSource | HardwareSource;
export type Drill1 = {
  [k: string]: unknown;
};
/**
 * An edge of a Part, for banding and ends: `x0`/`xL` across the ends, `y0`/`yW` along the length.
 *
 * This interface was referenced by `PartsExport`'s JSON-Schema
 * via the `definition` "Edge".
 */
export type Edge = 'x0' | 'xL' | 'y0' | 'yW';

/**
 * Parts Export schema v1: every Part to be cut from one cabinet-planner Project, with sizes, Material, banding, position and machining, for a separate optimiser/CAM app. Lengths are integer micrometres everywhere. Read parts-export.v1.guide.md for the rules JSON Schema cannot express.
 */
export interface PartsExport {
  format: 'cabinet-planner/parts-export';
  schemaVersion: SchemaVersion;
  /**
   * Every length in this file is an integer number of micrometres (19.6 mm is 19600).
   */
  units: 'um';
  /**
   * When the file was written, UTC, RFC 3339.
   */
  exportedAt: string;
  generator: {
    name: string;
    version: string;
  };
  project: {
    name: string;
  };
  /**
   * The Library the Project's Cabinets were evaluated against.
   */
  library: {
    id: LibraryId;
    name: string;
  };
  /**
   * Only the Sheets and Edgebands some Part uses, copied from the Library's Catalogue. Sorted by id as the Library sorts ids.
   */
  materials: {
    sheets: Sheet[];
    edgebands: Edgeband[];
  };
  /**
   * Every Room that owns at least one exported or skipped Cabinet or Generated Item, in Project order.
   */
  rooms: Room[];
  /**
   * Every Cabinet that owns at least one exported Part.
   */
  cabinets: Cabinet[];
  /**
   * Every Generated Item segment that owns at least one exported Part. A Generated Item that follows a Run Chain round a Corner is one entry per Wall Face, sharing `chain`.
   */
  generatedItems: GeneratedItem[];
  /**
   * One entry per physical piece to cut. There is no quantity: identical pieces are separate entries.
   */
  parts: Part[];
  /**
   * Cabinets and Generated Items the user chose to export without. Empty when the job is complete.
   */
  skipped: Skipped[];
}
/**
 * This interface was referenced by `PartsExport`'s JSON-Schema
 * via the `definition` "Sheet".
 */
export interface Sheet {
  id: LibraryId;
  name: string;
  thickness: Size;
  sheetLength: Size;
  sheetWidth: Size;
  /**
   * `length`: the decor runs along `sheetLength`. `none`: ungrained.
   */
  grain: 'length' | 'none';
}
/**
 * This interface was referenced by `PartsExport`'s JSON-Schema
 * via the `definition` "Edgeband".
 */
export interface Edgeband {
  id: LibraryId;
  name: string;
  thickness: Size;
  width: Size;
}
/**
 * This interface was referenced by `PartsExport`'s JSON-Schema
 * via the `definition` "Room".
 */
export interface Room {
  id: Id;
  name: string;
}
/**
 * This interface was referenced by `PartsExport`'s JSON-Schema
 * via the `definition` "Cabinet".
 */
export interface Cabinet {
  id: Id;
  /**
   * The Cabinet Label (`B3`), as stored in the Project. Unique in the file ignoring case.
   */
  label: string;
  roomId: Id;
  wallFace: WallFace;
  libraryCabinetId: LibraryId;
  libraryCabinetName: string;
  /**
   * The Library Cabinet's Folder path, segments joined by `/` (`Kitchen/Base`). Empty at the Library root.
   */
  folder: string;
  placementType: 'base' | 'wall' | 'tall' | 'panel';
  /**
   * The Cabinet's Outside box in its own frame: evaluated Parts plus leg Hardware.
   */
  outsideBox: {
    width: Size;
    height: Size;
    depth: Size;
  };
  toRoom: ToRoom;
}
/**
 * One side of a Wall: `left` or `right` as seen walking from its start Corner to its end Corner.
 *
 * This interface was referenced by `PartsExport`'s JSON-Schema
 * via the `definition` "WallFace".
 */
export interface WallFace {
  wallId: Id;
  side: 'left' | 'right';
}
/**
 * Places an owner's frame in its Room's frame: rotate the owner frame by `yaw` about +Y, then translate by `origin` (guide, Positions).
 *
 * This interface was referenced by `PartsExport`'s JSON-Schema
 * via the `definition` "ToRoom".
 */
export interface ToRoom {
  origin: Point3;
  /**
   * Degrees counter-clockwise about +Y seen from above, 0 ≤ yaw < 360, rounded to 0.01°.
   */
  yaw: number;
}
/**
 * Where the owner frame's origin lies in the Room frame.
 */
export interface Point3 {
  x: Length;
  y: Length;
  z: Length;
}
/**
 * This interface was referenced by `PartsExport`'s JSON-Schema
 * via the `definition` "GeneratedItem".
 */
export interface GeneratedItem {
  id: Id;
  /**
   * Derived, for people: the kind, the Label of its Run's first Cabinet, and the end or Cabinet where that applies (`Toe Kick B1`, `End Panel B1 start`, `Filler B2`). Not unique and not stable: match on `id`.
   */
  label: string;
  roomId: Id;
  kind: GeneratedItemKind;
  wallFace: WallFace;
  layer: 'lower' | 'upper';
  /**
   * Shared by the segments of one Generated Item that follows a Run Chain round Corners; null when it stays on one Wall Face.
   */
  chain: Id | null;
  toRoom: ToRoom;
}
/**
 * This interface was referenced by `PartsExport`'s JSON-Schema
 * via the `definition` "Part".
 */
export interface Part {
  /**
   * A planner id (Room, Wall, Cabinet, Generated Item or Part). Opaque: never parse it. Unique within its table in one file.
   */
  id: string;
  /**
   * For a Cabinet Part, the Library Part name with the copy indices of every repeated entry, outermost first (`s0.shelf[2]`). For a Generated Item Part, its kind.
   */
  name: string;
  owner: Owner;
  /**
   * The Library Cabinet's Sheet slot name the Part is cut from (`carcass`). Cabinet Parts only.
   */
  materialSlot?: string;
  sheetId: LibraryId;
  /**
   * A strictly positive length in integer micrometres.
   */
  thickness: number;
  /**
   * A strictly positive length in integer micrometres.
   */
  length: number;
  /**
   * A strictly positive length in integer micrometres.
   */
  width: number;
  /**
   * A strictly positive length in integer micrometres.
   */
  cutLength: number;
  /**
   * A strictly positive length in integer micrometres.
   */
  cutWidth: number;
  /**
   * Effective grain: `length` when local X must follow the Sheet's grain (the Part asks for it and the Sheet is grained); otherwise `none`, and nesting may rotate the Part.
   */
  grain: 'length' | 'none';
  /**
   * The Edgeband id on each banded edge. A missing key is an unbanded edge.
   */
  edges: {
    x0?: LibraryId;
    xL?: LibraryId;
    y0?: LibraryId;
    yW?: LibraryId;
  };
  /**
   * Ends that are not square. Omitted when both are square.
   */
  ends?: {
    x0?: End;
    xL?: End;
  };
  place: Place;
  /**
   * Every machining operation, fully evaluated and expanded: one entry per hole, groove or pocket.
   */
  ops: Op[];
}
/**
 * This interface was referenced by `PartsExport`'s JSON-Schema
 * via the `definition` "Owner".
 */
export interface Owner {
  kind: 'cabinet' | 'generatedItem';
  id: Id;
}
/**
 * This interface was referenced by `PartsExport`'s JSON-Schema
 * via the `definition` "End".
 */
export interface End {
  mitre: Mitre;
}
/**
 * A mitred end, cut through the thickness in the Part's X–Z plane.
 *
 * This interface was referenced by `PartsExport`'s JSON-Schema
 * via the `definition` "Mitre".
 */
export interface Mitre {
  /**
   * Degrees away from a square cut, 0 < angle < 90, rounded to 0.01°.
   */
  angle: number;
  /**
   * The face on which this end reaches the long point; `length` is measured there.
   */
  longFace: 'top' | 'bottom';
}
/**
 * The Part in its owner's frame, as Library `place`: `at` is the minimum corner of its bounding box, `length` the owner axis local X follows, `top` the direction local Z (the top face) points. Local Y is top × length.
 *
 * This interface was referenced by `PartsExport`'s JSON-Schema
 * via the `definition` "Place".
 */
export interface Place {
  at: Point31;
  length: Axis;
  top: Axis;
}
/**
 * This interface was referenced by `PartsExport`'s JSON-Schema
 * via the `definition` "Point3".
 */
export interface Point31 {
  x: Length;
  y: Length;
  z: Length;
}
/**
 * A point on a Part face in the Part's own frame. Exactly the two axes of the face: `x`,`y` on top/bottom; `y`,`z` on x0/xL; `x`,`z` on y0/yW (guide, Machining).
 *
 * This interface was referenced by `PartsExport`'s JSON-Schema
 * via the `definition` "FacePoint".
 */
export interface FacePoint {
  x?: Length;
  y?: Length;
  z?: Length;
}
/**
 * An operation the Library Cabinet's Author wrote on the Part.
 *
 * This interface was referenced by `PartsExport`'s JSON-Schema
 * via the `definition` "OpSource".
 */
export interface OpSource {
  kind: 'op';
  /**
   * The op's index in the Library Part's `ops`.
   */
  index: number;
}
/**
 * A hole drilled for a Hardware placement's Mount (including holes-only placements such as Pin hole columns).
 *
 * This interface was referenced by `PartsExport`'s JSON-Schema
 * via the `definition` "HardwareSource".
 */
export interface HardwareSource {
  kind: 'hardware';
  /**
   * The Library's Hardware kind (`hinge`, `mounting-plate`, `shelf-support`, …).
   */
  hardwareKind: string;
  itemId: LibraryId;
  itemName: string;
  /**
   * The drill pattern name on the item (`cup`, `plate`, `pin`).
   */
  pattern: string;
  /**
   * The placement copy, as a Library Violation subject: `hardware:<owner>/<index>` plus copy indices (`hardware:s0.door.leaf/0[1,0]`).
   */
  placement: string;
}
/**
 * A straight slot on `face`; `from`/`to` are the ends of its centre line, the width centred on it.
 *
 * This interface was referenced by `PartsExport`'s JSON-Schema
 * via the `definition` "Groove".
 */
export interface Groove {
  type: 'groove';
  face: Face;
  from: FacePoint;
  to: FacePoint;
  width: Size;
  depth: Size;
  source: Source;
}
/**
 * A rectangular recess on `face`, `length` along the face's u axis and `width` along v.
 *
 * This interface was referenced by `PartsExport`'s JSON-Schema
 * via the `definition` "Pocket".
 */
export interface Pocket {
  type: 'pocket';
  face: Face;
  centre: FacePoint;
  length: Size;
  width: Size;
  cornerRadius: number;
  depth: Size;
  source: Source;
}
/**
 * This interface was referenced by `PartsExport`'s JSON-Schema
 * via the `definition` "Skipped".
 */
export interface Skipped {
  kind: 'cabinet' | 'generatedItem';
  id: Id;
  /**
   * The Cabinet Label, or the Generated Item's derived label, as in `cabinets` and `generatedItems`.
   */
  label: string;
  roomId: Id;
  /**
   * The Library Cabinet's name, or the Generated Item's kind.
   */
  name: string;
  /**
   * `invalid`: a Cabinet with an error Violation. `placeholder`: a Cabinet whose Library Cabinet is missing. `noMaterial`: a Generated Item with no Material to cut from.
   */
  reason: 'invalid' | 'placeholder' | 'noMaterial';
  /**
   * Violation codes for `invalid` (`hardware.fit`, `check.minWidth`, …); empty otherwise.
   */
  problems: string[];
}
