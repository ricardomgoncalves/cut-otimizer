# DXF conventions for hobby CAM import

Research for issue ricardomgoncalves/cut-otimizer#3 ("Research: DXF conventions in hobby CAM programs").
Researched 2026-11-24.

**Question.** How do Carbide Create, Fusion (Manufacture), VCarve/Aspire and Estlcam import DXF? This covers layers, circles as drill points, open polylines for grooves, units, and whether depth can come from layer names or Z. Can toolpath templates be applied by layer name? Which DXF version and entity subset is safest?

**Context.** The app writes one DXF per bed-sized Blank side. Each file holds Part outlines, drill holes (circles, through or fixed depth), grooves (straight slots with a width and a depth) and rectangular pockets, for a Genmitsu PROVerXL 4848.

**Confidence key.** **High**: stated in vendor documentation or the format specification. **Medium**: stated by vendor staff on an official forum, or by consistent vendor material that is not reference docs. **Low**: community reports or inference; test it before relying on it.

---

## TL;DR

| | Keeps DXF layer names | Toolpath picks up geometry by layer | Reusable template keyed on layer | Depth from layer name | Depth from Z | Circles to drill points |
|---|---|---|---|---|---|---|
| **VCarve / Aspire** | Yes (High) | Yes, automatic Vector Selector (High) | **Yes**: `.ToolpathTemplate` (High) | No: depth lives in the template's toolpath (High) | No (Low) | Yes: drills the centre of any closed vector, and the selector can filter circles by diameter (High) |
| **Carbide Create** | Yes, since the new DXF parser (Build 839, Feb 2026) (Medium) | Yes: a toolpath can be linked to a layer (V7+) (Medium/High) | Partly: no template file, but a starter `.c2d` with layer-linked toolpaths works (Medium) | No (High) | No: "discards any 3D information" (Medium) | Yes: the Drill toolpath plunges at the centre of each linked object (Medium) |
| **Estlcam** | Yes, shown as "file:layer" (Medium) | Partly: lock or hide layers, then run auto-select (Low/Medium) | No template-by-layer mechanism documented (Low) | No (Low/Medium) | No: the drawing is 2D at Z=0 (Low/Medium) | Yes: drill or circular-pocket functions on circles (Low/Medium) |
| **Fusion (Manufacture)** | Yes, as layer choice at insert, "One Sketch per Layer" (High) | No: you select sketch geometry by hand (High) | Templates store operations but **not** geometry, so you reselect (Medium) | No (High) | No: Bottom Height must be set for sketch geometry (High) | Yes: sketch geometry and points can be drilled, with "Select Same Diameter" (High) |

**Recommendation:**

- **Format.** Write **ASCII DXF R12 (AC1009)**, 2D, all Z = 0, in **millimetres**.
- **Entities.** Use only `LINE`, `ARC`, `CIRCLE` and 2D `POLYLINE`/`VERTEX`/`SEQEND` with the closed flag set.
- **Avoid.** Leave out blocks, splines, ellipses, text, hatches, dimensions and 3D entities.
- **Layers.** Name layers to the R12 rules (uppercase A–Z, 0–9, `_`, `-`, `$`, at most 31 characters). Encode op type, tool or feature size, and depth in the name. Pair the files with a **per-program starter template** (a Vectric `.ToolpathTemplate` or a Carbide Create `.c2d`) whose toolpaths are bound to those layer names.
- **Depth.** Depth is never read from the DXF by any of the four programs. The layer name is a human and template key only.

---

## 1. VCarve Pro / Aspire (Vectric)

**Import and units.**
- Import Vectors accepts "2D DXF". Imported vectors "will always be read in at the size and scale they were created in their original design software", so the DXF coordinates are taken at face value. **High.** [Vectric Aspire 12.5: Import Vectors](https://docs.vectric.com/docs/V12.5/Aspire/ENU/Help/form/import-vectors/index.html)
- Opening a DXF via File ► Open creates a job and shows Job Setup. File ► Import ► Import Vectors adds the vectors to the current job. **High.** [Vectric VCarve Pro V9 manual (PDF)](https://docs.vectric.com/docs/V9.0/VCarvePro/ENU/Help/VCarvePro.pdf)
- Vectric does not document how DXF units are resolved. The practical rule is to write mm and set the job to mm. **Low.**
- Special DXF entities such as dimensions, hatching and text "may not come through". **Medium.** (Same manual; summarised via search.)

**Layers.**
- DXF layers arrive as Vectric layers. Vectric's own docs note that DXF/DWG imports commonly leave empty layers and give a tool to delete them, which only makes sense if layers are imported. **High** that layers are kept; **Medium** on the exact naming. [Vectric Layers (V9.5)](https://docs.vectric.com/docs/V9.5/VCarveDesktop/ENU/Help/Reference%20Manual/Drawing/..%5CLayers%5CLayers.html)

**Circles and drilling.**
- The Drilling toolpath drills "the centers of selected closed vectors" to a Cut Depth measured from a Start Depth. Peck drilling is optional, and the drill diameter comes from the tool database, not from the circle. **High.** [Vectric Aspire 12.5: Drilling Toolpath](https://docs.vectric.com/docs/V12.5/Aspire/ENU/Help/form/Drilling%20Toolpath/index.html)
- The Vector Selector can filter by open, closed or both, by **circles only with an exact diameter and tolerance**, and by one or more layers. It has no wildcard or pattern matching on layer names. **High.** [Vectric Aspire 12.5: Vector Selector](https://docs.vectric.com/docs/V12.5/Aspire/ENU/Help/form/vector-selector/index.html)

**Open vectors and grooves.**
- Pocketing needs closed vectors. A Profile toolpath "On" the vector can follow an open line, which suits a groove only if the bit diameter equals the groove width. **Medium:** general Vectric behaviour, not re-verified on a single page here.

**Templates by layer.** Yes, and this is the strongest fit of the four programs.
- When "Associate with toolpath" is ticked in the Vector Selector, the toolpath becomes *Automatic* and reselects all matching vectors on recalculation. Automatic toolpaths keep this when saved as templates. The documented example is a pocket on "all closed vectors on a layer named Pocket" that reselects after loading the template into a new job and running Recalculate All. **High.** [Vector Selector](https://docs.vectric.com/docs/V12.5/Aspire/ENU/Help/form/vector-selector/index.html)
- Loading a template whose layers are missing opens a "Missing Layers for Template" dialog, which confirms that templates bind to layers **by name**. Holding Ctrl when opening a template applies its toolpaths to all sheets, even where a layer is empty. **High.** [Load Toolpath Template](https://docs.vectric.com/docs/V12.5/VCarvePro/ENU/Help/form/load-toolpath-template/index.html), [Save All Visible Toolpaths as a Template](https://docs.vectric.com/docs/V12.5/Aspire/ENU/Help/form/save-all-visible-toolpaths-as-a-template/index.html)

**Depth.**
- Depth is a toolpath parameter, so one layer equals one depth in practice. Users of cabinet software exporting to VCarve name layers per tool and depth (for example "drill 5 depth 10") precisely so that one template toolpath maps to each layer. **Low** (community practice). [Wood Designer forum: DXF layer names](https://wooddesigner.org/forum/polyboard/dxf-layers-names/)
- Templates may store cut depths relative to material thickness. That is worth checking for through cuts. **Low.**
- Z from the DXF is not used for depth anywhere in the docs. **Low.**

## 2. Carbide Create (Carbide 3D)

**Layers on DXF import.**
- **Before Build 839:** layers were not respected. Carbide 3D staff (WillAdams, Oct 2025) answered "No. It also discards any 3D information as of the current version." **Medium.** [Forum: Is CC supposed to respect DXF layers?](https://community.carbide3d.com/t/is-cc-supposed-to-respect-dxf-layers/96971)
- **Build 839 beta (Feb 2026):** "(NEW) All-new DXF parser." **Medium.** [Forum: Carbide Create Beta 839](https://community.carbide3d.com/t/carbide-create-beta-839/101187)
  - robgrz (Carbide 3D) said: "layers, blocks, and groups should all work and be respected". Groups that span layers are split, and blocks are exploded at each insert.
  - The import dialog has an "Insert layers from File" option, which places objects on the `.c2d` layer of the same name (WillAdams).
  - Arcs were previously converted to polylines.
- **Build 843 (Mar 2026):** staff confirm "Carbide Create will now import layers in DXFs as separate layers". **Medium.** [Forum: Layers will not move…](https://community.carbide3d.com/t/layers-will-not-move-when-imported-into-cc/104591)
- **Caveat:** these are forum or beta-thread statements. There is no reference manual page.

**Units.**
- The staff view (Oct 2025) is that DXF units "aren't standardized" and some files are effectively unitless. The job units then decide the scale. **Medium.** (Same thread.)
- A Build 813 report says DXFs now import at the correct scale. **Low.**
- Write mm and verify with a known-size outline.

**Z.** Discarded: "discards any 3D information". **Medium.**

**Circles and drilling.**
- The Drill toolpath plunges at the centre of each associated object. Edit ► Select ► Select Circles exists. **Medium** (staff and community guidance). [Design into 3D: Toolpaths (W. Adams)](https://willadams.gitbook.io/design-into-3d/toolpaths)
- Older builds turned arcs into polylines. **Medium.** Circles may also have come in faceted or slightly oval, but that is a **Low** user report.

**Open paths.** Pockets need closed geometry. Contour "No Offset" follows open paths. Open paths from Illustrator are a known source of import trouble. **Low/Medium.**

**Layer-linked toolpaths and templates.**
- V7 (Jul 2022) introduced: "Toolpaths can now link to a layer instead of individual vectors." Linked toolpaths recalculate when the layer contents change. Combined with depth expressions, the intent is reusable files with "no need to tweak toolpaths". **Medium/High** (official blog). [Carbide 3D blog: Carbide Create V7](https://carbide3d.com/blog/carbide-create-v7/)
- No standalone "toolpath template" file was found. **Medium.**
- The workable pattern is a starter `.c2d`:
  1. It contains empty layers named per our scheme, each with a toolpath linked to it.
  2. Import the DXF with "Insert layers from File".
  3. Objects land on the same-named layers and the toolpaths pick them up.
  
  This is inferred from the two statements above. **Low/Medium**; test on a current build.

**Depth from layer name.** No. Depth is set per toolpath. **High.**

## 3. Estlcam

Estlcam has no reference manual online. The vendor site has only a changelog and videos. [estlcam.de changelog](https://www.estlcam.de/changelog.php) (current: 13.021, 16 Nov 2026). The changelog for 13.x mentions nothing about DXF layers or templates. One relevant 13.005 entry: Ctrl+N selects all new objects that have no depth assigned yet. **High** that this is in the changelog.

**Layers.**
- Estlcam reads DXF layers and shows them as "file:layer". Layers can be hidden, deleted or locked (a lock stops new paths being created on that layer).
- Running auto-select layer by layer, locking each finished set, lets you do per-tool and per-depth batches. **Low/Medium** (detailed user write-up, v11/v12). [davelers.com: Estlcam layers](https://davelers.com/Workshop/CNC/Estlcam/6410.html)

**Depth.**
- Each path gets a depth in the UI, or "ask later" so one depth is chosen at export. **Low/Medium.** [All3DP Estlcam guide](https://all3dp.com/2/estlcam-cnc-beginner/)
- No evidence was found that Estlcam parses layer names or colours into functions or depths. A German user thread says it does not. **Low.** [woodworker.de thread](https://www.woodworker.de/forum/goto/post?id=982239)
- The drawing is treated as 2D at Z=0. A university guide describes jobs without depth highlighted in yellow. **Low/Medium.** [TU Wien Estlcam guide (PDF)](https://kunst2.tuwien.ac.at/files/modellbau/PDFs/240625_AnleitungESTLCAM.pdf)

**Circles.**
- Holes can be drilled (the "Bohrung"/drill function) or circular-pocketed. Auto-select can treat holes below or above a size differently. **Low/Medium.** (Sources as above.)

**Open paths.** Engrave or "on line" paths follow open contours. Part and hole detection needs closed loops; auto-detection errors on gaps or overlaps. **Low/Medium.**

**DXF robustness.**
- Users recommend low DXF versions (R12) because Estlcam handles "relatively simple" DXF best. **Low.** (Stepcraft forum PDFs, via search.)
- Duplicate overlapping objects on several layers caused trouble. A 13.020 fix concerns contour detection with doubled, overlapping objects. **High** that the fix is in the changelog.
- **Implication:** never emit the same geometry twice, for example an outline on two layers.

**Templates.** No template-by-layer feature was found. **Low.**

## 4. Fusion (Manufacture workspace)

**Insert DXF.** **High.** [Fusion: Insert a DXF file](https://help.autodesk.com/cloudhelp/ENU/Fusion-Model/files/SLD-INS-DXF.htm)
- There is a Units field that scales the import, a DXF Layers checklist, and an Insert Mode of "Single Sketch" or "One Sketch per Layer". The DXF origin goes to the sketch origin.
- If the file has no unit info, a warning appears and the design units apply unless changed. **High.** [Autodesk support article](https://autodesk.com/support/technical/article/caas/sfdcarticles/sfdcarticles/The-selected-DXF-file-does-not-contain-units-information.html)
- Whether sketches are named after layers is not stated. **Low.**

**Drilling.**
- The Drill operation accepts hole faces, hole edges, **sketch geometry and points**. "Select Same Diameter" is available. With sketch geometry or edges you must set **Bottom Height** manually; it is only automatic from solid hole faces. **High.** [Fusion: Generate a Drill toolpath](https://help.autodesk.com/cloudhelp/ENU/Fusion-CAM/files/LP-STEP-IRONSTRATEGY_DRILL.htm)

**Pockets and contours.** 2D Pocket and 2D Contour accept sketch profiles and chains, and open chains work for 2D Contour. **Medium.** [Fusion: Selection using sketch profiles](https://help.autodesk.com/cloudhelp/ENU/Fusion-CAM/files/MFG-GEOMETRY-SELECTION-USING-SKETCH-PROFILE.htm)

**Templates.**
- Fusion templates store operations and tools but **not geometry selections**. Autodesk's own learning material treats "assign geometry" as a separate step, and the CAM API could not set geometry from a template as of the cited thread. **Medium.** [Autodesk Learn: toolpath template libraries](https://www.autodesk.com/learn/ondemand/curated/toolpath-template-libraries/6aEvtHO8RQhpPYsWuAbGpB), [API forum: template from named sketches](https://forums.autodesk.com/t5/fusion-api-and-scripts-forum/template-toolpath-that-gets-geometry-from-named-sketches/m-p/10381335)
- Automatic application exists only via **Hole Recognition** on **solid models**. It needs the Manufacturing Extension (paid). **High.** [Hole Recognition](https://help.autodesk.com/cloudhelp/ENU/Fusion-CAM/files/LP-READ-IRONHOLERECOGNITION.htm), [API: RecognizedHoleGroups](https://help.autodesk.com/cloudhelp/ENU/Fusion-360-API/files/cam_RecognizedHoleGroups.htm)

**Depth.**
- Depth is never taken from layer name or sketch Z. Heights are set per operation. **High**, inferred from the Drill page.
- One sketch per layer still helps: the user picks "all of sketch DRILL_D5_Z12" in one click and sets Bottom Height from the name.

---

## 5. DXF reference facts

**Versions and entities.**
- DXF R2004 and earlier are ASCII in the `$DWGCODEPAGE` code page (default ANSI_1252). R2007+ is UTF-8. **High.** [ezdxf: file encoding](https://ezdxf.mozman.at/docs/dxfinternals/fileencoding.html)
- With ASCII-only layer names this does not matter.
- `LWPOLYLINE` is not in R12. ezdxf requires R2000 (AC1015) for it. R12 uses `POLYLINE` + `VERTEX` + `SEQEND`, which also supports a closed flag and bulges. **High.** [ezdxf: LWPolyline](https://ezdxf.mozman.at/docs/dxfentities/lwpolyline.html), [ezdxf: R12 strict](https://ezdxf.readthedocs.io/en/stable/r12strict.html)

**Units.**
- "Any length or coordinate value in DXF is unitless." `$INSUNITS` (4 = mm) is the modelspace unit hint, but it is not part of R12. `$MEASUREMENT` only selects metric or imperial linetype and hatch files. **High.** [ezdxf: units](https://ezdxf.mozman.at/docs/concepts/units.html)

**Layer names.**
- R12 and R14 names are at most 31 characters, uppercase, from A–Z, 0–9, `$`, `_` and `-`. A `*` is allowed only as the first character of special names.
- R2000+ allows up to 255 characters, with spaces and more symbols.
- Names are case-insensitive, and `< > / \ " : ; ? * | = `` ` `` are always forbidden.
- **High.** [ezdxf: R12 strict](https://ezdxf.readthedocs.io/en/stable/r12strict.html), [AutoCAD EXTNAMES](https://help.autodesk.com/cloudhelp/2022/ENU/AutoCAD-LT/files/GUID-8EC065EC-D551-4E02-9C5A-A33D1DB80B05.htm), [ezdxf: Layer](https://ezdxf.mozman.at/docs/tables/layer_table_entry.html)
- **Consequence:** no `.` in names under R12, so write 12.5 as `12P5`.

---

## 6. Recommendation for the exporter

### DXF version and entity subset

**Format:**
- ASCII **DXF R12 (AC1009)**, millimetres, every Z = 0, entities in modelspace only.
- Include a minimal HEADER, TABLES/LAYER, and ENTITIES.
- R12 is the lowest common denominator. It is what Estlcam users are told to use, and every program above reads it.

**Entities to emit:**
- `CIRCLE`: drill holes, centre plus radius.
- `POLYLINE` (2D, flag 1 = closed) with `VERTEX` and `SEQEND`: Part outlines, rectangular pockets, groove rectangles.
- Optionally `LINE`: groove centrelines (see below).
- `ARC` only if outlines ever get radiused corners. Polyline bulges are also R12-legal, but some importers handle bulges less well than separate ARCs. **Low.**

**Never emit:**
- `LWPOLYLINE` (not R12), `SPLINE`, `ELLIPSE`, `INSERT`/blocks, `TEXT`/`MTEXT`, `HATCH`, `DIMENSION`, or 3D entities.
- Duplicate or overlapping geometry, which hurts Estlcam and inflates selections.
- Geometry on layer `0` or `DEFPOINTS`.

**Polyline hygiene:** close loops exactly, with the closed flag set rather than a repeated first vertex, and keep vertices distinct.

**Units:** write mm and tell the user to set the CAM job to mm. As a check, every Blank-side DXF includes the Blank boundary on its own layer (`BLANK`) so scale errors are obvious.

**Optional:** an "R2000 (LWPOLYLINE + `$INSUNITS=4`)" export toggle, if a user's tool mis-scales R12. Not needed by default.

### Grooves

**Default:** emit grooves as **closed rectangles** (slot width × length) on a pocket-style layer. This works in all four programs because pocketing a closed rectangle is universal, and it is independent of bit size.

**Optional:** a centreline `LINE` on a separate layer, for users who cut a slot with a bit of exactly the groove width (Vectric Profile-On, Carbide Create No-Offset, or Estlcam engrave).

### Layer naming scheme

The scheme is R12-safe: uppercase, `_` as the separator, `P` as the decimal point, sizes in mm, and `THRU` for through cuts. The point is that each distinct (operation, size, depth) gets its own layer, because every program binds one toolpath, and therefore one depth, to a layer.

| Feature | Layer name | Example |
|---|---|---|
| Blank boundary (reference, no toolpath) | `BLANK` | `BLANK` |
| Part outline, through cut | `OUTLINE_THRU` | `OUTLINE_THRU` |
| Drill, through | `DRILL_D{dia}_THRU` | `DRILL_D5_THRU` |
| Drill, fixed depth | `DRILL_D{dia}_Z{depth}` | `DRILL_D35_Z12P5` (35 mm hinge cup, 12.5 deep) |
| Groove (closed rectangle) | `GROOVE_W{width}_Z{depth}` | `GROOVE_W4_Z8` |
| Groove centreline (optional) | `GROOVECL_W{width}_Z{depth}` | `GROOVECL_W4_Z8` |
| Rectangular pocket | `POCKET_Z{depth}` | `POCKET_Z6` |

Notes on the scheme:

- **Length.** Names stay well under 31 characters. Prefer integer mm and use `P` only when needed.
- **Determinism.** Generate names deterministically, so the same feature always gets the same layer and templates keep matching across Blanks and projects.
- **Large holes.** Drill circles larger than the bit need a pocket or profile in CAM, not a plunge. Keeping the diameter in the layer name lets the user bind a different toolpath type per layer. Vectric's diameter filter is a fallback.
- **Ordering.** The order inside the DXF does not set machining order; the CAM toolpath order does. Put the outline last in the starter template.

### Starter templates

**VCarve/Aspire:** one Automatic toolpath per expected layer name, saved with "Save All Visible Toolpaths as a Template". Ctrl-open it for multi-sheet jobs. Missing layers can be dropped in the Missing Layers dialog.

**Carbide Create:** a starter `.c2d` with the named layers, each with a layer-linked toolpath. Import the DXF with "Insert layers from File".

**Estlcam and Fusion:** no automatic binding. The layer names still make manual selection one click per layer ("file:LAYER" in Estlcam, one sketch per layer in Fusion). The depth is readable in the name.

## Open questions and things to test

- **Carbide Create:** does Build 843+ keep R12 `POLYLINE` closed flags and true circles, or does it still facet? Does "Insert layers from File" plus layer-linked toolpaths recalculate on import?
- **Vectric:** does the DXF importer honour `$INSUNITS`? Is an R12 file with no units read as job units? Are DXF layer names case-preserved?
- **Fusion:** are sketches from "One Sketch per Layer" named after the layer?
- **Estlcam:** current v13 handling of layer lists, and whether hole auto-select can filter by diameter in a way that maps to our layer scheme.
- **A test file:** a small file per program covering one of each layer type, imported on the user's actual versions, before freezing the scheme.
