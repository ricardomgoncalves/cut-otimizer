# Parts Export v1: where to look

The contract is `vendor/parts-export/parts-export.v1.schema.json`; the rules the schema can't express are
in `vendor/parts-export/parts-export.v1.guide.md` (cabinet-planner `f2da2ce`). Read those, not this.
This is a map for later tickets.

## Top level (schema `required`, guide §2)
`format`, `schemaVersion` (`^1.x.y`; reject other majors, guide §1 Versioning), `units` (`"um"`),
`exportedAt`, `generator`, `project.name`, `library`, `materials.{sheets,edgebands}`, `rooms`,
`cabinets`, `generatedItems`, `parts`, `skipped`. Every object is `additionalProperties: false`.
- No project id and no quantity: one `parts` entry per physical piece (guide §2).
- No Part `label` in v1.0 (the glossary's "export's Part `label` when present" is a future minor;
  Part name derivation falls back to `name`, guide §3).

## Units and ids
- All lengths are **integer µm** (`$defs/Length`, `Size`). Angles: degrees, 0.01°.
- Library ids (`sheetId`, Edgeband/Hardware ids) are snowflake strings (`$defs/LibraryId`); planner ids are
  opaque (`$defs/Id`). Part ids: `<cabinetId>/<partPath>` or `<generatedItemId>/<piece>` (guide §3).
  Stable across re-exports while structure is stable — the Re-import module keys on this.

## Part (`$defs/Part`, guide §4–§5)
- `owner {kind: cabinet|generatedItem, id}` -> `cabinets[]` / `generatedItems[]` (Owner label: Cabinet
  `label` like `B3`, Generated Item `label` like `Toe Kick B1` — not unique, match on `id`).
- `materialSlot` iff Cabinet Part (schema `if/then/else`). `name`: Part path (`s0.shelf[2]`) or the kind.
- `sheetId` -> `materials.sheets[]` (`thickness`, `sheetLength`, `sheetWidth`, `grain`); `thickness` copied.
- `length`/`width` = finished (banding included); `cutLength`/`cutWidth` = minus Edgeband thickness, **no
  shop allowances**. Nest on cut sizes.
- `grain`: effective (`length` = local X must follow Board length; `none` = may rotate).
- `edges`: `{x0?, xL?, y0?, yW?}` -> Edgeband id; missing key = unbanded.
- `ends`: only when mitred (Toe Kick/Crown/Light Rail at Corners) — a mitre is a Manual op candidate.
- `place`: position in owner frame (guide §7) — not needed for nesting/CAM.

## Ops (`$defs/Op`, guide §6)
- `drill` (`at`, `diameter`, exactly one of `depth` | `through: true`), `groove` (`from`, `to`, `width`,
  `depth`), `pocket` (`centre`, `length` along u, `width` along v, `cornerRadius`, `depth`).
- `face`: `top`/`bottom` (±Z) or edge faces `x0`/`xL`/`y0`/`yW` -> edge-face ops are Manual ops.
- Face points carry exactly the face's two axes in the Part frame (`{x,y}` on top/bottom). Origin = min-X,
  min-Y corner of the bottom face; Z from 0 (bottom) to T. Face/axis table: guide §6.
- Through `bottom` op -> mirror onto `top` (Side A). Blind `bottom` op -> Flip Part. A converter flipping
  about X uses `y ← width − y` (guide §10, which also maps faces to HOMAG/Biesse).
- Ops are fully expanded (one per hole). `source` is `{kind:"op",index}` or `{kind:"hardware",...}`; may be
  ignored.

## Skipped (`$defs/Skipped`, guide §8)
Non-empty `skipped` = incomplete Job: `kind`, `id`, `label`, `roomId`, `name`, `reason`
(`invalid`|`placeholder`|`noMaterial`), `problems`.

## Ordering (guide §1 "Deterministic output")
Sheets/Edgebands by id (shortest first, then lexical); `parts` grouped by owner in `cabinets` then
`generatedItems` order. Run order groups Sheets by thickness "in export order" — that's this order.

## Fixtures
- `fixtures/synthetic.parts.json` (5 Parts, Cabinet `c1` "T1" + Toe Kick): `c1/leftSide` 2100 mm (Saw Part,
  > bed); `c1/s0.shelf[0]` with an `x0` drill (Manual op); `c1/s0.rail[1]` 40 mm wide, no ops (narrow ->
  auto Saw Part); `c1/s0.door.leaf[0]` banded 4 sides with a blind 35 mm `bottom` hinge cup (Flip Part) and a
  through Ø5 `bottom` drill (mirrors to top); `w1.left.lower.c1/toeKick/0` on grained Oak MDF 16.
  Sheets: White 18 (ungrained) and Oak MDF 16 (grained). One Edgeband (White ABS 1 × 23).
  One Skipped Cabinet (`c2` "T2", reason `invalid`, problems `check.minWidth`), added in #25.
- cabinet-planner's abridged real example: `/home/user/cabinet-planner/docs/parts-export/examples/kitchen.parts.json`
  (not vendored; useful for mitred Toe Kicks round a Corner and a skipped Placeholder).
