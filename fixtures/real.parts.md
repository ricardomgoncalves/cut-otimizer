# `real.parts.json`: the anonymized real export

A real Parts Export from cabinet-planner (exported 2026-11-24), anonymized: `project.name` and
`library.name` were replaced with neutral text. Part ids, Sheets, sizes, ops and Edgebands are exactly
as exported. It is validated against the vendored schema with the other fixtures in `fixtures/`.

Facts later tests can rely on:

- **4 base cabinets** (`c1`–`c4`, labels B1–B4, all library cabinet "Base door", 600 × 870 × 578 mm),
  plus **9 Generated Items**: 6 end panels and 3 toe kicks.
- **41 Parts** on **3 Sheets**, all 2800 × 2070 mm:
  - White melamine chipboard 18, no grain: 29 Parts
  - Oak melamine chipboard 18, grain along length: 8 Parts
  - White MDF 8, no grain: 4 Parts (the backs)
- **2 Edgebands**: White ABS 1 × 23 and Oak ABS 1 × 23.
- **8 Flip Parts** (blind ops on `bottom`): each cabinet's `bottom` (leg plates, Ø4) and
  `s0.door.leaf[0]` (hinge cups Ø35 and Ø8 hinge holes).
- **Toe kicks**: one 1200 mm (`w1.right.lower.c2/toeKick/0`) and two 600 mm, all 150 mm wide.
- **Drill diameters**: Ø4 (64, leg plates, blind `bottom`), Ø4.5 (8, handle holes, through), Ø5 (304,
  shelf pins and mounting plates), Ø8 (16, blind `bottom` on doors), Ø35 (8, hinge cups, blind `bottom`).
- **Back grooves**: 12 grooves on `top`, 8.5 mm wide and 8 mm deep: one on each `leftSide`, `rightSide`
  and `bottom`.
- No Skipped items.
