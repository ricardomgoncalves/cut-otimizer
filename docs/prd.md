# Cut Optimizer v1: product requirements

This PRD is the entry point to the v1 spec. It covers the problem, who the app is for, what v1 does and doesn't do, and its features as user stories. It doesn't repeat every detail. Each section links to where its decision is recorded, as a ticket resolution on "[Map: cut optimizer for the PROVerXL bed](https://github.com/ricardomgoncalves/cut-otimizer/issues/1)". Where the PRD and a linked resolution differ, the resolution wins. The one exception is the [DXF layer grammar](#dxf-layer-grammar-v1), which is written out in full here and is the contract.

Capitalised terms (Part, Sheet, Board, Blank, Breakdown, Layout, Side A, Side B, Flip Part, Run order, Step…) are defined in [`GLOSSARY.md`](../GLOSSARY.md). Terms marked _(export)_ there come from cabinet-planner and keep its meaning.

## Problem

cabinet-planner produces a **Parts Export**: every Part of a kitchen, with its cut size, Sheet, grain, Edgebands and machining ops. The shop cuts on a Genmitsu PROVerXL 4X4, a hobby CNC router with a 1300 × 1300 mm working area. The Sheets are 2800 × 2070 mm, much bigger than the bed. Nothing yet turns the export into work the shop can do. Someone has to:

- plan the saw cuts from full Boards to bed-sized Blanks
- nest the Parts on each Blank
- draw a DXF per Blank for the CAM program
- work out which Parts must be flipped for `bottom`-face ops
- print a cut sheet and labels
- track which of 40-odd Parts are cut, flipped and banded

Doing that by hand is slow and error-prone.

The cut optimizer closes the gap. It loads a Parts Export, plans the Breakdown and Layouts, writes layered DXFs for the user's own CAM app, prints a cut-sheet PDF and Part labels in Run order, and tracks progress per Part by Step, including by scanning a label's QR code.

## Users

- **The maker in the shop**: one person who plans the Job at a desk, then works at a laptop beside the CNC. They use a mouse and keyboard, a printer for A4 and sticker sheets, and a keyboard-wedge barcode scanner or the webcam.
- **The user's own CAM app** (a program, not a person). It reads the DXFs and parses their layer names. The cut optimizer owes it a stable, versioned layer grammar.
- **cabinet-planner**, whose Parts Export v1 the app reads but never changes.

## Goals

1. Loading a real export and getting a Breakdown, Layouts, DXFs, a cut sheet and labels takes minutes, with no hand editing.
2. Everything that goes to the shop is exact. Every Part is placed once, inside the bed minus the clamp margin, with kerf respected, and the DXF numbers match the export to 0.1 mm.
3. Cut work is never moved. Regenerating leaves Locked Boards and Blanks as they are, and progress is keyed by Part, so it survives regenerates and re-imports.
4. Work is never lost. The Job saves continuously in the browser, and a `.job.json` file reopens it in any browser.
5. The shop floor stays fast: scan a label, and the Part's Step is ticked.

## Scope

v1 is one machine and one browser: no accounts, no backend, no sync. It covers:

- Importing Parts Export v1, with validation, a Job list, Machine settings and a settings snapshot per Job.
- The Breakdown of Boards into Blanks, Saw Parts and Offcuts, and the nesting of Parts on Blanks.
- Flip Parts with Side B files run against a Fence corner, and Manual ops.
- The Run order.
- DXF files (Side A per Blank, Side B per distinct Flip Part) in one zip per Job.
- The cut-sheet PDF and the A4 label sheets.
- Progress by Step: ticks, bulk ticks, Scan mode, roll-ups, Remake and kept Offcuts.
- Re-importing an updated export into a Job.
- A Dockerfile that serves the static build.

### Out of scope

As listed on the map:

- G-code, toolpaths, feeds and speeds.
- Editing cabinets or Parts.
- Merging several exports into one Job.
- Any change to the user's CAM app, including tabs and onion skin.
- Syncing progress across devices, or any backend.
- A cross-Job Offcut inventory.
- Adding the Part `label` field to the Parts Export (that's a cabinet-planner change).

These were also ruled out along the way, in the tickets named:

- Rotating Blanks on the bed ("[Sheet-to-Blank breakdown rules](https://github.com/ricardomgoncalves/cut-otimizer/issues/7)").
- Flipping whole Blanks, registration pins, and rotating Side B geometry to share a file ("[Flip jobs for bottom-face ops](https://github.com/ricardomgoncalves/cut-otimizer/issues/8)").
- `TEXT`, blocks, `LWPOLYLINE`, Part names in the DXF, a JSON sidecar, and a starter CAM template ("[DXF layer and entity mapping](https://github.com/ricardomgoncalves/cut-otimizer/issues/9)").
- Reconciling paper ticks, and a full tick history ("[Progress tracking and QR ticking without a backend](https://github.com/ricardomgoncalves/cut-otimizer/issues/10)").
- Cabinet-aware nesting, tool-change grouping, and hand-editing the Run order ("[Cut order across Blanks and Boards](https://github.com/ricardomgoncalves/cut-otimizer/issues/13)").
- Tab geometry and special nesting for small Parts ("[Small Parts and hold-down on the CNC](https://github.com/ricardomgoncalves/cut-otimizer/issues/14)").
- Blank-area leftovers as Offcuts ("[Offcuts: track and reuse across Jobs?](https://github.com/ricardomgoncalves/cut-otimizer/issues/15)").
- Part name overrides in the app ("[Part display names on labels, PDF and scan feedback](https://github.com/ricardomgoncalves/cut-otimizer/issues/17)").
- Picking individual export changes during a re-import ("[Re-import an updated Parts Export mid-Job](https://github.com/ricardomgoncalves/cut-otimizer/issues/18)").

## Platform and architecture

| Concern | Decision | Detail |
|---|---|---|
| App | Vite + Bun, React, TypeScript, a static build. Same stack as cabinet-planner. | Map Notes |
| Input | Parts Export v1, validated against a **vendored** copy of `parts-export.v1.schema.json` with ajv. A newer minor is validated against its own schema file. Integer µm throughout, as in the export. | "[Check Parts Export v1 for project id, quantity and display names](https://github.com/ricardomgoncalves/cut-otimizer/issues/16)", "[PRD: module layout and testing seams](https://github.com/ricardomgoncalves/cut-otimizer/issues/19)" |
| Storage | IndexedDB with one versioned Job document per Job (`jobFormat: 1`), using Dexie as cabinet-planner does. The same document is saved and opened as `.job.json`. Machine settings are global, with a snapshot in each Job. | "[Job model: what is loaded, saved and identified](https://github.com/ricardomgoncalves/cut-otimizer/issues/6)", "[PRD: module layout and testing seams](https://github.com/ricardomgoncalves/cut-otimizer/issues/19)" |
| Nesting | A hand-written guillotine step from Board to Blanks, scored together with `maxrects-packer` (BSSF) nesting of Parts in each Blank, one Sheet at a time. Score order: most Part area placed, then fewest Blanks, then the largest rectangular Offcut. | "[Research: rectangle nesting and guillotine pre-cut algorithms in TS/JS](https://github.com/ricardomgoncalves/cut-otimizer/issues/4)", "[Sheet-to-Blank breakdown rules](https://github.com/ricardomgoncalves/cut-otimizer/issues/7)" |
| Machine | PROVerXL 4X4, 1300 × 1300 mm working area (bed size is a setting). Clamps on a T-slot bed. A 6 mm or 1/4" end mill. | "[Research: PROVerXL 4848 working area and hold-down](https://github.com/ricardomgoncalves/cut-otimizer/issues/2)" |
| Files for CAM | ASCII DXF R12, mm, `CIRCLE` and closed `POLYLINE` only, with a versioned layer grammar. One zip per Job (fflate, as cabinet-planner uses). | "[Research: DXF conventions in hobby CAM programs](https://github.com/ricardomgoncalves/cut-otimizer/issues/3)", "[DXF layer and entity mapping](https://github.com/ricardomgoncalves/cut-otimizer/issues/9)", [grammar below](#dxf-layer-grammar-v1) |
| Paper | The cut sheet and labels are built as a pure **page model** in mm. pdf-lib renders it to PDF, and SVG renders the same model for the in-app preview. No HTML print CSS, because browser scaling would break the alignment with the sticker sheet. | "[PRD: module layout and testing seams](https://github.com/ricardomgoncalves/cut-otimizer/issues/19)" |
| Scanning | A keyboard-wedge scanner (a fast burst of keys ending in Enter) is the main path. The webcam is the fallback, using `BarcodeDetector` with a JS decoder where it isn't available. | "[Progress tracking and QR ticking without a backend](https://github.com/ricardomgoncalves/cut-otimizer/issues/10)" |
| Tests | Vitest, as cabinet-planner uses, plus Playwright smoke flows. | [Testing](#testing) |
| Packaging | A Dockerfile that serves the static build | Map Notes |

## User stories

Each group ends with where its detail lives. "I" is the maker.

### 1. Jobs and settings

1. I load a Parts Export and see its Parts, Sheets and Owners before anything is planned, along with import issues: schema errors, unknown Part keys, and Skipped items. Skipped items stay as a persistent warning and are repeated on the PDF cover.
2. I have a list of Jobs. Each Job has a local UUID, a short id and an editable name, which defaults to the export's Project name and date. I can archive or delete a Job. Every change is saved in the browser, and reloading brings the Job back.
3. I can download a Job as `.job.json` and open it in any browser. The file holds the raw export verbatim, the settings snapshot, the Breakdown, Layouts, progress and everything else the Job owns.
4. I edit Machine settings once. They cover:
   - bed size
   - clamp margin (40 mm, applied to all four edges)
   - bit diameter
   - saw kerf (3.2 mm)
   - edge trim (0 mm, settable per Sheet)
   - Min CNC width (50 mm)
   - Min Offcut size (150 mm)
   - the `bottom` op kinds always done by hand
   - the fence height note

   Each Job keeps the snapshot it was last generated with, so its files stay reproducible.
5. I can edit a Sheet code (`W18`), which is derived from material and thickness by default.

Detail: "[Job model: what is loaded, saved and identified](https://github.com/ricardomgoncalves/cut-otimizer/issues/6)", "[Sheet-to-Blank breakdown rules](https://github.com/ricardomgoncalves/cut-otimizer/issues/7)", "[Small Parts and hold-down on the CNC](https://github.com/ricardomgoncalves/cut-otimizer/issues/14)", "[Offcuts: track and reuse across Jobs?](https://github.com/ricardomgoncalves/cut-otimizer/issues/15)", "[Check Parts Export v1 for project id, quantity and display names](https://github.com/ricardomgoncalves/cut-otimizer/issues/16)".

### 2. Part names

1. Everywhere a Part is shown, it reads `<Owner label> · <Part name>` ("B3 · Left side", "Toe Kick B2"). The Part name comes from:
   1. the export's optional Part `label`, else
   2. a name derived from the Part path or kind (1-based numbers only when the Owner has several Parts with the same name; a section prefix only for multi-section Cabinets), else
   3. the path with spaces added.
2. Unknown path keys are listed in the import summary. The raw `name` appears only in the app's Part detail panel.
3. Names are display only. A Part is identified by its location (`W18-1-A #3`) and, in data, by its Export Part id, which is never parsed.

Detail: "[Part display names on labels, PDF and scan feedback](https://github.com/ricardomgoncalves/cut-otimizer/issues/17)", "[Check Parts Export v1 for project id, quantity and display names](https://github.com/ricardomgoncalves/cut-otimizer/issues/16)".

### 3. Breakdown and nesting

1. I generate the plan and see each Board's Breakdown (rips and crosscuts, Blanks, Saw Parts, Offcuts) and each Blank's Layout.
2. Blank sizes are chosen per Board, up to the bed size, and a strip may shrink to what its Layout uses. A Blank keeps its Board's grain and is never rotated: Board length always runs along the bed's X.
3. Parts are nested inside each Blank minus the clamp margin on all four edges.
4. A Part bigger than the usable bed is always a Saw Part. A Part narrower than Min CNC width (on its shorter cut side) with no CNC ops becomes a Saw Part automatically. A narrow Part that has CNC ops stays on the CNC, with a warning in the Part list, in the Layout view and on its PDF row.
5. I can switch any Part between Saw and CNC, except one bigger than the bed, and regenerate.
6. Blank ids are `<Sheet code>-<Board>-<letter>` (`W18-1-A`), lettered in the order pieces come off the saw.
7. Once any Part on a Board or Blank is ticked Cut, it is **Locked**. Regenerating never changes a Locked Board or Blank. It re-nests only what needs nesting, and Locked Blanks keep their ids forever.

Detail: "[Sheet-to-Blank breakdown rules](https://github.com/ricardomgoncalves/cut-otimizer/issues/7)", "[Research: rectangle nesting and guillotine pre-cut algorithms in TS/JS](https://github.com/ricardomgoncalves/cut-otimizer/issues/4)", "[Small Parts and hold-down on the CNC](https://github.com/ricardomgoncalves/cut-otimizer/issues/14)", "[Job model: what is loaded, saved and identified](https://github.com/ricardomgoncalves/cut-otimizer/issues/6)", "[Cut order across Blanks and Boards](https://github.com/ricardomgoncalves/cut-otimizer/issues/13)".

### 4. Flip Parts and Manual ops

1. A through op on `bottom` is mirrored onto `top` and runs on Side A. A Part that still has blind CNC `bottom` ops is a **Flip Part**.
2. Side A cuts everything on the Blank. Each Flip Part is then set bottom-up on its own against the Fence corner and runs a Side B file. The app picks which of the four orientations puts the Side B ops closest to the two fence edges.
3. Flip Parts share a Side B file only on an exact match: same cut size, same Side B ops and same orientation. Mirrored doors get two files.
4. Edge-face ops, `bottom` kinds set to manual, and ops that can't be drawn as a circle or a closed rectangle become **Manual ops**. They're listed on the PDF and the label, and the Job warns about them.

Detail: "[Flip jobs for bottom-face ops](https://github.com/ricardomgoncalves/cut-otimizer/issues/8)", "[DXF layer and entity mapping](https://github.com/ricardomgoncalves/cut-otimizer/issues/9)".

### 5. Run order

1. The Job has one computed Run order that is never edited, done phase by phase:
   1. saw every Board
   2. Side A for every Blank
   3. one Side B batch
   4. banding
2. Sheets are grouped by thickness, with groups and Sheets in export order. Boards and Blanks follow their ids.
3. Parts are numbered `#1..n` within a Blank by position: the front row left to right from the origin, then the next row back.
4. Side B files are ordered by where their first Part appears in the Run order.
5. New Blanks from a regenerate get the next free ids, so they sort to the end of their Sheet.

Detail: "[Cut order across Blanks and Boards](https://github.com/ricardomgoncalves/cut-otimizer/issues/13)".

### 6. Files for CAM

1. I download one zip per Job containing:
   - a Side A DXF per Blank (`W18-1-A.side-a.dxf`)
   - a Side B DXF per distinct Flip Part (`<Job>-B<n>.side-b.dxf`)

   I can also download a single file from a Blank or Side B view.
2. A Side A file is a top view with its origin at the Blank's front-left corner. A Side B file is a bottom view with its origin at the Fence corner.
3. Outlines are cut size (before banding), drills are circles at their true diameter, and grooves and pockets are closed rectangles. Grooves are clipped exactly to the Part outline. No tab geometry: tabs and onion skin are the CAM app's job.

Detail: "[DXF layer and entity mapping](https://github.com/ricardomgoncalves/cut-otimizer/issues/9)", "[Small Parts and hold-down on the CNC](https://github.com/ricardomgoncalves/cut-otimizer/issues/14)", [grammar below](#dxf-layer-grammar-v1).

### 7. Cut-sheet PDF

1. I print one A4 portrait PDF in Run order ("Shop flow"):
   1. **Cover**:
      - Job name, short id and generation time
      - counts and the numbered order of work
      - a "Before you start" box listing Saw Parts, Manual ops, Skipped items and Spares
      - Materials per Sheet
      - the Machine settings snapshot, with the reminder "Outlines need tabs or onion skin in CAM"
      - Edgeband totals (+10%)
      - the layer legend (layer, count, stock thickness, suggested toolpath, Reference layers)
      - the re-import log
   2. **Saw**, one page per Board: a scaled Breakdown drawing with numbered rips (`1, 2…`) and crosscuts (`1a, 1b…`), each piece named, kept Offcuts marked Keep with their ids and waste hatched, and a cut table (cut #, rip or cross, fence setting, measured from, what it gives, tick). Cuts from kept Offcuts get their own small saw entries.
   3. **Side A**, one page per Blank: a header with the DXF file name, the Blank drawing (origin front-left, clamp margin dashed, Parts numbered, Flip Parts shaded, banded edges thick, grain arrow), and a Part table. The table has name, finished size, **cut size**, banding, grain, Side B file, Manual ops, a narrow-Part note, and Step ticks (Cut / Side B / Band / Manual). The page ends with a "Side A done" box.
   4. **Side B batch**: one card per file, with the bottom view, the Fence corner and edge names, the clamp edges, the fence-height note, and the Parts with their locations and ticks.
   5. **Edge banding**: one list per Edgeband, in Run order, with ticks.
   6. **Owner summary**: two Owners per page, every Part with its location and Step ticks. Generated Items come after Cabinets.
2. A Part is referenced across pages as `W18-1-A #3` (or `M8-1 saw`). Tick boxes repeat on every page a Part appears on, and paper ticks are never reconciled with the app.

Detail: "[Prototype: cut-sheet PDF](https://github.com/ricardomgoncalves/cut-otimizer/issues/11)" (Variant A, prototype on branch `claude/gracious-faraday-rknykf`), "[Sheet-to-Blank breakdown rules](https://github.com/ricardomgoncalves/cut-otimizer/issues/7)", "[Cut order across Blanks and Boards](https://github.com/ricardomgoncalves/cut-otimizer/issues/13)", "[Offcuts: track and reuse across Jobs?](https://github.com/ricardomgoncalves/cut-otimizer/issues/15)".

### 8. Labels

1. I print one label per Part, Saw Parts included, on A4 sticker sheets: 2×7, 99.1 × 38.1 mm, in the L7163 layout (top 15.15, left 4.65, column gap 2.5). They print in Run order, Saw Parts first and then continuously by Blank and `#`.
2. A label goes on the Part's hidden `bottom` face and shows:
   - **Left**: a drawing of that face as seen with the label up. Banded edges are thick and named, with ops, grain, Flip shading, and a shaded **sticker spot**: 15 mm from the edges, clear of every op on that face, as near the middle as fits, or a note if none fits.
   - **Right**: the Owner label (large), the Cabinet name or item label, the Part name, the finished size, `SIDE B <file>` / `n MANUAL` / `SAW` pills, and the Manual ops spelled out.
   - **Top right**: a 14 mm QR code (ECC M, 2-module quiet zone) with the location under it.
   - **Bottom**: a Step tick row.

   Owner and Part name sit on two lines that shrink to about 7 pt, then end with "…".
3. I can print a QR **size-ladder** test page to confirm the QR size with my scanners. The QR size, ECC level and quiet zone are constants in one place.
4. After a re-import, I can print a label batch for only the Renamed, Changed and Added Parts.

Detail: "[Prototype: part labels on A4 sticker sheets](https://github.com/ricardomgoncalves/cut-otimizer/issues/12)" (Variant D, prototype on branch `claude/quirky-bardeen-jvlri8`), "[Part display names on labels, PDF and scan feedback](https://github.com/ricardomgoncalves/cut-otimizer/issues/17)", "[Re-import an updated Parts Export mid-Job](https://github.com/ricardomgoncalves/cut-otimizer/issues/18)".

### 9. Progress and Scan mode

1. Each Part has only the Steps that apply to it:
   - **Cut**
   - **Side B** (Flip Parts only)
   - **Banded** (Parts with an Edgeband)
   - **Manual ops** (Parts with Manual ops)

   A Part is **Done** when all of them are ticked. Each tick stores a timestamp.
2. I tick Steps per Part, or in bulk: "Side A done" per Blank, "Breakdown done" per Board for its Saw Parts, and Side B per Side B file.
3. In **Scan mode** I choose a Step, then scan labels with the wedge scanner or the webcam. Each scan ticks that Step. The QR payload is plain text, `<job short id>:<Part id>`. A scan from another Job is rejected.
4. If the Part has no such Step, or the Step is already ticked, I get a warning and nothing is ticked. If an earlier Step is still open, it ticks anyway and warns.
5. Scan feedback is large and beeps. It shows the Step ticked, `B3 · Left side`, the location, and Owner progress ("B3: 6 / 8 Done").
6. I see roll-ups computed from ticks, never stored:
   - Blank: Cut and Done of total
   - Board and Sheet: Cut
   - per Owner: Done of total, with "ready to assemble" for Cabinets
   - Job
7. I can untick a Step, with a confirmation if that would unlock a Board or Blank.
8. I can mark a ruined Part **Remake**: its ticks are cleared, its old Blank shows it greyed out, and it needs nesting at the next regenerate.

Detail: "[Progress tracking and QR ticking without a backend](https://github.com/ricardomgoncalves/cut-otimizer/issues/10)", "[Part display names on labels, PDF and scan feedback](https://github.com/ricardomgoncalves/cut-otimizer/issues/17)".

### 10. Offcuts and nesting what's left

1. Breakdown leftovers at least Min Offcut size on both sides are **kept**. They get ids (`W18-1-K1`), inherit their Board's Sheet and grain, and are marked Keep on the saw page. Smaller leftovers, and the unused area of any Blank, are waste.
2. I can Discard a kept Offcut, and undo that.
3. At regenerate, every Part that needs nesting (Remake, Added, uncut Changed) goes to these places, in order:
   1. kept Offcuts of **Locked** Boards, each cut by its own saw entry, continuing the Board's Blank letters
   2. the Breakdown of the Sheet's unlocked Boards
   3. otherwise the app lists what didn't fit and **asks** before adding a Board

   A brand-new Sheet gets Boards without asking.

Detail: "[Offcuts: track and reuse across Jobs?](https://github.com/ricardomgoncalves/cut-otimizer/issues/15)", "[Re-import an updated Parts Export mid-Job](https://github.com/ricardomgoncalves/cut-otimizer/issues/18)".

### 11. Re-import

1. From inside a Job, I re-import an updated export. I see a sanity hint (same Project name? what share of Part ids match?) and a warning when overlap is under about 50%.
2. Parts match by Part id. Remaining removed and added pairs are auto-paired by Sheet, finished size, grain, ops, Edgebands, Owner kind and Part `name`/kind, in Run order. I can unpair any of them.
3. A diff groups Parts into Same, Renamed, Changed (cut), Changed (finishing), Added and Removed, with counts, affected Owners and Blank locations. A changed Sheet definition makes all its Parts Changed (cut). A file that's older than the current export gets a warning.
4. Apply is all or nothing. "Revert last re-import" lasts until the next regenerate or re-import.
5. Applying replaces the raw export and marks Layouts stale. Regenerate stays the only place where Blanks, Boards and Offcuts change.
6. Sheet codes carry over by Sheet id, and the Skipped-items warning is recomputed.
7. Changed (cut) Parts already cut default to Remake. A per-Part "Fix by hand" instead keeps their ticks and adds an unticked Manual ops Step that describes the change.
8. Uncut Changed Parts need nesting. On a Locked Blank they leave a greyed "moved to …" void, and that Blank's DXF and PDF page aren't rewritten.
9. Changed (finishing) Parts clear only the Step whose data changed, and the diff flags it if that Step was already ticked.
10. Removed Parts that were never cut are dropped. Removed Parts already cut become **Spares**: listed in the app and on the PDF cover, outside all roll-ups, and dismissable.
11. Old stickers still scan through a permanent id alias (old → new).
12. A re-import log (date, `exportedAt`, counts per category) is kept and printed on the PDF cover.

Detail: "[Re-import an updated Parts Export mid-Job](https://github.com/ricardomgoncalves/cut-otimizer/issues/18)", "[Check Parts Export v1 for project id, quantity and display names](https://github.com/ricardomgoncalves/cut-otimizer/issues/16)".

### 12. Packaging

1. I can build a Docker image that serves the static app. How it's deployed is up to me.

## DXF layer grammar v1

This is the contract between the cut optimizer and the user's CAM app. Any change to it bumps the version marker.

**File format**
- ASCII DXF R12. Units are mm and every entity sits at Z = 0.
- The only entities are `CIRCLE` and closed 2D `POLYLINE` (a rectangle: 4 vertices, closed flag). No `TEXT`, blocks or `LWPOLYLINE`, and nothing on layer `0`.
- **Side A** (`<Blank id>.side-a.dxf`): top view. The origin (0,0) is the Blank's front-left corner, X runs along the Board length and Y runs back from the front edge.
- **Side B** (`<Job>-B<n>.side-b.dxf`): bottom view of one Flip Part in the orientation the app chose. The origin (0,0) is the Fence corner.

**Numbers in layer names**: mm, rounded to 0.1 mm, written as an integer when whole, with `P` as the decimal point. For example `D4P5` is Ø4.5, `W8P5` is 8.5 wide, and `Z12P5` is 12.5 deep. The export is in µm; rounding before naming keeps 4.4999 and 4.5 on one layer.

**Cut layers**

| Op | Layer | Entity |
|---|---|---|
| Drill, blind | `DRILL_D{d}_Z{depth}` | `CIRCLE` at its true diameter |
| Drill, through | `DRILL_D{d}_THRU` | `CIRCLE` |
| Groove | `GROOVE_W{w}_Z{depth}` | closed rectangle, clipped to the Part's cut outline |
| Pocket | `POCKET_Z{depth}` | closed rectangle |
| Part outline | `OUTLINE_THRU` | closed rectangle at cut size (`cutLength` × `cutWidth`) |

`THRU` means through the Sheet's thickness. How far to cut into the spoilboard is a CAM setting. Through `bottom` ops are mirrored to `top` and land on the same layers. Side B files carry only blind `bottom` ops and no `OUTLINE_THRU`.

**Reference layers** are never cut:

| Layer | File | Content |
|---|---|---|
| `REF_BLANK` | Side A | the Blank's edge |
| `REF_CLAMP` | Side A | the clamp margin on all four edges |
| `REF_PART` | Side B | the Part's outline in the bottom view |
| `REF_V1` | both | empty; marks grammar version 1 |

Anything that can't be expressed this way is a Manual op and goes on paper only.

Detail: "[DXF layer and entity mapping](https://github.com/ricardomgoncalves/cut-otimizer/issues/9)", "[Flip jobs for bottom-face ops](https://github.com/ricardomgoncalves/cut-otimizer/issues/8)".

## Modules

Eight modules for slicing build tickets. The first six are pure TypeScript with no React or DOM, and they're tested through their interface. Each is deep: a small interface over a lot of behaviour.

| Module | Interface | Owns |
|---|---|---|
| **Import** | `importExport(json) → { model, issues }` | Schema validation (vendored v1 schema, ajv). Building the domain model: Owners, Part names and the derive table, Sheet codes, through-op mirroring, Flip Part classification, Manual ops. Issues for Skipped items and unknown keys. |
| **Planner** | `plan(model, settings, prior) → Plan` | One deep module for the Breakdown (guillotine), nesting (maxrects), Saw Part rules, Side B grouping and orientation, Blank ids, Run order and `#n`, kept Offcuts, the needs-nesting order, and leaving Locked Boards and Blanks alone. `prior` holds the stored Plan, locks, Remakes, Saw/CNC overrides and Discarded Offcuts. Guillotine, maxrects and Run order are internal seams only. |
| **DXF writer** | `toDxfFiles(plan) → Map<filename, string>` | The layer grammar, R12 output, origins and views. Zipping is a thin step in the shell. |
| **Documents** | `cutSheet(plan, progress)` and `labels(plan, progress, selection)` → page model | The page model: pages of boxes, text, lines, drawings and QR codes, in mm. The cut sheet, labels, size ladder and layer legend. Two renderers sit on it: pdf-lib for print and SVG for the preview. |
| **Progress** | `apply(progress, event) → progress` and `rollup(plan, progress)` | Applicable Steps, ticks with timestamps, bulk ticks, Scan-mode rules, untick, Remake, dismissing Spares, and resolving scans through the id alias table. |
| **Re-import** | `diff(job, newModel) → Diff` and `applyDiff(job, diff, choices) → job` | Matching, auto-pairing, categories, per-Part treatment, Spares, the alias table and the re-import log. |
| **Job store** | `JobStore` with IndexedDB (Dexie) and in-memory adapters | The Job list and the versioned Job document. Pure serialization to and from `.job.json`, and migration of older `jobFormat` versions. |
| **Shell** | React UI | Job list, import summary, settings, Breakdown and Layout views, Part list, Scan mode (one `ScanSource` interface with wedge and webcam adapters), diff screen, previews, downloads and print. |

**The Job document** is one record per Job. It holds:
- the raw export (verbatim) and the model built from it
- name, UUID and short id
- the settings snapshot and Sheet codes
- the Plan (Breakdown and Layouts), its stale flag, and locks
- Saw/CNC overrides
- progress ticks
- kept and Discarded Offcuts
- Spares
- the id alias table
- the re-import log

Undoing a re-import restores the previous document.

## Testing

- **Fixtures** in the repo:
  - an **anonymized copy of the real export**: 4 base cabinets, 41 Parts on 3 Sheets, Ø4/4.5/5/8/35 drills and back grooves, 8 Flip Parts, and a 1200 mm toe kick
  - a **small synthetic export** of about 5 Parts covering a Saw Part, a Flip Part, a narrow Part, a Manual op and a Generated Item

  CI checks both against the vendored schema. The commit the schema was copied from is recorded beside it (cabinet-planner `f2da2ce` at the time of writing).
- **Planner**: invariant and property tests over both fixtures and over random exports, never whole-Plan snapshots. The invariants:
  - no overlaps
  - every Part inside its Blank minus the clamp margin, with kerf between saw pieces
  - every Part placed exactly once, as a CNC Part or a Saw Part
  - Locked Boards and Blanks unchanged after regenerate
  - the Run order rules hold
  - Side B files shared only on exact matches
- **Goldens** only for the DXF writer and the page models, fed a small hand-written Plan rather than Planner output, so a golden changes only when the format does. The layer grammar is a golden test.
- **Pure modules** (Import, Progress, Re-import, Job serialization) get unit tests through their interfaces with Vitest.
- **Renderers** (pdf-lib and SVG): one smoke test each.
- **Playwright smoke flows** against the built app:
  - import a fixture → generate → download the zip and check the file names
  - open the labels PDF
  - a simulated wedge scan ticks a Part
  - reload → the Job is restored from IndexedDB

  There are no unit tests for React components.

Detail: "[PRD: module layout and testing seams](https://github.com/ricardomgoncalves/cut-otimizer/issues/19)".

## Build order

Build a tracer bullet first, then widen it one module at a time. Each step is one or more build issues and ships something the shop can use.

1. **Tracer bullet**: Import → Planner (single thickness, no Flip Parts, no Offcut reuse) → DXF zip, in a bare shell with the in-memory store.
2. **Side B**: Flip Parts, mirroring through ops, orientation, Side B files.
3. **Job store**: IndexedDB, the Job list and `.job.json`.
4. **Documents**: the page model, then the cut-sheet PDF, labels and size ladder.
5. **Progress** and Scan mode.
6. **Offcuts and Remake**: kept Offcuts, Discard, the needs-nesting order.
7. **Re-import**.

## Done for v1

- Each user story above works in the app.
- Every Planner invariant holds for both fixtures and for random exports.
- The DXF and page-model goldens pass, and the DXFs for the real fixture open in the user's CAM app with every layer recognised.
- The labels line up with an L7163 sheet printed at 100%, and the size-ladder test confirms the QR size with the wedge scanner and the webcam.
- A Job round-trips losslessly through `.job.json` and through IndexedDB.
- The same Job, settings and export always produce byte-identical DXFs.
- The Docker image builds and serves the app.
