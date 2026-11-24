# Research: rectangle nesting and guillotine pre-cut algorithms in TS/JS

Ticket: GitHub issue #4 ("Research: rectangle nesting and guillotine pre-cut algorithms in TS/JS"). Researched 2026-11-24.

## Question

For a static browser app (Vite + React + TypeScript, no backend) that serves a hobby cabinet shop:

1. **Sheet → Blanks.** Which algorithm and library should make the guillotine breakdown of a full Sheet (e.g. 2800 × 2070 mm) into Blanks that fit the bed (about 1220 × 1220 mm usable), with saw kerf?
2. **Parts → Blank.** Which should nest rectangular Parts on a Blank, with tool-diameter spacing, margins and a grain lock (a Part may rotate only when its grain is "none")?
3. Should **Parts per Sheet** be optimised in one pass, nesting straight onto the Sheet with guillotine-compatible Blank boundaries, or in two passes?

Scale: a handful of cabinets, so tens of Parts and a few Sheets per job.

## Recommendation

- **Parts → Blank:** use **MaxRects with Best Short Side Fit (BSSF)**, through [`maxrects-packer`](https://github.com/soimy/maxrects-packer) (MIT, actively maintained, v3.0.0 published 2026-10-15). It supports everything the Blank side needs: padding between rects (the tool diameter), `border` (the margin) and a per-rect `allowRotation` override (the grain lock). Its default `MAX_EDGE` logic is BSSF. Jylänki rates MaxRects-BSSF the best of the single-pass heuristics. Wrap it in a cheap multistart over sort orders and heuristics, because with tens of Parts each run takes well under a millisecond.
- **Sheet → Blanks:** **write it ourselves (about 100 lines)**. Do not adopt a library here. A 2800 × 2070 Sheet holds at most four bed-sized regions, so the useful two-stage guillotine patterns (rip strips, then crosscut each strip into Blanks no larger than the bed) can be **enumerated exhaustively**, with kerf subtracted at each cut. [`guillotine-packer`](https://github.com/tyschroed/guillotine-packer) (MIT, kerf-aware) is a good, readable reference, but it has been unmaintained since January 2020. It has no Rectangle Merge step, has only a global rotation flag, and returns positions rather than a cut tree.
- **One pass or two:** use **two components with one shared objective. Do not build a true one-pass nester.** An outer loop, run one Sheet at a time, tries each candidate Blank layout, nests the remaining Parts into its Blanks with MaxRects, and keeps the layout that places the most Part area. A true one-pass nester (free nesting inside regions no larger than the bed, with guillotine cuts only between regions) exists in no TS/JS library and is hard to write. Enumeration already searches the Blank boundaries jointly with the nesting, so it captures most of the benefit of one pass at a fraction of the complexity. A naive two-pass approach, where the Blank grid is fixed first and Parts are nested afterwards, is the option to avoid.
- **Watch:** [`@0xdoublesharp/bin-packing-wasm`](https://www.npmjs.com/package/@0xdoublesharp/bin-packing-wasm) (MIT, a Rust crate compiled to WASM). It has MaxRects, Skyline, guillotine beam search, staged guillotine cut trees with kerf and trims, per-item rotation, and spacing. It is the most complete option found, but it is seven months old, has a single maintainer, is pre-1.0 (0.6.2 was released the day this was researched) and adds about 0.9 MB of WASM for the 2D build. Re-evaluate it if the hand-rolled pieces prove too weak.

## Background: the algorithm families (Jylänki 2010)

Primary source: J. Jylänki, *A Thousand Ways to Pack the Bin – A Practical Approach to Two-Dimensional Rectangle Bin Packing*, 27 February 2010. The PDF and reference C++ code are in [juj/RectangleBinPack](https://github.com/juj/RectangleBinPack). The code is public domain ("All the code is released to Public Domain", Readme.txt) and was last changed in 2023.

- **Guillotineable** packings are defined in §1: a packing that "can be split into two parts P1, P2 with a single straight horizontal or vertical cut that doesn't cross any of the rectangles", recursively. Only this kind of packing can be cut on a panel saw or table saw.
- **Rotation** is "not in any way a critical property for the working of any of the heuristic methods". Every heuristic can be run without rotation, so a per-Part grain lock is easy to add to any of them.
- **Guillotine algorithm (§2.2).** It keeps a list of disjoint free rectangles and splits the chosen one along one axis after each placement. It needs a choice rule (BAF, BSSF, BLSF, …) and a split rule (SAS, LAS, SLAS, LLAS, MINAS, MAXAS). Its weakness, in Jylänki's words: "rectangles cannot be placed in any position of the free area where the rectangle would straddle an existing split line." The **Rectangle Merge (-RM)** step addresses this, and "on average, the Rectangle Merge was seen to improve the results in all cases" (§4.4). Every guillotine variant produces guillotineable packings.
- **MaxRects (§2.4).** It keeps *overlapping* maximal free rectangles, which "essentially corresponds to picking both split axes at the same time". Its packings are **not** guillotineable in general.
- **Results (§4, §5).** The score is bins used relative to a lower bound, so 1.0 is perfect. For offline packing: MAXRECTS-BSSF-BBF-GLOBAL scored **1.005**, MAXRECTS-BSSF-BBF-DESCSS **1.009**, the best Skyline **1.013**, and the best guillotine (GUILLOTINE-BSSF-SAS-RM-DESCSS-BFF) **1.016**. Jylänki concludes: "It is clear that the MAXRECTS algorithms perform the best of all … The GUILLOTINE variants are asymptotically faster … but also perform slightly worse. The SHELF algorithms should only be favored if implementation simplicity is a concern."
- **Complexity.** Guillotine is O(n²), or O(n³) with -RM (Table 2, Proposition 6). The -GLOBAL variant, which picks the best rectangle and placement among all remaining rectangles at every step, "adds a linear factor" (Proposition 16). With n ≈ 10–100 all of these finish in milliseconds in a browser, so even the most expensive variant, or many restarts of a cheaper one, is affordable.

What this means here: on the benchmark the quality gap between guillotine and MaxRects is only about 1%. Constraints matter more than the choice of heuristic. The Sheet cut must be guillotine because it is made on a saw. The Blank nest does not need to be guillotine, because a CNC router cuts around each Part, so the slightly stronger MaxRects can be used there.

For staged guillotine cutting as an optimisation problem, the classic primary source is Gilmore & Gomory, "Multistage Cutting Stock Problems of Two and More Dimensions", *Operations Research* 13(1):94–120, 1965 ([DOI 10.1287/opre.13.1.94](https://doi.org/10.1287/opre.13.1.94)). It shows that problems cut in stages (rip strips, then crosscut them) have tractable pattern subproblems. That is the structure the Sheet → Blank step uses below.

## Candidate libraries

The npm registry data was checked on 2026-11-24, and the source was read from a clone of each repo where noted.

| Package | Latest (published) | Licence | Algorithms | Spacing / margin | Per-item rotation | Fits |
|---|---|---|---|---|---|---|
| [`maxrects-packer`](https://github.com/soimy/maxrects-packer) | 3.0.0 (2026-10-15) | MIT | MaxRects; `logic` = `MAX_EDGE` (BSSF, the default), `MAX_AREA` (BAF), `FILL_WIDTH` | `padding` (constructor arg 3), `border` option | Yes: a `Rectangle.allowRotation` overrides the packer option (`src/maxrects-bin.ts`) | **Parts → Blank** |
| [`guillotine-packer`](https://github.com/tyschroed/guillotine-packer) | 1.0.2 (2020-01-27) | MIT | Guillotine; 3 selection × 4 split × 6 sort × 2 directions, all tried by default | `kerfSize` | Global `allowRotation` only | Reference for Sheet → Blanks |
| [`binpackingjs`](https://github.com/olragon/binpackingjs) | 4.1.0 (2026-05-14) | MIT | MaxRects (Jylänki), 4 heuristics; heterogeneous bin list | None (inflate rects yourself) | Yes: `constrainRotation` per box | Alternative to maxrects-packer |
| [`rectangle-packer`](https://github.com/SilenceLeo/rectangle-packer) | 1.0.4 (2025-07-06) | MIT | Port of Jylänki's `GuillotineBinPack` (with merge) and an area packer | None documented | Not documented | Single-bin guillotine only |
| [`@0xdoublesharp/bin-packing-wasm`](https://www.npmjs.com/package/@0xdoublesharp/bin-packing-wasm) | 0.6.2 (2026-11-24; first release 2026-04-12) | MIT | MaxRects, Skyline, guillotine beam search, shelf, multistart; `solve2dStaged` cut trees | Kerf, trims, "kerf-aware gap enforcement" | `can_rotate` per demand | Everything, but young and heavy |
| [`potpack`](https://github.com/mapbox/potpack) | 2.1.0 (2025-07-14) | ISC | Shelf-like, grows the container toward a square | No | No | No: no fixed bin |
| [`bin-pack`](https://github.com/bryanburgers/bin-pack) | 1.0.2 (2016) | MIT | Growing binary-tree packer (Jake Gordon, blackpawn) | No | No | No: unmaintained, no fixed bin |
| [`cut-optimizer`](https://npmjs.com/package/cut-optimizer) | 0.1.1 (2018) | ISC | Same Jake Gordon packer | No | No | No |

Notes from reading the source:

- **maxrects-packer** ([repo](https://github.com/soimy/maxrects-packer)). Its commit history shows almost daily commits in October 2026. It has no runtime dependencies and ships TypeScript types.
  - **Spacing.** It inflates each rect by `padding` and the bin by `+ padding − 2·border` (`src/maxrects-bin.ts`). So `padding` is the exact gap between Parts, and `border` is the exact margin to the Blank edge. This maps directly to tool diameter and margin.
  - **Multiple bins.** `MaxRectsPacker` opens new bins of one fixed size. For Blanks of mixed sizes, drive `MaxRectsBin` instances directly, or call `addArray` once per Blank.
  - **Smart sizing.** `smart: true` grows a bin only as far as needed. Turn it off, because we want fixed Blank sizes.
- **guillotine-packer** ([repo](https://github.com/tyschroed/guillotine-packer)).
  - **Maintenance.** The last commit that is not from Dependabot is dated 2020-01-27.
  - **Kerf.** It is added to the offset of each free rectangle after a split (`src/split-strategies.ts`), which is the right way to model a saw cut.
  - **No Rectangle Merge.** It has no merge step (grep finds no "merge"), even though Jylänki shows merging always helps.
  - **Result selection.** It runs 144 strategy combinations and keeps the result with the fewest bins. Ties go to whichever came first, not to the one with the least waste.
  - **Output.** It returns item positions, not a cut sequence.
  - **Dependency.** It depends at runtime on `debug`.
- **@0xdoublesharp/bin-packing-wasm** ([npm](https://www.npmjs.com/package/@0xdoublesharp/bin-packing-wasm), source in [0xdoublesharp/bin-packing](https://github.com/0xdoublesharp/bin-packing)). According to its README:
  - `solve2dStaged` "returns physical staged guillotine cut trees, including kerf, trims, defects".
  - `guillotine_required: true` "restrict[s] `auto` to guillotine-compatible constructions".
  - The WASM files are 0.9 MB for `two-d` and 2.35 MB for the full build, before compression.
  - It has had nine releases in seven months. That is fast-moving, so pin an exact version if it is adopted.

## Sub-problem 1: Sheet → Blanks (guillotine with kerf)

Because the Sheet is tiny compared with the bed, this is barely an optimisation problem. With kerf `k` (one blade width, e.g. 3–4 mm, as an assumption):

- 2800 mm length → at most two full 1220 mm crosscuts, plus an offcut of about 2800 − 2·1220 − 2k ≈ 350 mm.
- 2070 mm width → one full 1220 mm rip, plus an offcut of about 2070 − 1220 − k ≈ 845 mm.

So one Sheet gives at most about **2 × (1220 × 1220) + 2 × (1220 × 845) + 2 offcut strips** (about 350 × 1220 and 350 × 845) when Blanks are taken at full bed size. A Blank does not have to be full bed size, though. Cutting a strip to the height the nested Parts actually need leaves a bigger, reusable offcut.

Suggested approach:

1. Model a **two-stage (or three-stage) guillotine pattern**: rip the Sheet into strips along one axis, then crosscut each strip into Blanks, each at most the bed size. Try both rip orientations. This is the staged structure from Gilmore & Gomory 1965, and on a panel saw it is also the easiest to cut.
2. **Enumerate** the strip widths and Blank lengths from a small candidate set. Take the bed size, the remaining Sheet length, and "the nested extent of the Parts plus margins" fed back from the Blank nest (see below). Subtract `k` for every cut. With at most about 2 × 3 regions the search space is tiny, so no heuristic is needed.
3. **Grain coupling.** A Blank inherits the grain direction of the Sheet. If any grained Part is nested on a Blank, the Blank's orientation on the bed must be tracked. The Sheet → Blank step must therefore either never rotate Blanks, or record the rotation so the Blank nest flips the meaning of "length" and "width" grain. `guillotine-packer` has only a global `allowRotation`, which is a further reason to own this step.
4. **Trim.** If the factory edge of the Sheet needs trimming, shrink the Sheet by the trim before step 1.

If a general solver is wanted later (for example, offcut Sheets of arbitrary sizes), port Jylänki's `GuillotineBinPack` with -RM and BSSF + SAS (his best offline guillotine variant), using `guillotine-packer`'s kerf handling as the model. Alternatively, evaluate `solve2dStaged` in `bin-packing-wasm`.

## Sub-problem 2: Parts → Blank (CNC nesting)

- Use **MaxRects-BSSF** (`maxrects-packer` with the default `logic: MAX_EDGE`) and `allowRotation: false` globally. Set `rect.allowRotation = true` only on Parts whose grain is "none".
- Pass the tool diameter as `padding`. A shared cut between Parts would need a gap of exactly one tool diameter; add an allowance if hold-down tabs or onion-skin need more. Pass the margin, the clamp/edge allowance, as `border`.
- **Multistart.** Jylänki's best offline results come from sorting (DESCSS) and global selection. `maxrects-packer` sorts once with a fixed rule, so call it with several input orders: by area, long side, short side and perimeter, descending, plus a few random shuffles. Keep the best result. For tens of Parts this costs milliseconds.
- **Parts larger than the bed** (e.g. a 2000 mm tall-cabinet side) cannot go on any Blank. They must be reported up front, not silently dropped.

`binpackingjs` would do the same job, with per-box `constrainRotation` and a list of bins of different sizes. It has no padding, though, so every Part would have to be inflated by the tool diameter and every Blank by `tool − 2·margin` manually. `maxrects-packer` already does that arithmetic.

## One pass or two?

| Approach | What it optimises | Quality | Complexity | Library support |
|---|---|---|---|---|
| **Naive two-pass:** fixed Blank grid first, then nest Parts | Blanks chosen without knowing the Parts | Worst. Narrow Parts that would fit a 1220 × 845 strip may be forced onto a full Blank, or vice versa, and the offcut is wasted | Lowest | Any |
| **Coupled two-pass (recommended):** enumerate Blank layouts per Sheet, nest the remaining Parts into each, keep the best, repeat for the next Sheet | Blank boundaries and nests together, one Sheet at a time (greedy across Sheets) | Close to one-pass for this problem size: the enumeration covers every sensible guillotine layout because there are so few | Low. Two small pure functions plus a loop | `maxrects-packer` + own enumerator |
| **True one-pass:** nest freely on the Sheet, subject to "guillotine cuts between regions no larger than the bed, free nesting inside" | Everything at once, across Sheets | Best in theory | High. A custom hierarchical constraint that no TS/JS library offers. The fully guillotine `solve2dStaged` in `bin-packing-wasm` forces guillotine *inside* Blanks too, which wastes material the CNC could have used | None that fits exactly |

**Recommendation: the coupled two-pass approach.** Run this loop for each Sheet:

1. Enumerate each candidate guillotine layout of the Sheet into Blanks.
2. Nest the remaining Parts into the layout's Blanks with MaxRects-BSSF and multistart.
3. Score the layout by the Part area placed. Break ties by fewest Blanks, then by largest rectangular offcut.

Commit the best layout, remove its Parts, and move on to the next Sheet. Shrinking a strip to the extent the nest actually used is a cheap refinement inside the same loop: re-crosscut it, which leaves a larger offcut.

This keeps two seams, each easy to test on its own: `sheetToBlanks(sheet, kerf, bed) → BlankLayout[]` and `nestParts(blank, parts, tool, margin) → Placement[]`. It still optimises **Parts per Sheet** directly. Greedy one-Sheet-at-a-time is the standard sequential heuristic for cutting stock, and with a handful of Sheets per job the gap to a global optimum is small. If it ever matters, a few random restarts of the outer loop, with different Part orders, are still cheap.

## Open questions for the owner

- Kerf and tool-diameter values, and whether CNC Parts may share a single cut line, which changes `padding` from one tool diameter to zero.
- Whether offcut strips (about 350 mm wide) should be kept as stock or treated as waste. This changes the tie-breaker.
- How to handle Parts larger than the bed: exclude them from CNC, or cut them on the saw.

## Sources

- Jylänki, *A Thousand Ways to Pack the Bin* (2010), PDF in [juj/RectangleBinPack](https://github.com/juj/RectangleBinPack) (`RectangleBinPack.pdf`, `Readme.txt`).
- Gilmore & Gomory, "Multistage Cutting Stock Problems of Two and More Dimensions", Operations Research 13(1):94–120, 1965, [doi:10.1287/opre.13.1.94](https://doi.org/10.1287/opre.13.1.94) (abstract only; full text not read).
- [soimy/maxrects-packer](https://github.com/soimy/maxrects-packer): `src/maxrects-bin.ts`, `src/types.ts`, `src/maxrects-packer.ts`, read at the 2026-10-15 HEAD.
- [tyschroed/guillotine-packer](https://github.com/tyschroed/guillotine-packer): `src/guillotine-packer.ts`, `src/split-strategies.ts`, `src/selection-strategies.ts`, `src/sort-strategies.ts`.
- [olragon/binpackingjs](https://github.com/olragon/binpackingjs) and [SilenceLeo/rectangle-packer](https://github.com/SilenceLeo/rectangle-packer) READMEs from their npm tarballs.
- [`@0xdoublesharp/bin-packing-wasm` 0.6.2](https://www.npmjs.com/package/@0xdoublesharp/bin-packing-wasm) README and `package.json` from the npm tarball.
- npm registry metadata (`registry.npmjs.org/<pkg>`) for versions, publish dates and licences, fetched 2026-11-24.
