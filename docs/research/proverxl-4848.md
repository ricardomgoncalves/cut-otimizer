# Genmitsu PROVerXL 4848 (sold as "PROVerXL 4X4"): working area, hold-down, tooling

Research for issue #2. Researched 2026-11-24.

The question: what does this machine allow for **Blank** size, clamping margin, and which hole
diameters can be drilled (plunged with a matching tool) versus helix-milled.

Confidence: **High** means it comes from the manufacturer's manual or product page. **Medium**
means it comes from the manufacturer but conflicts with another source or is inferred from a
sibling product. **Low** means it is general practice or my own inference.

## 0. Naming

SainSmart doesn't sell a model called "PROVerXL 4848". Its product, manual and press release
all use the name **PROVerXL 4X4** (a 48" x 48" class machine, announced 2025-02-06). This note
assumes "4848" means the 4X4. (Confidence: Medium. Nothing else matches the name.)

## 1. Working area and Z

| Fact | Value | Confidence | Source |
|---|---|---|---|
| Work area X x Y x Z (single Z) | **1300 x 1300 x 115 mm** (manual) / **1300 x 1300 x 118 mm** (product page) | High for X/Y; Medium for Z (sources disagree by 3 mm) | [Manual V1.0 Nov 2024, p.3 "Specifications"][manual]; [product page][product] |
| Work area with optional 2nd (add-on) Z module | **600 x 1300 x 118 mm** | High (product page) | [product page][product] |
| Overall machine footprint | 1893 x 1842 x 617 mm | High | [manual][manual], [product page][product] |
| Motion | Ball screws and linear guides on X/Y/Z (Z: HG15 rails, 12 mm ball screw); NEMA 23 closed loop | High | [manual][manual], [product page][product] |
| Max speed | 5000 mm/min | High | [manual][manual] |
| Controller | 32-bit, GRBL 1.1h compatible (Candle, UGS), plus Wi-Fi app | High | [manual][manual] |
| Press-release work area | 51.18 in x 51.18 in (= 1300 mm) | High | [press release][pr] |

**What "115/118 mm" means is not defined.** Neither SainSmart source says whether this is Z
travel or gantry clearance (the most material that fits under the gantry). Clearance also depends
on the router and bit you fit, because the machine ships *without* a spindle. A third-party
comparison of published Z figures makes the same point ([yeomanwork Z-height comparison][zcmp]).
For 18 mm board on a ~20 mm spoilboard this does not matter: either reading leaves plenty of room.
(Confidence: High that it is enough for 18 mm sheet; Low on the exact meaning.)

**Check on the real machine:** GRBL stores the soft-limit travels in `$130`/`$131`/`$132`. Read
them with `$$` and probe the real reachable rectangle before fixing the Blank size in code.
1300 mm is the nominal figure. The usable rectangle shrinks further by the tool radius and the
clamp footprint.

### Implication for Blank size (Confidence: Low, inference)

- The nominal maximum Blank is **1300 x 1300 mm**. With the dual-Z option fitted it is only
  **600 x 1300 mm**, so the app should take the machine envelope as config, not a constant.
- Toolpaths need the tool's centre line to reach `Blank edge + tool radius`. For a profile cut
  around a 1300 mm Blank you need about 1306 mm of travel. In practice, size Blanks a little under
  the envelope (for example about 1250 x 1250 mm) and leave a clamping margin around them (see §2).
- From a 2800 x 2070 sheet, two 1300-wide strips along 2800 leave about 200 mm (less the saw
  kerfs). Along 2070, one 1300 cut leaves a 770 mm Blank.

## 2. Spoilboard and hold-down

| Fact | Value | Confidence | Source |
|---|---|---|---|
| Bed type | "MDF & Aluminum Hybrid Spoilboard": aluminium T-slot extrusions with MDF inserts, bolted to base support profiles | High | [product page][product]; [manual §Mechanical Installation, Step 2][manual] |
| Number of slats | **17** "T-slot Hybrid Spoilboard" slats: one with a built-in probe / tool-setting block, plus 16 standard. Fixed with 8 + 96 M5x16 screws | High (manual unboxing and Step 2) | [manual][manual] |
| T-slot pitch / slot size | **Not published.** Inferred: about 1300-1400 mm / 17 ≈ 80 mm pitch, with slots running along one axis | Low (inference; measure it) | none |
| Included clamps | **(8) Clamp Kit**, plus (4) M5 T-nuts. So M5 hardware in the T-slots | High | [manual unboxing p.7][manual] |
| Slat replacement | On sibling hybrid boards SainSmart says you can replace a single MDF slat | Medium (sibling product) | [6060 hybrid spoilboard page][hyb6060] |
| Sibling 1313 hybrid board size | 1490 x 1393 x 20 mm (for the 4030 V2 → 1313 kit, not the 4X4) | Medium (proxy only) | [1313 listing][hyb1313] |
| Vacuum table | **No SainSmart vacuum table is offered or documented for the 4X4.** SainSmart's only vacuum bed found is for the 3018-PROVer | Medium (absence of evidence) | [product page][product], [resource page][res], [3018 vacuum bed blog][vac3018] |

Notes (Confidence: Low, general practice and inference):
- The slatted hybrid bed has gaps and is **not a vacuum plenum**. Vacuum hold-down would need a
  separate sealed plenum and bleeder board on top, plus a vacuum pump. That costs Z and is a DIY
  project.
- With T-slot clamps, nesting has to leave a **clamping margin** around the Blank. Plan 30-50 mm
  per clamped edge and verify it against the actual clamp kit. Alternatively, screw the Blank
  down through the margin or the waste areas.
- For small cabinet parts cut from a clamped Blank, use **tabs** or onion-skin passes so parts
  don't move once they are freed. The DXF/CAM side should allow tabs.
- The included 1/4" surfacing bit (1-1/4" cutting diameter) is meant for flattening the MDF
  slats ([manual][manual]).

## 3. Spindle, collet and tool diameters

| Fact | Value | Confidence | Source |
|---|---|---|---|
| Spindle | **Not included.** The machine takes a Φ65 mm trim router or spindle (Φ65 holder included). Optional: Genmitsu 710 W trimmer, or a 1.5/2.2 kW water-cooled spindle kit (80 mm) | High | [product page][product], [manual][manual] |
| Collet shipped with the machine | **ER11 1/4"** collet | High | [manual unboxing p.8][manual] |
| Genmitsu 710 W router | ER11 nut. Ships with 1/8" collet; 1/4" and metric collets sold separately; 6500-30000 rpm; runout < 0.05 mm | High | [710 W router page][r710] |
| 1.5 kW water-cooled spindle | **ER11**; 24k rpm | High | [water-cooled spindle page][wc] |
| 2.2 kW water-cooled spindle | **ER20** | High | [water-cooled spindle page][wc] |
| ER11 shank capacity | Tops out at about 7 mm, so **no 8 mm shanks**. 6 mm, 1/4" (6.35 mm) and 1/8" are fine | Medium (common ER11 spec; exact upper limit not confirmed from REGO-FIX in this pass; SainSmart's "1-8mm" wording is loose) | [REGO-FIX ER catalogue][regofix] (family only) |
| ER20 capacity | Up to 13 mm shanks (for example 8 mm, 10 mm, 12 mm, 1/2") | Medium | [Hoffmann ER20 13 mm collet][hoff] |
| Bits in the box | 10 flat engraving bits, 1x 1/4" surfacing bit, 2x 1/8" single-flute, 2x 1/4" single-flute, 1x 1/8" 2-flute end mill | High | [product page][product], [manual][manual] |
| SainSmart's own 1/4" upcut/downcut ranges | SU05A 1/4" single-flute upcut, cutting length 12/15/17/22/25 mm. SD03A 1/4" downcut 12/17/22 mm. SC05A compression only in 1/8" (3.175 mm) | High | [SainSmart CNC bit buying guide V1.3][bitguide] |

### Typical tools for 18 mm chipboard / MDF on this machine (Confidence: Low to Medium, practice)

- **Profile / through-cut:** a **6 mm or 1/4" (6.35 mm)** end mill (upcut, downcut, or ideally
  compression for melamine-faced chipboard) with **≥ 22 mm cutting length**, cutting full depth in
  several passes. 1/4" is the largest size the stock ER11 collet and the 710 W router take. 8 mm
  and 10/12 mm cutters need the 2.2 kW ER20 spindle.
- **Small details and inside corners:** 1/8" (3.175 mm) bits come in the box. Too long and
  flexible for through-cutting 18 mm stock efficiently.
- **Hard limit:** an inside corner radius can be no smaller than the tool radius (3.0 to 3.175 mm
  for a 6 mm or 1/4" tool).

### Drilled vs helixed holes (Confidence: Low, inference)

The router can only **plunge-drill** a hole whose diameter equals a tool it holds (≤ 7 mm shank on
ER11, ≤ 13 mm on ER20). Anything larger than the tool must be **helix- or pocket-milled**
(diameter > tool diameter).

| Cabinet hole | Typical Ø | On this machine (ER11 / 1/4") |
|---|---|---|
| Shelf pin (System 32) | 5 mm | Drill with a 5 mm bit (5 mm collet or 1/4"-shank 5 mm drill). The 6.35 mm end mill can't make it |
| Confirmat body / pilot | 7 / 5 mm | 5 mm drilled; 7 mm with a 7 mm ER11 collet, otherwise helix with a 1/8" or 6 mm tool |
| Dowel | 8 mm | **Helix** with 6 mm or 1/4" (ER11 can't hold 8 mm shanks); drill only on ER20 |
| Cam housing | 15 mm | Helix / pocket |
| Hinge cup (Blum CLIP top) | **35 mm, 13 mm deep** | Helix / pocket. Hinge mounting holes are 8 mm (helix on ER11) |

The hinge cup figures come from Blum and retailer data ([Blum CLIP top BLUMOTION assembly][blum]; [Würth spec sheet][wurth]).
Shelf-pin, confirmat, dowel and cam diameters are common industry values that I did not verify
against a primary source in this pass.

**Suggested rule for the app:** treat a hole as drillable only if its Ø matches a configured drill
or end mill in the tool library. Otherwise helix it with the largest configured end mill that is
smaller than the hole.

## Open items (verify on the real machine)

1. Exact X/Y/Z soft-limit travel (`$130-$132`) and the real reachable rectangle with the chosen
   router installed.
2. T-slot pitch, slot direction and slot size on the 17-slat bed; footprint of the included clamps.
3. Which spindle is actually fitted (710 W ER11, a third-party Φ65 router, or the 2.2 kW ER20),
   since that decides the largest shank size.

## Sources

- [manual]: SainSmart, *PROVerXL 4X4 CNC Router Kits User Guide*, V1.0 Nov 2024 (EN/DE/JP) – https://genmitsu.s3.us-east-1.amazonaws.com/101-60-XL4x4/Genmitsu_PROVerXL_4x4_User_Manual_V1.0.0_EN_DE_JP.pdf
- [product]: SainSmart product page, PROVerXL 4x4 – https://sainsmart.com/products/proverxl-4x4-cnc
- [res]: SainSmart Resource Center, PROVerXL 4x4 Resource Page – https://docs.sainsmart.com/article/5xi10y6y87-prover-xl-4-x-4-resource-page
- [pr]: PR Newswire, "SainSmart Unveils the Genmitsu PROVerXL 4x4 CNC Machine" (2025-02-06) – https://www.prnewswire.com/news-releases/sainsmart-unveils-the-genmitsu-proverxl-4x4-cnc-machine-precision-and-power-for-makers-and-small-businesses-302370131.html
- [r710]: SainSmart, Genmitsu 710W Trimmer Router – https://www.sainsmart.com/products/710w-trimmer-router
- [wc]: SainSmart, Water-cooled spindle motor kit (1.5 kW ER11 / 2.2 kW ER20) – https://www.sainsmart.com/products/water-cooled-spindle-motor
- [bitguide]: SainSmart CNC Bit Selection Buying Guide V1.3 – https://cdn.shopify.com/s/files/1/1978/9859/files/CNC_Buying_Guide_V1.3-202104.pdf
- [hyb6060]: SainSmart 6060 hybrid spoilboard – https://www.sainsmart.com/products/genmitsu-t-track-grid-table-6060-aluminum-mdf-hybrid-spoilboard-for-proverxl-4030-xy-axis-6060-extension-kit
- [hyb1313]: 1313 hybrid spoilboard listing (reseller) – https://woodartsupply.com/products/genmitsu-1313-aluminum-mdf-hybrid-spoilboard-table-for-cnc-router-machine-proverxl-4030-v2-to-1313-xy-axis-extension-kit-1490-x-1393-x-20mm-58-7x-54-8x-0-8
- [vac3018]: SainSmart blog, Genmitsu Vacuum Table for 3018-PROVer – https://www.sainsmart.com/blogs/news/genmitsu-vacuum-bed
- [zcmp]: Desktop CNC Z height compared (secondary) – https://www.yeomanwork.com/cnc/blog/desktop-cnc-z-height-compared
- [regofix]: REGO-FIX ER system catalogue – https://www.productivity.com/wp-content/uploads/2020/04/Rego-Fix-_ER_System-3-25-20-Interactive.pdf
- [hoff]: Hoffmann Group ER20 13 mm collet – https://www.hoffmann-group.com/US/en/hus/p/308933-13
- [blum]: Blum CLIP top BLUMOTION assembly – https://blum.com/us/en/products/hingesystems/clip-top-blumotion/assembly
- [wurth]: Würth Baer spec sheet B71M2690B – https://xcart.wurthlac.com/skin/common_files/files/specs/B71M2690B_SpecSheet.pdf

[manual]: https://genmitsu.s3.us-east-1.amazonaws.com/101-60-XL4x4/Genmitsu_PROVerXL_4x4_User_Manual_V1.0.0_EN_DE_JP.pdf
[product]: https://sainsmart.com/products/proverxl-4x4-cnc
[res]: https://docs.sainsmart.com/article/5xi10y6y87-prover-xl-4-x-4-resource-page
[pr]: https://www.prnewswire.com/news-releases/sainsmart-unveils-the-genmitsu-proverxl-4x4-cnc-machine-precision-and-power-for-makers-and-small-businesses-302370131.html
[r710]: https://www.sainsmart.com/products/710w-trimmer-router
[wc]: https://www.sainsmart.com/products/water-cooled-spindle-motor
[bitguide]: https://cdn.shopify.com/s/files/1/1978/9859/files/CNC_Buying_Guide_V1.3-202104.pdf
[hyb6060]: https://www.sainsmart.com/products/genmitsu-t-track-grid-table-6060-aluminum-mdf-hybrid-spoilboard-for-proverxl-4030-xy-axis-6060-extension-kit
[hyb1313]: https://woodartsupply.com/products/genmitsu-1313-aluminum-mdf-hybrid-spoilboard-table-for-cnc-router-machine-proverxl-4030-v2-to-1313-xy-axis-extension-kit-1490-x-1393-x-20mm-58-7x-54-8x-0-8
[vac3018]: https://www.sainsmart.com/blogs/news/genmitsu-vacuum-bed
[zcmp]: https://www.yeomanwork.com/cnc/blog/desktop-cnc-z-height-compared
[regofix]: https://www.productivity.com/wp-content/uploads/2020/04/Rego-Fix-_ER_System-3-25-20-Interactive.pdf
[hoff]: https://www.hoffmann-group.com/US/en/hus/p/308933-13
[blum]: https://blum.com/us/en/products/hingesystems/clip-top-blumotion/assembly
[wurth]: https://xcart.wurthlac.com/skin/common_files/files/specs/B71M2690B_SpecSheet.pdf
