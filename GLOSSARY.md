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

**Cabinet** _(export)_:
One placed cabinet in the Project. It owns most Parts.

**Cabinet Label** _(export)_:
A Cabinet's short tag (`B3`). It is unique in the export and stays the same when the Cabinet moves.
_Avoid_: cabinet number, cabinet name

**Generated Item** _(export)_:
A piece cabinet-planner adds along a run of Cabinets, such as an end panel, toe kick or filler. It owns its own Parts, and its `label` ("Toe Kick B2") is for people only: it is not unique and not stable.
_Avoid_: accessory, extra

**Owner**:
The Cabinet or Generated Item a Part belongs to. Progress rolls up per Owner. "Ready to assemble" applies only to Cabinets.

**Owner label**:
How an Owner is shown: the Cabinet Label for a Cabinet, or the Generated Item's `label`. Where there is room, a Cabinet also shows its Library Cabinet name ("B3 · Base door").

**Part name**:
How a Part is shown to people, always after its Owner label ("B3 · Left side"). It is the export's Part `label` when present. Otherwise it is derived from the Part path or kind ("Shelf 3"), or the path with spaces added if the key is unknown. It is display only: never unique, never a key. The Part's location (`W18-1-A #3`) identifies it.
_Avoid_: display name, part title

### Work

**Job**:
One loaded Parts Export together with its settings snapshot, Breakdown, Layouts and progress.
_Avoid_: project (that is cabinet-planner's), session, order

**Board**:
One physical full-size board of a Sheet, numbered within its Sheet ("White melamine 18 · Board 2 of 2").
_Avoid_: sheet, panel

**Breakdown**:
The saw plan that cuts each Board, by guillotine cuts, into Blanks, Saw Parts and Offcuts.
_Avoid_: pre-cut plan, rip plan

**Blank**:
A piece cut from a Board, no larger than the bed, onto which Parts are nested. Always loaded with its Board's length along the bed's X. Identified as Sheet code, Board number, letter (`W18-1-A`), with letters given in the order pieces come off the saw.
_Avoid_: sub-sheet, tile, offcut

**Run order**:
The single Job-wide sequence in which the work is done: all Boards are sawn, then all Blanks run Side A, then all Side B files, then banding. Sheets are grouped by thickness (groups and Sheets in export order), Boards and Blanks follow their ids, and Parts within a Blank are numbered by position. It is always computed, never edited, and the cut sheet and labels follow it.
_Avoid_: work order, order of work, cut order

**Sheet code**:
A short code for a Sheet, derived from its material and thickness and editable (`W18` for White melamine 18). Used in Blank ids.

**Saw Part**:
A Part cut straight from a Board in the Breakdown rather than on the CNC. A Part bigger than the usable bed is always a Saw Part. A Part narrower than Min CNC width with no CNC ops becomes one automatically; any other Part can be switched between Saw and CNC by hand.
_Avoid_: manual part

**Offcut**:
A piece of a Board left over after the Breakdown, being neither a Blank nor a Saw Part. An Offcut at least Min Offcut size on both sides is **kept**: it gets an id (`W18-1-K1`), goes on the rack, and is stock for new Blanks later in the same Job until it is used or discarded. Smaller Offcuts are waste. Offcuts never carry over to another Job, and the unused area of a Blank is never an Offcut.
_Avoid_: scrap, remnant

**Layout**:
The arrangement of Parts on one Blank.
_Avoid_: nest, sheet layout

**Side A**:
A Blank set up on the bed with the `top` face up. It runs the Layout's `top` ops and the Part outlines.
_Avoid_: face (that is a Part's op face), setup, front

**Side B**:
One Flip Part set up on its own, bottom face up, against the Fence corner, to run its CNC `bottom`-face ops. It is done after Side A and before edge banding.
_Avoid_: flipped Blank, back

**Flip Part**:
A Part that still has at least one blind `bottom`-face op to run on the CNC. Through holes and ops sent to manual work don't count.
_Avoid_: two-sided part

**Fence corner**:
The square stop fixed to the bed that a Flip Part is pushed into for Side B. It is the origin of a Side B file.
_Avoid_: jig, registration

**Machine settings**:
Global settings that describe the CNC and saw, such as bed size, clamp margin, bit diameter, saw kerf, edge trim, Min CNC width (the shortest cut side a Part may have to be nested without a warning) and Min Offcut size (the smallest Offcut, on both sides, that is kept as stock). A Job keeps a snapshot of them from when its Layouts were generated.
_Avoid_: profile, config

**Locked**:
Describes a Board or Blank that has at least one Part ticked Cut. Regenerating Layouts leaves locked Boards and Blanks as they are.

**Step**:
One tracked stage of a Part's progress: Cut, Side B, Banded or Manual ops. A Part has only the Steps that apply to it (Side B only for a Flip Part, Banded only if it has an Edgeband, Manual ops only if it has any). Each Step is ticked in the app; Blank, Board, Sheet, Owner and Job progress is computed from these ticks and never stored.
_Avoid_: status, stage, state

**Done**:
Describes a Part whose applicable Steps are all ticked. A Cabinet whose Parts are all Done is ready to assemble.
_Avoid_: finished, complete

**Remake**:
Marking a ruined Part to be cut again: its ticks are cleared and it is re-nested onto a new Blank at the next regenerate, while its old Blank keeps it greyed out. The new Blank is cut from a kept Offcut of a Locked Board where one fits; otherwise the app asks before adding a Board to the Sheet.
_Avoid_: recut, redo

**Manual op**:
An op the CNC does not run: an edge-face op, a `bottom` op kind set to manual in Machine settings, or an op that can't be drawn as a hole or rectangle (a mitre, for example). It is printed on the cut sheet and the Part's label instead of going into a file for CAM.
_Avoid_: hand op, skipped op

**Reference layer**:
A layer in a file for CAM that is drawn only for orientation and checking (the Blank's edge, the clamp margin, a Flip Part's outline) and is never cut.
_Avoid_: guide layer, construction layer
