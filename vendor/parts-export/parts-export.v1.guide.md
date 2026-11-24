# Parts Export schema v1: guide

This guide goes with [`parts-export.v1.schema.json`](parts-export.v1.schema.json). The JSON Schema fixes the shape of the file. This guide fixes the rules a schema can't express: what the numbers mean, the frames, how ids are built, and what the file leaves out.

The **Parts Export** lists every Part to cut from one Project, for a separate app that runs the optimiser and CAM. Capitalised terms (Part, Cabinet, Generated Item, Run, Wall Face, …) are defined in [`GLOSSARY.md`](../../GLOSSARY.md). Part geometry follows the Library's own conventions on purpose, so read the Library guide's [Parts and Machining Operations sections](../library-schema/cabinet-library.v1.guide.md#parts) next to this one. The decisions behind this format are in the issue "Parts Export schema".

[`examples/kitchen.parts.json`](examples/kitchen.parts.json) is an **abridged** example that validates against the schema: the planner's export of the example kitchen ([`../project-file/examples/kitchen.project.json`](../project-file/examples/kitchen.project.json) with the sample Library, a 140 mm Toe kick board on each Cabinet and a Placeholder added), cut down by hand. It has two Cabinets, a Toe Kick that turns a Corner, and one skipped Placeholder. Each Cabinet shows only some of its Parts, some Parts only their first ops, and the End Panels are left out, so the file stays readable. A test checks that the export, abridged the same way, is this file byte for byte.

## 1. Conventions

**Lengths are integer micrometres (µm)** everywhere: sizes, positions, thicknesses, diameters and depths. 19.6 mm is `19600`. `"units": "um"` says so in the file. This is the Library's unit and the planner's internal unit (ADR-0002), so values come straight out of the evaluator with no rounding. Angles are decimal degrees rounded to 0.01°.

**Ids.** Library ids (`libraryCabinetId`, `sheetId`, Edgeband and Hardware item ids, `library.id`) are the Library's snowflake strings, copied as they are. Planner ids (Rooms, Walls, Cabinets, Generated Items, Parts) are opaque strings. Never parse them. Each is unique within its table in one file (section 3).

**Versioning.** `schemaVersion` is semver, with the Library's rules. A consumer rejects a major version it doesn't know and ignores fields it doesn't know within a known major. A minor release only adds optional fields. The schema is strict (`additionalProperties: false`), so validate a newer minor against its own schema file.

**Deterministic output.** JSON with a 2-space indent and a trailing newline, keys in the order the schema lists them. Two exports of an unchanged Project differ only in `exportedAt`. The orders are:

- `materials.sheets`, `materials.edgebands`: by id, shortest first, then lexically (as the Library sorts).
- `rooms`: Project order.
- `cabinets`: by Room, then by Wall in the Room's order, then by position along the Wall Face from its left end.
- `generatedItems`: by Room, then by kind in the schema's enum order, then by Wall, then by position.
- `parts`: grouped by owner, owners in `cabinets` order and then `generatedItems` order. A Cabinet's Parts come in the Library's depth-first expansion order (Library guide §6, step 4). A Generated Item's split pieces come in piece order.
- `ops`: the Library Part's own ops in index order, then Hardware holes in placement order, then in the order of the pattern's holes.
- `skipped`: Cabinets in `cabinets` order, then Generated Items.

## 2. File layout

| Key | Holds |
|---|---|
| `format`, `schemaVersion`, `units`, `exportedAt`, `generator` | What the file is and who wrote it |
| `project` | The Project's name |
| `library` | The id and name of the Library the Cabinets were evaluated against |
| `materials` | The Sheets and Edgebands that some Part uses, copied from the Catalogue. Nothing else from the Catalogue |
| `rooms`, `cabinets`, `generatedItems` | Lookup tables for traceability and assembly. A Part points into them through `owner` |
| `parts` | A flat list with **one entry per physical piece**. There is no `quantity`: identical pieces are separate entries, and grouping is the optimiser's job |
| `skipped` | What the user chose to export without (section 8). Empty when the job is complete |

## 3. Identity and traceability

**Part ids are deterministic.**

- A Cabinet Part's id is `<cabinetId>/<partPath>`. The Part path is the Library Part name followed by the copy indices of every repeated entry on the way, outermost first, as in a Library Violation subject: `c1/s0.shelf[2]`, `c1/s0.door.leaf[1]`. A Part with no repeated entry above it has no brackets (`c1/leftSide`).
- A Generated Item Part's id is `<generatedItemId>/<piece>`. `piece` is 0 for an unsplit item, and 0, 1, … left to right (seen from the room) for an item in several pieces on its Wall Face: split because it is longer than its Sheet, split where its Cabinets' Toe kick or tops differ, or with a return along the side of a free Run end (a Toe Kick, Crown or Light Rail with no End Panel there).
- A Generated Item's id is built from its Run key (Wall Face, layer, first Cabinet) and its kind, e.g. `w1.left.lower.c1/toeKick`. The exact spelling is in the [Project document guide](../project-file/project.v1.guide.md#3-ids). Consumers only compare it.

A re-export of an unchanged Project gives the same ids, so the CAM side can see what changed between two exports. Ids are stable only while the structure is stable. A Run gets a new key whenever its first Cabinet changes (one placed before it, or the first one moved or deleted, or Runs merging or splitting), which changes all its Generated Item ids. Changing a repeat count changes the affected Part ids.

**Traceability.** A Part's `owner` names a `cabinets` or `generatedItems` entry, and that entry names its `roomId` and `wallFace`.

- A Cabinet Part also carries `materialSlot`, the Library Cabinet's Sheet slot it is cut from. Its `name` is the Part path.
- A Generated Item Part has no `materialSlot`. Its `name` is its kind.
- A `cabinets` entry carries `label`, `libraryCabinetId`, `libraryCabinetName` and `folder`, so a Part label can say "B3 · Base door, Kitchen/Base". `label` is the Cabinet Label stored in the Project: unique in the file, and unchanged when the Cabinet moves, so it matches the cabinet list report and the drawings.
- A `generatedItems` entry carries a derived `label` (`Toe Kick B1`, `End Panel B1 start`), built from its kind and the Label of its Run's first Cabinet. It is for people only: it may repeat and may change, so match on `id`.

Parameter values and slot choices are **not** in the file. They belong to the Project File, and cutting doesn't need them.

## 4. Material, sizes, grain and banding

- `sheetId` names a `materials.sheets` entry. `thickness` is that Sheet's thickness, copied for convenience.
- `length` (local X) and `width` (local Y) are **finished** sizes, banding included. They are authoritative, exactly as in the Library.
- `cutLength` = `length` − the Edgeband thickness on `x0` and on `xL`. `cutWidth` = `width` − the Edgeband thickness on `y0` and on `yW`. This is the Library's own rule. It includes **no shop allowances** such as pre-mill oversize or trim, which only the shop knows and adds itself.
- `grain` is the **effective** grain:
  - `length`: local X must follow the Sheet's grain. The Part asks for it and its Sheet is grained.
  - `none`: nesting may rotate the Part. Either the Part doesn't care or its Sheet is ungrained.

  A consumer never needs to cross-check the Sheet.
- `edges` maps each banded edge (`x0`, `xL`, `y0`, `yW`) to an Edgeband id in `materials.edgebands`. A missing key is an unbanded edge. Generated Items are banded by the fixed rule from "Where Parts and their machining come from": Fillers on the front, End Panels on the front plus their top or bottom, Island Panels on the top and both ends, and Toe Kick, Crown and Light Rail not at all. A Filler stands in the front plane, so its front is its face: the edges that show from the front are its two long edges, and those are banded, except a scribe Filler's edge against the Wall, which is scribed on site. A scribe Filler's `width` includes the scribe allowance.

## 5. Ends and mitres

`ends` appears only when an end isn't square. Only the Toe Kick, Crown and Light Rail have mitred ends in v1, where they turn a Corner.

```
            ← length (to the long point) →
  longFace  ┌───────────────────────────┐
            │                           │╲     angle: degrees away from square
  other     └───────────────────────────┘  ╲   (45 at a right-angled Corner)
  face        ← shorter by T·tan(angle) →
```

- A mitre is a cut **through the thickness**, in the Part's X–Z plane. It never cuts across the width.
- `angle` is degrees away from a square cut, with 0 < angle < 90. At a Corner whose two Walls meet at interior angle θ, each end's angle is (180° − θ) / 2.
- `longFace` (`top` or `bottom`) is the face on which that end reaches its long point. `length` is measured on that face, as is `cutLength`. Mitred ends are never banded.
- A split Generated Item is mitred only on its outer ends. The joints between its pieces are square butt joints.

## 6. Machining

**Frame and faces** are the Library's, unchanged. The Part's local X runs along `length`, Y along `width` and Z through the `thickness`, from 0 to T, with the origin at a corner of the bottom face. Faces are named by local axis. Each has two in-plane axes `u`, `v` and a handedness `s` (+1 when u × v points out of the Part):

| Face | Normal | u | v | s | Point keys |
|---|---|---|---|---|---|
| `top` | +Z | x | y | +1 | `x`, `y` |
| `bottom` | −Z | x | y | −1 | `x`, `y` |
| `xL` | +X | y | z | +1 | `y`, `z` |
| `x0` | −X | y | z | −1 | `y`, `z` |
| `y0` | −Y | x | z | +1 | `x`, `z` |
| `yW` | +Y | x | z | −1 | `x`, `z` |

A **face point** gives exactly the face's two axes, as coordinates in the Part's own frame: `{x, y}` on `top` and `bottom`, the point's X and Y in the Part. Depth always goes into the Part along the inward normal.

**Ops** are fully evaluated numbers. Repeats and Hardware drill patterns are **expanded**, so each hole is its own `drill`, with no row or pitch shorthand. A downstream adapter can regroup holes into rows if its machine wants that.

| Op | Fields | Meaning |
|---|---|---|
| `drill` | `face`, `at`, `diameter`, and `depth` or `through: true` | Vertical on `top`/`bottom`, horizontal on an edge. A through hole goes the whole way through the Part |
| `groove` | `face`, `from`, `to`, `width`, `depth` | A straight slot; `from`/`to` are the ends of its centre line, and the width is centred on it |
| `pocket` | `face`, `centre`, `length`, `width`, `cornerRadius`, `depth` | A rectangular recess; `length` runs along u and `width` along v |

There is no contour, cut-out or non-rectangular outline in v1, because no Library Cabinet or Generated Item produces one. A later minor version can add them.

**Sources.** Every op has a `source`, which the consumer may ignore:

- `{kind: "op", index}`: an operation the Library Cabinet's Author wrote on the Part, at that index of the Library Part's `ops`.
- `{kind: "hardware", hardwareKind, itemId, itemName, pattern, placement}`: a hole drilled for a Hardware placement's Mount. `hardwareKind` and `pattern` together (`hinge`/`cup`, `mounting-plate`/`plate`, `shelf-support`/`pin`) are what CAM would map to a macro. `placement` is the Library subject of the placement copy, e.g. `hardware:s0.door.leaf/0[0,1]`. A holes-only placement (a Pin hole column) is tagged the same way: its item is the pin type, even though the pins themselves aren't priced.

The Hardware itself (hinges, runners, legs, screws) is not in the file. It goes in the cabinet list report.

## 7. Positions

Only consumers that want an assembly view or a placement drawing need positions. The optimiser and CAM don't.

**A Part in its owner's frame.** `place` is the Library's `place`, evaluated:
- `at` is the minimum corner of the Part's bounding box in the owner frame.
- `length` is the owner axis that local X follows.
- `top` is the owner axis that local Z, the top face, points along.
- Local Y is `top × length`.

A local point maps to the owner frame per axis exactly as in the Library guide:

```
for each local axis a with extent e (length, width or thickness) and owner axis ±A:
  owner[A] = at[A] + (sign = + ? local[a] : e − local[a])
```

**Owner frames.**

- **Cabinet:** the Library's Cabinet frame. The origin is bottom-left-back of the carcass seen from the front, X is width, Y is height, and Z is depth towards the viewer, so +Z points away from the Wall Face into the room. Leg Hardware may reach below Y = 0. `outsideBox` is in this frame.
- **Generated Item segment:** the same convention, laid along its Wall Face. X runs along the face from its left end as seen when facing the face from the room, Y is up, and Z points away from the face into the room. The origin is the minimum corner of the bounding box of the segment's Parts, so `place.at` is usually all zeros.

**Owner to Room.** `toRoom: {origin, yaw}` puts an owner frame in its Room. A point `p` in the owner frame lands at:

```
room.x = origin.x + p.x · cos(yaw) + p.z · sin(yaw)
room.y = origin.y + p.y
room.z = origin.z − p.x · sin(yaw) + p.z · cos(yaw)
```

`yaw` is degrees counter-clockwise about +Y seen from above, with 0 ≤ yaw < 360. Every owner stands upright, so a yaw is the only rotation.

**Room frame.** Right-handed and Y-up, like the Cabinet frame and three.js, with the floor at Y = 0. Room X is plan x and Room Z is −plan y, from the same origin ([ADR-0005](../adr/0005-plan-to-room-frame.md)). The example puts the inside Corner where its two Walls meet at the origin.

**Corners.** A Generated Item that follows a Run Chain round a Corner (a Toe Kick, Crown or Light Rail round an L) can't share one upright frame. It is exported as **one `generatedItems` entry per Wall Face**, each with its own frame and Parts. The entries share a `chain` value, and their Parts meet at mitred ends (section 5). An item on a single Wall Face has `chain: null`.

## 8. Skipped

By default the planner refuses to write a Parts Export while anything can't be cut:
- a Cabinet with an error Violation (`invalid`);
- a Placeholder (`placeholder`);
- a Generated Item with no Material even after the `front` fallback (`noMaterial`).

The user can choose "Export without these N" instead. Each item left out is then listed in `skipped` with its `kind`, `id`, `roomId` and `name`, the `reason`, and for `invalid` the Violation codes in `problems`. Skipped items have no Parts, and they appear in neither `cabinets` nor `generatedItems`. A consumer should treat a non-empty `skipped` as an **incomplete job**. Warnings and Clashes never block, and they are not in the file.

## 9. Not in the file

- **The Countertop.** It is bought and cut by a fabricator. Its outline and joints go in the cabinet list report.
- **Hardware items.** Only their holes are here (section 6). The items go in the report.
- **Shop allowances** (trim, pre-mill oversize, kerf), and every machine decision: tools, feeds, speeds, drill modes, clamping, nesting, toolpaths and vendor face numbers.
- **Parameter values, slot choices, prices, Violations and Clashes.**

## 10. Vendor face mapping

The table is for writers of downstream converters. It comes from the research "Existing panel and machining interchange formats" ([`docs/research/parts-interchange-formats.md`](../research/parts-interchange-formats.md)), translated to the Library's face names. Rows marked † were not confirmed from a primary source.

| Our face | Normal | HOMAG MPR / CAM-manager tool direction | Biesse CIX `SIDE` |
|---|---|---|---|
| `top` | +Z | `ZM` (`BohrVert`) | 0 |
| `bottom` | −Z | `ZP` (drill from below, `LSU`) | 5 † |
| `x0` | −X | `XP` | 1 |
| `xL` | +X | `XM` | 3 |
| `y0` | −Y | `YP` | 2 |
| `yW` | +Y | `YM` | 4 |

Our Part origin is at the min-X, min-Y corner of the bottom face. That is woodWOP's default work-piece system `KO=0` ("left below") with the Part's top face up. Other vendors reach it by a fixed transform per face. A converter that machines the `bottom` face as a second setup flips the Part about its X axis: `y ← width − y`.
