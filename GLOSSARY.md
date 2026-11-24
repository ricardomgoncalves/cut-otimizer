# Cut Optimizer

Turns a cabinet-planner Parts Export into bed-sized work for a CNC router: saw Breakdown of Boards into Blanks, nested Layouts per Blank, files for CAM, and progress tracking. Terms marked _(export)_ are cabinet-planner's and keep its meaning.

## Language

### Input

**Parts Export** _(export)_:
The versioned JSON file cabinet-planner produces for one Project: its Parts, Sheets, Edgebands and skipped items.
_Avoid_: cut list, input file

**Part** _(export)_:
One physical piece to cut, identified by its Export Part id.
_Avoid_: piece, panel, component

**Sheet** _(export)_:
A stock definition: material, thickness, full size and grain. It is not a physical board.
_Avoid_: material, stock (for the definition); sheet (for a physical board)

**Skipped item** _(export)_:
Something cabinet-planner could not turn into Parts, listed in the export's `skipped` with a reason. If there are any, the Job is incomplete.

### Work

**Job**:
One loaded Parts Export together with its settings snapshot, Breakdown, Layouts and progress.
_Avoid_: project (that is cabinet-planner's), session, order

**Board**:
One physical full-size board of a Sheet, numbered within its Sheet ("White melamine 18 · Board 2 of 2").
_Avoid_: sheet, panel

**Breakdown**:
The saw plan that cuts Boards into Blanks.
_Avoid_: pre-cut plan, rip plan

**Blank**:
A piece cut from a Board that fits the bed, onto which Parts are nested.
_Avoid_: sub-sheet, tile, offcut

**Layout**:
The arrangement of Parts on one Blank.
_Avoid_: nest, sheet layout

**Side**:
One face of a Blank as set up on the bed. **Side A** has the `top` face up. **Side B** is flipped, for `bottom`-face ops.
_Avoid_: face (that is a Part's op face), setup

**Machine settings**:
Global settings that describe the CNC and saw, such as bed size, clamp margin, bit diameter and kerf. A Job keeps a snapshot of them from when its Layouts were generated.
_Avoid_: profile, config

**Locked**:
Describes a Board or Blank that has at least one Part ticked Cut. Regenerating Layouts leaves locked Boards and Blanks as they are.
