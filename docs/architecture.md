# Architecture notes

Working notes written while building v1 (spec #20), one section per ticket in the order they landed.
Later sections can refine or supersede earlier ones; the "Review fixes" section at the end records the
final shape after the code review. For the requirements, see the PRD; for the export's shape, see
[`parts-export.md`](parts-export.md).

## Toolchain, from the ticket #21 scaffold (pinned in package.json / bun.lock)
- Bun 1.4.4 (package manager + script runner; CI uses oven-sh/setup-bun with 1.4.4)
- Vite 8, @vitejs/plugin-react 6, React 19
- TypeScript **6.0.x** (not 7: typescript-eslint 8.74 needs `<6.1`)
- ESLint 10 flat config (`eslint.config.js`), typescript-eslint `strict` + `stylistic`
- Vitest 5 (config lives in `vite.config.ts` under `test`, imported from `vitest/config`)
- @playwright/test **1.63.0 exactly** — matches the pre-installed Chromium rev 1243 in
  `/opt/pw-browsers` (PLAYWRIGHT_BROWSERS_PATH). Do not bump it locally without checking that
  revision, and never run `playwright install` locally. CI installs browsers itself.

## Layout
```
index.html               -> loads /src/shell/main.tsx
src/core/                pure TS: no React, no DOM, no shell imports
src/shell/               React UI + browser APIs (main.tsx, App.tsx)
tests/                   repo-level Vitest tests (e.g. core-boundary.test.ts lints snippets)
e2e/                     Playwright specs (*.spec.ts), run against `vite preview` on :4173
Dockerfile, nginx.conf   multi-stage: oven/bun build -> nginx:alpine serving dist/ (SPA fallback)
.github/workflows/ci.yml jobs: check (typecheck, lint, test, build, playwright) + docker (build & curl)
```
- Unit tests go next to modules as `src/**/*.test.ts` (or in `tests/`). Vitest env is `node`.
  Core tests import from `vitest` explicitly (no globals).
- No unit tests for React components (PRD); shell behaviour is covered by Playwright.
- Imports use explicit `.ts`/`.tsx` extensions (`allowImportingTsExtensions`, `verbatimModuleSyntax`
  — use `import type` for types).

## Core purity is enforced twice
1. `tsconfig.core.json`: `lib: ["ES2023"]`, `types: []`, no `jsx` -> `window`/`document` and JSX
   fail `tsc -b`.
2. ESLint block for `src/core/**/*.ts`: `no-restricted-imports` (react, react-dom, react/*,
   react-dom/*, dexie, pdf-lib, anything under a `shell` path) and `no-restricted-globals`
   (window, document, navigator, localStorage, sessionStorage, indexedDB, location, history,
   alert, fetch). If a later ticket adds a browser-only library (e.g. a Dexie wrapper),
   add it to the regex in `eslint.config.js`.
Shell code uses `tsconfig.app.json` (DOM lib, react-jsx, vite/client types).
Configs/e2e/tests use `tsconfig.node.json` (node types).
Strict flags on everything: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
`noUnusedLocals/Parameters`, `erasableSyntaxOnly` (no enums/namespaces/parameter properties).

## Scripts
| script | does |
|---|---|
| `bun run dev` | Vite dev server (:5173) |
| `bun run build` | `vite build` -> `dist/` |
| `bun run preview` | serve `dist/` (:4173) |
| `bun run typecheck` | `tsc -b` over core/app/node projects |
| `bun run lint` | `eslint .` |
| `bun run test` | `vitest run` |
| `bun run e2e` | `playwright test` (needs a prior `build`; starts `vite preview` itself) |
| `bun run check` | all of the above in order |


## Parts Export schema and fixtures (ticket #22)
- `vendor/parts-export/`: `parts-export.v1.schema.json` + guide, copied unchanged from cabinet-planner
  `f2da2ce`; `SOURCE.md` records the commit. Not linted, not imported by any tsconfig yet.
- `fixtures/*.json`: Parts Exports. `tests/fixtures.test.ts` validates **every** `.json` there against the
  vendored schema (ajv `Ajv2020`, `strict: false`, `date-time` added as a regex like cabinet-planner does,
  no ajv-formats), plus coverage checks on `fixtures/synthetic.parts.json`. Drop the anonymized real export
  (#23) into `fixtures/` and it is validated automatically.
- `ajv@^8.20` is a runtime **dependency** (the Import module will need it). Import it as
  `import { Ajv2020 } from 'ajv/dist/2020.js'` (named export + `.js` works under our bundler/TS settings).
- The test reads JSON with `node:fs` (tests/ is in tsconfig.node). For core Import (#24): `resolveJsonModule`
  is NOT on in tsconfig.base; either enable it and add `vendor/**/*.json` to tsconfig.core's `include`
  (cabinet-planner's approach: core includes `docs/**/*.json`), or pass the schema in.
- Shape guide for later tickets: [`docs/parts-export.md`](parts-export.md).

## cabinet-planner comparison (read at f2da2ce; scaffold left unchanged)
- **Scripts**: theirs `build` = `tsc -b && vite build`, no `check`/`e2e` scripts and no Playwright at all;
  UI is unit-tested with Testing Library + jsdom (our PRD forbids component unit tests). Extra scripts:
  `gen:types` (json-schema-to-typescript turns the Project schema into `*.generated.ts`; CI regenerates and
  `git diff --exit-code`s it) and `sync:engine` (re-vendors cabinet-engine). A `gen:types` for
  `PartsExport` types from our vendored schema would be a cheap win for #24.
- **Deps**: ajv `^8.20` runtime (same as ours now), Dexie 4, @types/node `^26` (ours pins 22),
  typescript `~6.0.0`. No react-refresh plugin.
- **tsconfigs**: same four-project idea (base/core/app/node) plus `tsconfig.vendor.json` for vendored code
  (unused-name checks off). Theirs use `composite` + `emitDeclarationOnly` into `node_modules/.tmp`, app
  `references` core and `exclude`s `src/core` (ours: app includes only `src/shell`, `noEmit`,
  `allowImportingTsExtensions`). They have `resolveJsonModule` + `isolatedModules`; they do NOT have
  `exactOptionalPropertyTypes`, `erasableSyntaxOnly`, `noImplicitOverride`, `noUncheckedSideEffectImports`
  — ours is stricter. Their tests live in `src/core/**` and typecheck with the core project; ours in `tests/`
  typecheck under node.
- **ESLint**: theirs uses `tseslint.config(...)` with `recommended` (ours: `defineConfig`, `strict` +
  `stylistic`). Ignores include `vendor`, `.claude` and `*.generated.ts`. **Ours does not ignore `.claude`**:
  `eslint .` from the main checkout also walks `.claude/worktrees/*` — worth adding to `globalIgnores`
  (and `vendor` once it holds code).
- **Core purity**: theirs = tsconfig.core without DOM lib + `no-restricted-imports` on `src/core/**`
  (react*, zustand, zundo, dexie; paths `**/ui/**`, `**/store/**`, `**/persistence/**`). No
  `no-restricted-globals` and no boundary tests; ours adds both.
- **Vitest**: theirs uses `test.projects` — `core` (node, setup file loads fake-indexeddb) and `ui` (jsdom).
  Ours is one node project. If the Job store (Dexie) gets adapter tests, `fake-indexeddb` is their pattern.
- **CI**: theirs runs only on `pull_request`, bun `'1.4'` + setup-node 22, the gen-types diff, no e2e; the
  docker job only builds. Ours runs on every push, includes Playwright and curls the container.
- **Docker**: theirs `oven/bun:1.4-alpine` -> `nginxinc/nginx-unprivileged` on :8080, config in
  `docker/nginx.conf`; ours `nginx:alpine` on :80 with `nginx.conf` at the root.

## Module layout from the tracer bullet (ticket #24)
Acted on from the comparison above: `resolveJsonModule` is on in `tsconfig.base.json` and `tsconfig.core.json`
includes `vendor/parts-export/*.json`; ESLint `globalIgnores` has `.claude`, `vendor` and `**/*.generated.ts`;
`bun run gen:types` (`scripts/gen-types.ts`, json-schema-to-typescript like cabinet-planner) writes
`src/core/import/parts-export.v1.generated.ts`, and CI regenerates it and `git diff --exit-code`s it.
`scripts/` is in tsconfig.node and the ESLint node block. `fflate` is in core's `no-restricted-imports` regex
(zipping is shell-only, per the PRD). New deps: `maxrects-packer` 3.0.0, `fflate` 0.8.2 (runtime),
`json-schema-to-typescript` (dev).

```
src/core/model.ts          domain model types (Model, Sheet, Owner, Part, CncOp, Point). All µm.
src/core/settings.ts       Settings + DEFAULT_SETTINGS, parseSettings/validateSettings/settingsChanges/edgeTrimFor (#26).
src/core/units.ts          mmToken(um): 0.1 mm rounding, `P` decimal (4450 -> "4P5"). Layer names + Sheet codes.
src/core/import/index.ts   importExport(json: unknown) -> { model: Model | null, issues: ImportIssue[] }
src/core/import/parts-export.v1.generated.ts   generated export types (PartsExport, Part, Op, ...)
src/core/import/names.ts   nameParts(owners, parts) -> { parts: {id, partName}[], unknownKeys } + derive table;
                           fullPartName(ownerLabel, partName)   (#25)
src/core/planner/index.ts  plan(model, settings) -> Plan   (+ Plan/SheetPlan/Board/Blank/Placement types)
src/core/dxf/index.ts      toDxfFiles(plan) -> Map<fileName, dxfText>, in Run order
src/shell/App.tsx          bare page: Load export -> issues -> Blanks with SVG -> Download DXFs. Job in memory.
src/shell/BlankLayout.tsx  plain SVG of one Blank (front edge drawn at the bottom), aria-label "Layout of <id>"
src/shell/ImportSummary.tsx  ImportSummary (region "Import summary": counts, unknown keys, warnings, Sheets,
                           Owners, Parts tables) + SkippedWarning (region "Skipped items", persistent)   (#25)
src/shell/PartDetail.tsx   <details> showing part.displayName; opens to the raw `name` + id (.raw-name, grey)  (#25)
src/shell/download.ts      zipFiles(map) (fflate, fixed mtime -> byte-stable zip), downloadBytes, safeFileName
tests/{import,planner,dxf}.test.ts   module tests through the interfaces (node project, fixtures via node:fs)
tests/golden/W18-1-A.side-a.dxf      DXF golden, entities hand-listed (`.gitattributes`: -text, LF)
e2e/tracer.spec.ts         fixture -> Blanks visible -> zip names; reload + reload -> identical zip contents;
                           invalid file -> role=alert with schema paths, no Download button
```

**Import** (`ImportIssue = {kind:'schema', path, message} | {kind:'warning', partId?, message}`):
- ajv `Ajv2020` compiled once at module load from the JSON-imported vendored schema (`date-time` added as a
  regex). Schema failure -> `model: null` + one issue per ajv error. #25 should add issue kinds
  (skipped, unknownKey) to the union rather than overloading `warning`.
- `Part` keeps the raw `name` and `ownerId` (no display names yet: #25). Ops are split by face: `top: CncOp[]`,
  `bottom: CncOp[]` — both in the **cut frame** (finished-frame x/y minus the Edgeband thickness on `x0`/`y0`),
  seen from the top — and `edgeOps` (export ops verbatim). #28 mirrors through `bottom` ops into `top` here.
- v0 warnings: one per Part with `bottom` ops ("ignored, no Flip Parts yet") and one per Part with edge-face
  ops (Manual ops, in no file).
- Sheet code = first alphanumeric of the Sheet name, uppercased, + `mmToken(thickness)` (`W18`, `O16`); a
  clash gets `B`, `C`, ... (`W18B`).

**Plan shape** (the DXF writer and the shell read only this):
`Plan { settings, sheets: SheetPlan[] }`, `SheetPlan { sheetId, code, thickness, boards, sawParts: partId[] }`,
`Board { number, length, width, blanks }`, `Blank { id, letter, x, y (on its Board), length, width, parts }`,
`Placement { n, partId, x, y (footprint front-left on the Blank), rotated, cutLength, cutWidth, ops: CncOp[] }`.
`rotated` = turned 90° CCW seen from the top (Part X along Blank +Y); a Part point (px, py) lands at
`(x + cutWidth - py, y + px)`. Placement `ops` are the Side A (top) ops, unrotated, in the Part's cut frame.
The Plan carries everything the DXF writer needs, so goldens are fed a hand-written Plan.

**Planner v0 internals** (SUPERSEDED by #27, see "Full Breakdown" below; kept for history):
- Per Sheet, a fixed-grid Breakdown (`sawPieces`): rip strips from the front edge as wide as the bed, crosscut
  each from the left as long as the bed, kerf between pieces; pieces <= 2 x clamp are dropped. Only pieces
  that receive Parts become Blanks, lettered A, B, ... in saw order. No Offcuts, no shrinking, no scoring.
- Saw Part = doesn't fit the first (largest) piece minus clamp in any orientation its grain allows. Listed in
  `sawParts` only, not laid out on a Board yet. No narrow-Part rule yet.
- Nesting: one `MaxRectsBin` per piece, size = piece - 2 x clamp, `padding = bitDiameter` (the gap between
  Parts; the bin adds padding to its free area too, so Parts can reach the usable edge), `smart: false`,
  `logic: PACKING_LOGIC.MAX_EDGE` (which is BSSF in `findNode`), per-rect rotation via
  `new Rectangle(w, h, 0, 0, false, grain === 'none')`. Parts fed longest side first, then area, then id.
  Boards are added until every Part is placed.
- `#n` = sort by (y, x) of the footprint's front-left corner.
- Tests: invariants (exactly once, inside the clamp margin, no overlap incl. bit gap, Blanks within bed and
  Board with kerf between) over the synthetic fixture and 5 seeded random models (`randomModel` in
  tests/planner.test.ts — reuse it for #27's property test).

**DXF writer**: R12 text, LF line endings, group codes right-aligned to 3 chars. HEADER (`$ACADVER AC1009`,
`$INSUNITS 4`), TABLES (LTYPE CONTINUOUS; a LAYER table listing every layer used: `REF_V1`, `REF_BLANK`,
`REF_CLAMP`, `OUTLINE_THRU`, then cut layers sorted; REF colour 8, cut colour 7), ENTITIES. Entity order:
REF_BLANK, REF_CLAMP, then per Placement in `#n` order its OUTLINE_THRU and its ops in export order.
Coordinates are exact (µm / 1000, up to 4 decimals, trailing zeros stripped); only layer-name numbers round to
0.1 mm. Grooves are assumed axis-aligned and clipped to the cut outline; pocket `cornerRadius` is ignored.
Side B (#28): add a `sideB(...)` beside `sideA` and reuse `writeDxf` / `Entity`.

## Machine settings and the Job snapshot (ticket #26)
```
src/core/settings.ts       Settings (all µm): bedLength/bedWidth 1300, clampMargin 40, bitDiameter 6, sawKerf 3.2,
                           edgeTrim 0, edgeTrimBySheet {sheetId: µm} (overrides edgeTrim; Sheet ids are library ids,
                           so overrides are global), minCncWidth 50, minOffcutSize 150, manualBottomOpKinds
                           OpKind[] (sorted in OP_KINDS order: drill, groove, pocket), fenceHeightNote ''.
                           parseSettings(unknown) -> Settings: per-field fallback to defaults (use for any stored copy).
                           validateSettings(s) -> {field, message}[] (bed > 0, bit > 0, 2 x clamp < shorter bed side).
                           settingsChanges(a, b) -> changed keys (order-insensitive for the record).
                           edgeTrimFor(s, sheetId).
src/core/job.ts            Job { model, settings (snapshot), sheetCodes (overrides by Sheet id), plan }.
                           generateJob(model, settings, sheetCodes?) copies the settings; regenerate(job, current);
                           snapshotChanges(job, current); sheetCode(job, sheetId) (override else derived);
                           setSheetCode(job, sheetId, input) -> {job} | {error}: trimmed + uppercased, [A-Z0-9]{1,12},
                           unique in the Job; '' or the derived code removes the override. Re-plans with the Job's own
                           snapshot, NOT the global settings. model.sheets[].code stays the derived code (#38 relies on
                           that to re-derive); overrides are applied to a model copy just before plan().
src/shell/settings-store.ts  loadSettings()/saveSettings() in localStorage key `cut-optimizer.machine-settings`
                           (try/catch; falls back to defaults).
src/shell/SettingsScreen.tsx Draft form, lengths in mm (`<label> (mm)`), per-Sheet edge trim for the open Job's Sheets
                           (+ any stored overrides), op-kind checkboxes, fence note; Save validates (role=alert), then
                           role=status "Settings saved.".
src/shell/setting-labels.ts  SETTING_LABELS (UI names per key; react-refresh forbids exporting it from a component file).
src/shell/App.tsx          nav buttons "Job" / "Machine settings" (settings view is an early return). App's LoadedJob
                           = core Job + fileName. Stale snapshot -> role=status listing changed settings + "Regenerate".
                           "Sheet code for <Sheet name>" input per Sheet, commits on Enter/blur; errors role=alert.
e2e/settings.spec.ts       defaults + persistence, invalid clamp not saved, snapshot until Regenerate, Sheet code edit.
```
- Planner v0 now trims `edgeTrimFor(settings, sheet.id)` off all four Board edges before the fixed grid (#27 owns
  the real Breakdown; keep using `edgeTrimFor`). Min CNC width, Min Offcut size, manual bottom op kinds and the fence
  note are stored only: #27/#28/#31 read them from `plan.settings` / the Job snapshot.
- #29 (Job store): persist `Job` as is (`settings` snapshot + `sheetCodes`); run stored settings through parseSettings.
- e2e port clash: parallel worktrees share :4173 and `reuseExistingServer` grabs another worktree's preview (or it
  dies mid-run -> ERR_CONNECTION_REFUSED). Since #27, `playwright.config.ts` reads `E2E_PORT` (default 4173):
  `E2E_PORT=4174 bun run e2e`.

## Part names and the import summary (ticket #25)
- **Model**: `Owner` gained `cabinetName?` (Library Cabinet name, Cabinets only) and `itemKind?` (Generated Items
  only). `Part` gained `partName` (`""` when dropped) and `displayName` (`<Owner label> · <Part name>`, or the Owner
  label alone). **Everything that shows a Part to people should use `part.displayName`** (labels, PDF, scan
  feedback); never show `part.name` except in the Part detail panel. Owner roll-ups: `owner.label` (+ `cabinetName`
  where there's room). Test helpers that build `Part`s by hand must set both fields (see `randomModel`).
- **ImportIssue** union now: `schema | warning | skipped {ownerKind, id, label, name, reason, problems} |
  unknownKey {key, partIds}`. Skipped issues come in `skipped` order after unknown keys and part warnings.
  The PDF cover (#35/#38) can repeat the `skipped` issues; re-import (#29+) recomputes them from the new file.
- **Naming rules** (`src/core/import/names.ts`, tests in `tests/names.test.ts`): source = optional export Part
  `label` (not in v1.0; read defensively) > derive table on the path key > key with spaces added (camelCase,
  `-`, `_`, `.` split). Path grammar: `<key>[i,j,...]`; key = Author name (no dots) or `<section>.<role>` with
  section `s0(.n)*` or `<interior>.s0(.n)*`. Derive table covers cabinet-planner's Section compiler roles
  (`door.leaf`, `drawer.face`, `drawer.side`, `pullout.tray.*`, `shelf.wing`, `divider`, ...), common carcass Author
  names and the Generated Item kinds. Numbering: 1-based **ordinal in export order** among the Owner's Parts with the
  same full name (not the raw copy index, so nested `[0,1]` indices and `when`-skipped copies number cleanly).
  Section prefix only when the Owner has generated Parts in >1 distinct Section path; root `s0` Parts get no prefix,
  `s0.1.0` -> "Section 2.1", `b.s0.1` -> "b · Section 2". A Generated Item Part whose `name` equals the item kind
  (and has no label) gets `partName = ""`.
- **Shell flow**: Load -> `loaded: LoadedExport {fileName, model}` state shows the import summary + "Plan" button
  (nothing planned) -> Plan calls #26's `generateJob(model, settings)` into `job` -> Plan view (Blank
  Layouts, Part list with `PartDetail`, SVG `<title>` = `#n <displayName>`, Saw Parts by name). The Skipped-items
  warning shows in both. `BlankLayout` takes a `nameOf(partId)` prop. e2e: `loadAndPlan(page)` helper in
  `e2e/tracer.spec.ts` and `e2e/settings.spec.ts` (every spec that needs Blanks must click Plan).
- Fixture: `fixtures/synthetic.parts.json` has one Skipped Cabinet (`c2` "T2", `invalid`, `check.minWidth`), and
  `s0.rail[1]` is deliberately an unknown key (`rail` is not a cabinet-planner role).

## Job store, Job list and .job.json (ticket #29)
New deps: `dexie` ^4.4.7 (runtime, shell only; already in core's `no-restricted-imports`), `fake-indexeddb` ^6.2.8 (dev;
tests `import 'fake-indexeddb/auto'` at the top of the file — no global setup file).
```
src/core/job-store/document.ts  JobDocument (jobFormat 1): id (UUID), shortId, name, archived, createdAt, updatedAt
                           (ISO), fileName, rawExport (export TEXT, verbatim), settings, sheetCodes, plan (Plan | null),
                           sawCncOverrides {partId: 'saw'|'cnc'} (stored only; #27 wires it into the Job/Planner).
                           The model is NOT stored: openJobDocument(doc) -> {model, issues, job: Job | null} | {error}
                           re-imports rawExport and uses the stored plan as is (job null while plan is null = the import
                           summary stage of #25). createJobDocument({id, shortId, rawExport, fileName, model, settings, now})
                           -> unplanned doc (plan null, name "<Project> YYYY-MM-DD"); withJob(doc, job, now) stores a
                           planned/re-planned/Sheet-code-edited Job (settings, sheetCodes, plan); renameJob, setArchived, shortIdFor(uuid, taken)
                           (first 4+ hex digits of the UUID, uppercased, grown until unique), jobFileName(doc).
                           toJobFile(doc) -> text; fromJobFile(text, migrations?) / readJobDocument(value, migrations?)
                           -> {doc} | {error}: newer jobFormat refused, older run through MIGRATIONS[n] (n -> n+1; empty
                           now), then field checks (settings via parseSettings; plan only checked to be {sheets: []} or
                           null, so Plan additions survive; unknown top-level fields are kept).
src/core/job-store/store.ts  JobStore {list(): JobSummary[] (newest updatedAt first, archived included), get(id), put(doc),
                           delete(id)}; get() reads through readJobDocument and throws if unreadable.
                           createMemoryJobStore() (keeps JSON text). summarize/sortSummaries/storedDocument for adapters.
src/shell/job-store-dexie.ts createDexieJobStore(name = 'cut-optimizer'): Dexie table `jobs` (out-of-line key = doc.id).
src/shell/JobList.tsx      region "Jobs": table (name, short id, changed), buttons "Open <name>", "Archive/Unarchive
                           <name>", "Delete <name>" -> "Yes, delete <name>"; "Show archived Jobs" checkbox; "No Jobs yet".
src/shell/App.tsx          OpenJob = {doc, model, job: Job | null}. Every change goes through save(doc, model, job): state +
                           store.put + list refresh. "Load export" creates and saves an unplanned Job (import summary +
                           "Plan" button); "Plan" stores the Plan; "Open Job" reads a .job.json (same UUID replaces the stored copy;
                           a clashing short id is regrown); "Download Job" -> safeFileName(<name>.job.json); "Job name"
                           input (Enter/blur). Last open Job id in localStorage `cut-optimizer.open-job`, reopened on load.
tests/job-document.test.ts serialization, migration, version refusal, openJobDocument.
tests/job-store.test.ts    one contract suite run against both adapters (describe.each).
e2e/jobs.spec.ts           create + reload restores; rename/archive/delete; Download Job -> Open Job in a new context;
                           jobFormat 2 refused (role=alert).
```
- Later slices (progress, Offcuts, Spares, alias table, re-import log) add fields to JobDocument + checkFields in
  document.ts; keep them optional-with-default in checkFields so jobFormat 1 files still open. Bump JOB_FORMAT and add
  a MIGRATIONS entry only for breaking changes.

## Full Breakdown, Saw Parts and Run order (ticket #27)
```
src/core/planner/index.ts  plan(model, settings, prior: PlanPrior = {}) -> Plan.  PlanPrior { sawCnc?: {partId: 'saw'|'cnc'} }
                           (later: locks, Remakes, Discarded Offcuts go in PlanPrior too).
                           partRule(model, settings, partId) -> {auto, oversize, narrow, hasCncOps} | null.
src/core/job.ts            Job gained `sawCnc: Record<partId, PartMode>` (only choices that differ from partRule().auto).
                           generateJob(model, settings, sheetCodes?, sawCnc?); regenerate/setSheetCode carry it.
                           setPartMode(job, partId, 'saw'|'cnc') -> {job} | {error} (error for oversize Parts).
                           Stored as JobDocument.sawCncOverrides (#29): openJobDocument -> job.sawCnc, withJob writes
                           it back; App onPlan passes doc.sheetCodes + doc.sawCncOverrides to generateJob.
                           A stored Plan from before #27 lacks Board.cuts/offcuts/sawParts: Regenerate it.
src/shell/BoardBreakdown.tsx  SVG "Breakdown of <code> Board <n>" (Blanks, Saw Parts, Offcuts kept=Keep / waste hatched,
                           cut lines with text.cut-label; pieces text.piece-label) + table "Cuts of <code> Board <n>".
src/shell/App.tsx          per Sheet: Breakdown, Layouts, PartList (table "Parts of <code>": where, narrow warning,
                           "Saw" checkbox, disabled for oversize). Toggle errors reuse the codeError alert.
src/shell/BlankLayout.tsx  narrow Placements: <g class="narrow">, dashed --warn outline, "#n !", title "(narrow: check tabs)".
e2e/breakdown.spec.ts      cut labels table == SVG labels; rail is a Saw Part, untick Saw -> nested + warning.
```
**Plan shape additions** (all required fields; hand-written Plans in tests must set them):
- `SheetPlan.sawReasons {partId: 'oversize'|'narrow'|'chosen'}`, `SheetPlan.unplaced: partId[]` (Saw Parts bigger
  than the trimmed Board: on no Board). `sawParts: partId[]` stays (all Saw Parts, export order).
- `Board.sawParts: SawPlacement[] {partId, x, y, length, width (footprint on the Board), rotated, reason}`,
  `Board.offcuts: Offcut[] {x, y, length, width, kept}` (kept = both sides >= minOffcutSize; no K-ids yet: Offcuts
  ticket), `Board.cuts: Cut[] {label, kind: 'rip'|'cross', x, y, length}` in saw order. Rip: line along X from (x,y),
  kerf above y. Crosscut: line along Y from (x,y), kerf right of x. Edge-trim cuts are not listed.
- `Placement.narrow` (shorter cut side < minCncWidth and on the CNC: "narrow: check tabs" in the PDF row, #31/#35).
- `plan.sheets` is in Run order: grouped by thickness (first appearance), export order inside a group.

**Rules**: oversize (doesn't fit min(bed, trimmed Board) - 2 x clamp in an allowed orientation) -> always saw.
Else Job toggle wins. Else narrow + no CNC ops -> saw. "CNC ops" = `top` ops or `bottom` ops whose kind is not in
`manualBottomOpKinds` (edge-face ops don't count). #28: if mirrored through-holes move into `top`, nothing changes here.

**Algorithm** (internals; tests only go through plan/partRule/setPartMode):
- Two-stage guillotine per Board inside the edge trim: strips ripped from the front edge, each crosscut from the left.
  A strip's pieces span its full width. Saw Parts sit only in a strip exactly as wide as their footprint (both
  orientations if grain none), placed first in the strip, longest first; Blanks fill the rest of the strip if it is
  <= bed width. Blanks are nested at min(lengthCap, bed, rest) x strip width, then shrunk to used extent + clamp;
  a strip without Saw Parts shrinks to its widest Blank.
- Per strip, greedy: try the Blank strip (width = min(widthCap, rest)) and one strip per distinct Saw Part width;
  keep most Part area, then fewer Blanks, then narrower.
- Per Board: caps = bed-limited size + up to 3 largest Part-derived sizes (footprint + 2 x clamp) for width and for
  length (<= 16 runs); score most Part area, fewest Blanks, largest Offcut area; ties -> earlier (larger) caps.
  Boards are added until all placed. ~80 ms for 100 Parts, ~400 ms for 300 on one Sheet.
- Offcuts: the rest of each strip right of its last piece, and the rest of the Board behind the last strip.
- Labels: rip `i` after strip i (unless it reaches the trimmed edge); crosscut `i` + a, b… after each piece that
  doesn't reach the trimmed end. Blank letters A, B… in the same saw order (Saw Parts and Offcuts don't take letters).
- `#n`: sort by (y, x) of the footprint's front-left corner.
- Tests: `tests/planner.test.ts` `expectInvariants` (exactly once incl. board saw placements + unplaced, Saw Part sizes,
  every saw piece and Offcut inside the trimmed Board with kerf between, Parts inside the clamp margin, bit gap,
  narrow flag) + `expectRunOrder` (thickness groups, Board numbers, letters in saw order, #n by position) over the
  synthetic fixture and 10 seeded `randomModel`s. Add the real fixture (#23) to both when it lands.

## Flip Parts, Side B files and Manual ops (ticket #28)
```
src/core/model.ts          Part.edgeOps is GONE -> Part.manualOps: ManualOp[] {reason: 'edge'|'manualKind'|'notDrawable',
                           face, text}. Part.bottom now holds only BLIND bottom ops (cut frame, seen from the top).
                           Test helpers that build Parts must set `manualOps: []`.
src/core/manual-ops.ts     describeExportOp(op) (finished frame, edge ops), describeCncOp(op, face) (cut frame),
                           mitreOp(end, angle, longFace). Text like "Drill Ø8 × 30 deep on x0 at y 260, z 9" (mm, <=2 dp).
src/core/import/index.ts   through bottom DRILLS -> `top` unchanged (same x,y in the Part frame); edge-face ops, mitred
                           `ends` and diagonal grooves -> manualOps. One warning per Part with Manual ops
                           ("1 Manual op, not in any file: done by hand"). The old "bottom ops ignored" warning is gone.
src/core/planner/side-b.ts internal to the Planner (re-exported from planner/index.ts): sideB(model, settings, partRunOrder)
                           -> {files, manualOps}; sideBPoint(file, p); types SideBFile, Edge, QuarterTurns, JobManualOp.
src/core/dxf/index.ts      toDxfFiles(plan, job): `job` (the Job's SHORT ID in the shell) names Side B files;
                           sideBFileName(job, file) -> `<job>-B<n>.side-b.dxf`. Side B files come after all Side A files.
src/shell/SideBView.tsx    SideBView (region "Side B": per file a figure with button "Download B<n>", svg "Side B view of
                           B<n>" with path.fence-corner, "<edge> against long fence · <edge> against short fence", Parts list
                           "<displayName> (<where>)") + ManualOpsList (region "Manual ops", .warning-box, table Part | Op).
src/shell/BlankLayout.tsx  new required prop sideBOf(partId) -> file id | undefined; Flip Parts get <g class="flip">,
                           fill var(--flip-bg), title suffix " (Flip Part: Side B B1)".
src/shell/App.tsx          partLocations(sheets) -> Map partId -> "W18-1-A #1" | "Saw · W18 Board 1" (Job-wide).
e2e/side-b.spec.ts         shading, Side B view + single download, Manual ops list. tracer/settings specs: the zip now
                           also holds `<shortId>-B1.side-b.dxf` (short id differs per load, so the reload check renames it).
tests/side-b.test.ts       Flip Part / manual kind / orientation / grouping / numbering, all through plan().
tests/golden/J7-B1.side-b.dxf  hand-listed Side B golden (fed a hand-written SideBFile in tests/dxf.test.ts).
```
**Plan additions** (required; hand-written Plans must set them): `Plan.sideB: SideBFile[]`, `Plan.manualOps: JobManualOp[]`
(`{partId, reason, face, text}`: Import's Manual ops + `bottom` ops whose kind is in `manualBottomOpKinds`, by Part in Run
order). Stored Plans from before #28 lack both (same stale-Plan problem as #27: Regenerate; the shell would crash).
`SideBFile {id 'B1', turns 0-3, longFence, shortFence (Edge), cutLength, cutWidth, length/width (footprint in the file:
along X / along Y), ops (blind CNC bottom ops in the Part's cut frame), partIds (Run order)}`.

**Side B frame**: bottom view, origin = Fence corner, long fence along file X (y = 0), short fence along file Y (x = 0).
sideBPoint: flip about the Part's X (`y ← W − y`), then `turns` quarter turns CCW, pushed into the corner:
turns 0 `(x, W−y)` yW long / x0 short; 1 `(y, x)` x0 long / y0 short; 2 `(L−x, y)` y0 long / xL short;
3 `(W−y, L−x)` xL long / yW short. Orientation = least sum over ops of (x + y) of the op centre in the file; tried in order
0, 2, 1, 3 and only a strictly better one wins (ties keep the Part's length along the long fence).
**Grouping**: exact key = cut size + turns + sorted op JSON; never turned/mirrored to match (mirrored doors -> 2 files).
Numbered by first Part in Part Run order = per Sheet (Run order), per Board: Blank Parts (letter, #n), then the Board's
Saw Parts; `unplaced` last. Saw Parts with blind bottom ops ARE Flip Parts too (no bed-size check for Side B).
**Side B DXF**: layers REF_V1, REF_PART, then cut layers sorted; entities REF_PART outline then ops in file order.
No OUTLINE_THRU, no top ops. Groove clipping/transform shared with Side A via a PartFrame {cutLength, cutWidth, to(p)}.
Manual-kind ops are decided in the Planner (Import has no settings), so the PDF/label (#35/#38) read `plan.manualOps`,
and `plan.sideB` for "SIDE B <file>" pills / Side B pages (`sideBFileName(shortId, file)` for the name).

## Progress: Steps, ticks, bulk ticks and roll-ups (ticket #34)
```
src/core/model.ts          Part gained `edges: PartEdges` ({x0?, xL?, y0?, yW?} -> Edgeband id, copied from the export;
                           `{}` = unbanded). REQUIRED: hand-built Parts in tests must set `edges: {}`.
src/core/progress.ts       Step = 'cut'|'sideB'|'banded'|'manualOps'; STEPS (that order). JobView = Pick<Job,'model'|'plan'>.
                           Progress = {partId: {step: ISO time}} (no entry = no ticks).
                           steps(job, partId): Cut always; Side B if in a plan.sideB file; Banded if any edge has an
                           Edgeband; Manual ops if in plan.manualOps (so manual-kind bottom ops count). [] for unknown ids.
                           apply(job, progress, event) -> Progress (same object when nothing changes). Events: tick
                           {partId, step, at}, untick {partId, step}, sideADone {blankId, at} (Cut on the Blank's Parts),
                           breakdownDone {boardId, at} (Cut on the Board's Saw Parts), sideBDone {fileId, at}. Ticking keeps
                           the first time; non-applicable Steps / unknown ids are ignored.
                           isDone(job, progress, partId). boardId(sheet, board) = `<code>-<n>` (`W18-1`, Blank-id prefix).
                           rollup(job, progress) -> {blanks [{id, cut, done, total, locked}], boards [{id, sheetId, cut,
                           total, locked}] (Blank Parts + Saw Parts), sheets [{sheetId, code, cut, total}] (incl. unplaced),
                           owners [{ownerId, kind, label, done, total, readyToAssemble}] (Cabinets then Generated Items,
                           Owners without Parts left out; ready only for Cabinets), job {cut, done, total}}. All Run order.
                           locked = at least one Part ticked Cut (glossary "Locked"); nothing enforces it yet.
                           wouldUnlock(job, progress, partId, step) -> [Blank id?, Board id?] that untick would unlock.
src/core/job-store/document.ts  JobDocument.progress: Progress ({} when missing: files from before #34 still open; bad
                           shape or unknown Step key -> error). withProgress(doc, progress, now). withJob keeps progress.
src/shell/ProgressPanel.tsx region "Progress": p.job-progress "Job: d / t Done · c / t Cut", table "Owner progress"
                           (label · cabinetName, d / t, "ready to assemble"), table "Cut progress" (Sheet, "Board W18-1",
                           "Blank W18-1-A" rows with Cut, Done, "Locked").
src/shell/step-labels.ts   STEP_LABELS (Cut, Side B, Banded, Manual ops).
src/shell/App.tsx          onProgress(event) -> apply + withProgress + save. PartList ("Parts of <code>") has a checkbox per
                           applicable Step, aria-label "<Step>: <displayName>" (title = tick time), "—" otherwise, and a
                           Done column. Buttons "Side A done <blankId>" (Layout figcaption), "Breakdown done <code> Board
                           <n>" (under a Breakdown with Saw Parts). Unticking Cut that would unlock -> role=alertdialog
                           "Confirm untick" with "Untick" / "Keep ticked" (the box stays ticked meanwhile).
src/shell/SideBView.tsx    new required props onDone(file), doneOf(file): button "Side B done B<n>" + tally.
tests/progress.test.ts     Steps, ticks, Done, untick, bulk events, roll-ups and wouldUnlock over the synthetic fixture.
e2e/progress.spec.ts       Step boxes + reload, bulk buttons -> roll-ups, untick confirmation.
```
- Scan mode (#36?) should call `apply(job, doc.progress, {kind:'tick', ...})`; check `steps()` first to warn "no such
  Step", and `progress[partId]?.[step]` for "already ticked"; Owner progress text from `rollup(...).owners`.
- Remake / Locking slices: read `rollup().boards/blanks[].locked` (or the same rule) for Locked; Remake clears
  `progress[partId]` (build a new object without the key: eslint forbids dynamic `delete`).
- Roll-ups are never stored: the PDF/labels can call `rollup` too.

## Documents: page model, renderers, cut sheet cover + saw pages (ticket #30)
New deps: `pdf-lib` 1.17.1 (runtime, shell only; already in core's `no-restricted-imports`). `bun run gen:fonts`
(`scripts/gen-font-metrics.ts`) writes `src/core/documents/helvetica.generated.ts` (WinAnsi chars + Helvetica /
Helvetica-Bold widths from `@pdf-lib/standard-fonts`, pdf-lib's own dep) so core can measure text like pdf-lib draws it.
```
src/core/model.ts          Model gained `edgebands: Edgeband[] {id, name, thickness, width}` (export order); `PartEdge` =
                           keyof PartEdges (#34 added Part.edges). Hand-built Models in tests must set `edgebands: []`.
src/core/documents/page.ts PAGE MODEL. Page {width, height, items} in mm, origin top-left, y down. A4 = 210 × 297.
                           Items: box {x,y,width,height,fill?,stroke?,lineWidth?,dash?}, text {x, y = baseline, text,
                           size (mm em), bold?, align start|middle|end, colour?, vertical? (90° CCW)}, line, polygon
                           {points [x,y][]}, hatch {rect, spacing, lineWidth, colour} (45° lines), qr {x,y,size,
                           modules: boolean[][]} (encoder NOT included: #32 supplies the matrix). Colours '#rrggbb'.
                           hatchLines(h) / qrSquares(q): shared geometry so both renderers draw identically.
src/core/documents/text.ts printable(s) (non-WinAnsi -> '?'), textWidth(s, size, bold), fitText (…), wrapText.
src/core/documents/layout.ts Flow (top-to-bottom writer over pages; `new Flow(start(page, continued) => contentTopY)`,
                           ensure(h) breaks the page, heading(), paragraph()), table(flow, x, columns, rows) (header
                           repeated on continuation pages; cells: string | {text,bold?,colour?} | {tick:true}),
                           text(...) (always printable), tickBox, fitSize. MARGIN 12, BOTTOM 283, FONT sizes, GREY/RULE.
src/core/documents/svg.ts  pageToSvg(page) -> one <svg> string (viewBox 0 0 210 297, width 210mm), text escaped.
src/core/documents/saw.ts  sawCuts(plan, sheetPlan, board, nameOf) -> SawCutRow {label, kind, fence µm, from, gives}.
                           Fence = distance from the last cut edge (or the trimmed front edge / left end) to the near
                           side of the blade: rip = cut.y − (prev rip y + kerf | trim); cross = cut.x − (prev cross x
                           + kerf | trim), crosscut state resets per strip (label's leading number).
src/core/documents/cut-sheet.ts cutSheet(plan, {name, shortId, generatedAt (string, shown verbatim), model, skipped
                           [{label,name,reason}]}) -> Page[]: cover (may flow onto "(continued)" pages; the Saw page
                           range in "Order of work" accounts for that), then per Board in Run order a saw page
                           (header via workHeader(page, job, title, sub) — reuse it for #31's pages), drawing + cut table
                           (continues on extra pages). Footer "<name> · Job <short>" / "Page i of N" added last.
src/core/dxf/index.ts      layerUsage(plan, thicknessOf) -> LayerUse {layer, thickness, count, kind, diameter?} over
                           Side A + Side B entities (REF_* excluded); referenceLayers(plan). Same entity code as the files.
src/shell/pdf.ts           pagesToPdf(pages, {title}) -> Promise<Uint8Array> (pdf-lib, StandardFonts Helvetica/Bold,
                           1 mm = 72/25.4 pt, y flipped). Loaded with dynamic import() so pdf-lib is its own chunk.
src/shell/CutSheetPanel.tsx region "Cut sheet": button "Cut sheet" (aria-expanded) toggles the SVG preview, each page a
                           role=img "Cut sheet page i of N"; "Download PDF" -> `<safe job name>.cut-sheet.pdf`.
                           generatedAt = local "YYYY-MM-DD HH:MM" at preview/download time. App passes doc name/shortId,
                           job.model and the `skipped` import issues.
tests/cut-sheet-plan.ts    hand-written Model + Plan (W18 Board with trim 5, Blank A, Saw Part, Blank B, waste + kept
                           Offcuts; O16 Board; one Side B file, one Manual op, one Edgeband). Reuse for #31.
tests/cut-sheet.test.ts    sawCuts fence tests (hand Plan + replay over the planned fixture), page goldens
                           tests/golden/cut-sheet-{cover,saw-W18-1}.txt (one line per item; `toMatchFileSnapshot`,
                           update with `vitest run -u` and REVIEW the diff), SVG/PDF page-count smoke.
tests/page-render.test.ts  every item kind through both renderers; unencodable text doesn't throw.
e2e/cut-sheet.spec.ts      preview pages + PDF download (%PDF-).
```
- Cover content: counts, numbered order of work (Side B / banding / Manual ops steps only when present), "Before you
  start" box (Saw Parts by name, unplaced Saw Parts, Manual ops count, Skipped items), Materials per Sheet, Machine
  settings snapshot + "Outlines need tabs or onion skin in CAM", Edgebanding (edges + cut-length total × 1.1, in m; edge
  length = cutWidth for x0/xL, cutLength for y0/yW), layer legend (layer × stock thickness rows, toolpath by kind and
  diameter vs bit) + reference layers line.
- Saw drawing: whole Board hatched first, pieces/kept Offcuts drawn white on top, so trim and waste show hatched; waste
  Offcuts get a size label (vertical when too narrow). Rip labels left of the Board (staggered when close), crosscut
  labels near the strip's far edge. Text is drawn only with WinAnsi chars: avoid →, ▲, ✓ in literals (use polygons/boxes).

## Scan mode, wedge and webcam (ticket #35)
New dep: `jsqr` ^1.4.0 (runtime, shell only; loaded by dynamic import only when the webcam has no `BarcodeDetector`).
```
src/core/progress.ts       IdAliases = {oldPartId: newPartId}; resolveAlias(aliases, id) follows chains (cycle-safe).
                           ScanJob {shortId, aliases}; scanPayload(shortId, partId) -> "<short id>:<Part id>" (labels #31/#32
                           should build the QR text with this). scan(job, scanJob, progress, {payload, step, at}) -> ScanOutcome:
                           {kind:'rejected', reason:'unreadable'|'otherJob'|'unknownPart', payload} |
                           {kind:'notTicked', reason:'noSuchStep'|'alreadyTicked', partId, step} |
                           {kind:'ticked', partId, step, progress, openEarlier: Step[]} (earlier applicable Steps still open = warn).
                           Payload trimmed, split on the FIRST ':', short id compared case-insensitively.
src/core/job-store/document.ts  JobDocument.idAliases: IdAliases ({} when missing; must map text to text). #38 (re-import)
                           adds old -> new entries here and never removes them; scans resolve through it already.
src/shell/scan/source.ts   ScanSource { start(onScan(text), onError(message)) -> stop }.
src/shell/scan/wedge.ts    wedgeSource(target = window, {maxGapMs 50, minLength 6}): keydown (capture) burst of 1-char keys
                           each <= maxGapMs apart + Enter within maxGapMs -> one scan (Enter preventDefault'ed). Non-character
                           keys (Shift) skipped; Ctrl/Alt/Meta reset. No DOM types: tests/wedge.test.ts drives a fake target.
src/shell/scan/webcam.ts   webcamSource(video): getUserMedia (environment camera), BarcodeDetector('qr_code') else jsQR on a
                           canvas, every 150 ms; the same text repeats only after 2 s away. Not unit tested (needs a camera).
src/shell/scan/beep.ts     beep('ok'|'warn'|'error') via Web Audio.
src/shell/ScanMode.tsx     region "Scan mode": h2 "Scanning: <Step>", radio per Step (legend "Step each scan ticks"),
                           "Use webcam"/"Stop webcam" toggle; role=status "Scan feedback" (.ok/.warn/.error) with
                           .scan-headline ("Banded ticked", "<Step> was already ticked: nothing ticked", "No <Step> step on this
                           Part: nothing ticked", "Not this Job: ..."), .scan-part (displayName), .scan-where (partLocations),
                           .scan-owner ("T1: 0 / 4 Done" from rollup().owners), .scan-warning ("Still open before Banded: Cut").
src/shell/App.tsx          nav button "Scan mode" (view 'scan', early return like settings); ticks saved via withProgress.
e2e/scan.spec.ts           page.keyboard.type (no delay) + Enter = wedge scan; delay 120 = typing, ignored; other Job rejected.
```

## Locked Boards and Blanks survive regenerate (ticket #36)
```
src/core/planner/index.ts  PlanPrior gained `plan?: Plan` (the stored Plan) and `cut?: readonly string[]` (Part ids ticked
                           Cut). A Board of prior.plan with any of them (Blank Part or Saw Part) is Locked and kept VERBATIM
                           (deep equal: geometry, number, Blank ids/#n, offcuts, cuts, Saw Parts + reasons), with every Part on
                           it -- so a Locked Blank's Board is always kept whole, including its unlocked Blanks. Only Parts not on
                           a Locked Board are planned, onto new Boards numbered max(Locked number) + 1, + 2… (an unlocked
                           Board 1 before a Locked Board 2 loses its number). SheetPlan.sawParts/sawReasons include the
                           Locked Saw Parts (export order). Saw/CNC toggles don't move Locked Parts. Sheets are matched by id.
                           Blank gained OPTIONAL `clampMargin` (the Planner always sets it; hand-written Plans may omit it).
src/core/dxf/index.ts      Side A uses `blank.clampMargin ?? plan.settings.clampMargin` (a Locked Blank's DXF stays byte-equal
                           after a clamp change). Shell BlankLayout gets the same. #30/#31 page model: use the same fallback.
src/core/job.ts            regenerate(job, settings, progress = {}), setPartMode(job, partId, mode, progress = {}),
                           setSheetCode(job, sheetId, input, progress = {}) all re-plan with {plan: job.plan, cut} so
                           Locked Boards survive. generateJob stays a fresh plan (no prior). setPartMode refuses a Part on a
                           Locked Board ("This Part is on Locked Board W18-1, …"); setSheetCode refuses a Sheet with Locked
                           Boards ("W18 has Locked Boards, …") since Locked Blank ids carry the code. lockedBoards(job,
                           progress) -> {id, sheetId, board}[]. job.ts now imports progress.ts (boardId) at runtime;
                           progress.ts only imports job.ts types.
src/core/progress.ts       reprintSelection(job, progress) -> {boards (unlocked Board ids), blanks (unlocked Blank ids),
                           parts (not on a Locked Board and not Done, Run order, incl. unplaced), sideB (files holding any of
                           those parts)}: for the PDF (#30/#31) and labels (#32) "reprint after regenerate" option.
src/shell/App.tsx          passes open.doc.progress to regenerate/setSheetCode/setPartMode. Layout figcaption shows
                           span.locked " · Locked". The stale-settings box adds a note when anything is Locked.
e2e/locking.spec.ts        tick Cut -> change clamp -> Regenerate: W18-1-A DXF identical, O16-1-A changed; toggle/code refused;
                           untick (confirm) unlocks.
```
- Locks are derived from progress, never stored. "Unlock after confirmation" is #34's alertdialog (wouldUnlock).
- Regenerate is still offered only from the stale-settings box (the only explicit re-plan besides toggles/Sheet codes).
- #37 (Offcuts/Remake): Remake clears Cut ticks, which may unlock; to keep the old Blank Locked, pass the Remake Part ids in
  PlanPrior too and treat them as locking-but-needing-nesting. "Continue the Board's letters" on Offcuts of Locked Boards
  = new Blanks appended to a kept Board (its deep-equality then no longer holds by design).
- #38 (Re-import): kept Locked Boards may hold Part ids no longer in the model, and a Sheet code re-derive would not rename
  Locked Blank ids (SheetPlan.code would then differ from Locked Blank id prefixes).

## Re-import: match, diff and apply (ticket #38)
```
src/core/reimport.ts       diff(job: {model, plan|null}, newModel, {unpaired?: {oldId,newId}[]}) -> Diff:
                           hint {currentProject, newProject, sameProject, idMatchShare (exact ids / max Part count),
                           lowOverlap (< 0.5)}, olderExport (+ currentExportedAt/newExportedAt), changedSheets (ids),
                           entries: DiffEntry[] {category, oldId?, newId?, paired, displayName, oldDisplayName?,
                           ownerLabel, where? ("W18-1-A #2" | "Saw · W18-1", from the CURRENT Plan), changes: Change[]}
                           grouped in CATEGORIES order (changedCut, changedFinishing, added, removed, renamed, same),
                           counts / owners (Owner labels) per Category, renames {old -> new id}.
                           Change = id|name|owner|sheet|sheetDefinition|size|grain|cncOps|edgebands|manualOps — #39 reads
                           `changes` to clear only the affected Step (edgebands -> Banded, manualOps -> Manual ops).
                           needsNesting(diff) = Added + Changed (cut) new ids. extendAliases(aliases, renames).
                           applyReimport(doc, currentModel, {rawExport, fileName, model}, diff, now) -> JobDocument;
                           revertReimport(doc) -> doc.previous (JobDocument | null).
src/core/import/index.ts   Model.exportedAt? (optional so hand-built test models compile). freeSheetCode(name, thickness, used).
src/core/job-store/document.ts  new fields: reimportLog [{at, exportedAt?, fileName, counts}], stale {needsNesting: id[]} | null,
                           previous: JobDocument | null (one level: stored with its own previous = null). withJob() clears
                           stale + previous (any re-plan ends "Revert last re-import"). Aliases go in #35's `idAliases`
                           (flattened: every old id maps straight to the live id; progress.ts resolveAlias still follows chains).
src/shell/ReimportDiff.tsx ReimportDiff (region "Re-import": hint, role=status warnings, list "Re-import counts", per
                           non-empty category a region + table "<Category> Parts", buttons "Unpair <displayName>", "Apply
                           re-import", "Cancel re-import") + ReimportLog (table "Re-import log").
src/shell/App.tsx          "Re-import export…" file input on the open Job; PendingReimport state (diff recomputed on render with
                           the unpaired list); apply/revert go through reopen(doc) (openJobDocument -> new model + issues, so the
                           Skipped warning is recomputed). Stale -> role=status "Export updated" ("Export updated, n Parts need
                           nesting" + names + Regenerate); PartList "Where" says "needs nesting" for those ids.
tests/reimport.test.ts     categories, pairing, unpairing, Sheet change, apply, alias chains, Sheet codes, revert, .job.json.
e2e/reimport.spec.ts       diff -> apply -> ticks follow -> reload -> revert; older-file warning, unpair, Regenerate.
```
**Matching**: exact id, then pair leftover old/new Parts with equal key = Sheet id, thickness, cut size, grain, top/bottom
ops, Manual op texts, Edgebands, Owner kind (+ Generated Item kind) and the raw `name` with copy indices stripped
(`s0.shelf[2]` ~ `s0.shelf[3]`, so repeat-count renames pair). Same cut size + same Edgebands = same finished size. Old
candidates in current-Plan Run order (then export order), new ones in export order. An unpaired pair excludes BOTH Parts
from auto-pairing. Categories: any of sheet/sheetDefinition/size/grain/cncOps -> Changed (cut); else edgebands/manualOps ->
Changed (finishing); else any id/name/owner change -> Renamed; else Same.
**Apply**: raw export + fileName replaced; name/settings unchanged. Sheet codes: an override is kept; an unchanged Sheet keeps
its old code (pinned as an override if Import would now derive another); changed and new Sheets get derived codes, bumped with
freeSheetCode if taken. Progress and sawCncOverrides keys move through `renames` (Removed Parts KEEP their ticks under the old
id, for #39's Spares; sawCnc of Removed Parts is dropped). The stored Plan is kept but its Part ids are renamed (placements,
saw parts, sawReasons, unplaced, sideB, manualOps), so Layouts, bulk ticks and Locked Boards (#36) keep working; Removed Parts
stay in the stale Plan under ids the model no longer has (nameOf falls back to the id). stale.needsNesting carries over (renamed,
still live) from an earlier un-regenerated re-import. Unplanned Jobs get stale = null.
**Done in #39** (see below): Remake / Fix by hand, Changed (finishing) Step clearing, Spares, "moved to …" voids, label
batch, `doc.reimportLog` on the PDF cover.

## Cut sheet: Side A, Side B batch, Edge banding, Owner summary (ticket #31)
```
src/core/documents/work.ts   Shared by every work page (moved out of cut-sheet.ts): CutSheetJob (re-exported from
                           cut-sheet.ts and index.ts as before), workHeader(page, job, title, sub) (sub now spans the full
                           width), partName, plural. sections(plan, model) -> ['saw','sideA','sideB'?,'banding'?,'manualOps'?,
                           'owners'] = the cover's "Order of work" numbering; sectionNumber(plan, model, s) titles pages
                           ("2 · CNC Side A · W18-1-A", "3 · CNC Side B batch", "4 · Edge banding · <Edgeband>", "6 · Owner
                           summary"; numbers shift when Side B / banding / Manual ops are absent).
                           partRunOrder(plan) (same order as the Planner's internal one) and partLocations(plan) -> Map
                           partId -> "W18-1-A #3" | "W18-1 saw" | "W18 saw, no Board" (unplaced). Both exported from
                           documents/index.ts -- #32 labels should reuse them. (Shell App.tsx still has its own
                           partLocations with "Saw · W18 Board 1" text; not touched.)
                           clampOf(plan, blank) = blank.clampMargin ?? plan.settings.clampMargin (#36 fallback).
                           Part cells: finishedSize/finishedText (cut + Edgeband thickness per banded edge), cutText (bold),
                           bandingCell (edges + Edgeband names as `sub`), sideBCell (pill), stepCells(plan, model, partId)
                           (tick box per applicable Step via progress.steps(), '—' grey otherwise), stepColumns(width).
src/core/documents/layout.ts Cell gained TextCell {text, bold?, colour?, sub?, pill?}: `sub` = second small grey line (row
                           grows by 2.8 mm), `pill` = SHADE box behind the text. Single-line rows draw exactly as before.
src/core/documents/drawing.ts circle (24-gon polygon), flipMark (half-filled circle, the "◐": that glyph is not WinAnsi),
                           arrow, opItems(op, toPage, scale, cutLength, cutWidth) (drills: through filled / blind open;
                           grooves clipped + pockets as grey OP_FILL boxes). toPage maps a Part cut-frame point to paper.
src/core/documents/side-a.ts  sideAPages: per Blank (Run order) header (Sheet · Blank size · file <id>.side-a.dxf · n Parts ·
                           n top ops), drawing (outline, dashed clamp margin, footprints shaded for Flip Parts + flip mark,
                           ops, thick banded edges, grain arrow for grain 'length', "#n" labels, 0,0 / X / Y captions; scale
                           x0.7 when > 5 Parts), key line, Part table (#, Part + "narrow: check tabs" sub, Finished, Cut size,
                           Banding, Grain, Side B pill, Manual ops count "listed below", Cut/Side B/Band/Manual ticks), the
                           Blank's Manual ops spelled out, "Side A done" box.
src/core/documents/side-b-pages.ts sideBPages: cards two per row; per file "B1 · <short>-B1.side-b.dxf", × count, sample Part
                           · cut size · ops · bottom face up, fence note (settings.fenceHeightNote, else "Fence lower than
                           the 18 mm stock"), bottom view via sideBPoint (thick fences + edge names, dashed far edges
                           "clamp the far edges"), "<edge> against long/short fence", table Part | Where | Side B tick.
src/core/documents/banding.ts bandingPages: per Edgeband (order of first use in Part Run order) the Parts it goes on, 16 rows a
                           page ("(continued)" header), Where | Part | Edges | Finished | Cut size | Step ticks.
src/core/documents/owners.ts ownerPages: Cabinets then Generated Items, two Owners a page (heading "<label> · <cabinetName> ·
                           n Parts"), Where | Part | Finished | Cut size | Banding | Side B | Step ticks.
tests/page-text.ts         pageText(page) (golden format, moved from cut-sheet.test.ts) + texts(page).
tests/cut-sheet-work.test.ts behaviour per section + "every Part on exactly one Side A/saw page and one Owner page" (hand
                           Plan + planned fixture) + goldens tests/golden/cut-sheet-{side-a-W18-1-A,side-b,banding-e1,owners}.txt.
e2e/cut-sheet.spec.ts      synthetic fixture now previews 8 pages.
```
- Tick boxes are always empty on paper (paper ticks are never reconciled); `cutSheet` still takes no Progress.
- Saw Parts appear on their saw page (and banding/Owner pages), never on a Side A page. Unplaced Saw Parts are on no
  saw page (cover only) and on their Owner page.

## Part labels, QR encoder and the size ladder (ticket #32)
New dev dep: none (`jsqr` arrived with #35; tests decode with it via `tests/qr-decode.ts`).
```
src/core/documents/qr.ts   qrCode(text, ecc 'L'|'M'|'Q'|'H') -> boolean[][] (modules[row][col], NO quiet zone). Own encoder:
                           byte mode (UTF-8), smallest version 1-40 that fits, lowest-penalty mask. ECC tables checked
                           against qrcode-generator for all 160 version/level pairs; tests decode L/M/Q/H up to 300 bytes.
src/core/documents/labels.ts
                           LABEL {width 99.1, height 38.1} mm; LABEL_QR {size 14 (mm, INCLUDING quiet zone), ecc 'M', quiet 2}
                           = the one place to change QR size/ECC/quiet zone (labels + size ladder read it).
                           labelOrder(plan) -> {partId, where}[]: Saw Parts first (Sheets in Run order, Board by Board in
                           saw order, then `unplaced`), then every Blank's Parts by #n. where = "W18-1-A #2" |
                           "Saw · W18 Board 1" | "Saw · too big for a Board" (same strings as App's partLocations).
                           labels(plan, {name, shortId, model}) -> Page[]: L7163 (2 × 7, top 15.15, left 4.65, column gap
                           2.5), header text in the top margin "Labels · <name> · Job <short> · sheet i of N".
                           stickerSpot(part) -> {x, y, length, width, rotated} | null (µm, Part cut frame seen from the top):
                           15 mm from the edges, 3 mm clear of every bottom-face op (Part.bottom + top ops that are through:
                           drill 'through' or depth >= thickness), nearest the face's middle; lengthwise if it fits anywhere,
                           else turned. bottomFaceOps(part) -> {op, own}[].
                           sizeLadder({name, shortId}) -> Page (QR 8-22 mm for a short and a UUID-length id, quiet 0/1/2/4,
                           text 5-18 pt, banded line weights 0.6-1.5, cam/gun tick boxes).
src/shell/LabelsPanel.tsx  region "Part labels": button "Labels" (aria-expanded) -> role=img "Label sheet i of N";
                           "Download labels PDF" -> `<safe job name>.labels.pdf`; "Download size ladder PDF" -> size-ladder.pdf.
tests/page-text.ts         describePage(page) (golden text, same format as cut-sheet goldens, + qr module count, polygon
                           fill) and pageTexts(page). cut-sheet.test.ts still has its own copy (left alone to avoid #31 clashes).
tests/qr-decode.ts         decodeModules(modules, quiet, scale) via jsQR. tests/qr.test.ts, tests/labels.test.ts,
                           golden tests/golden/labels-sheet-1.txt (hand Plan from tests/cut-sheet-plan.ts). e2e/labels.spec.ts.
```
**QR payload** = `scanPayload(shortId, partId)` from progress.ts = `<Job short id>:<Part id>` as plain text (UTF-8 byte
mode, ECC M). Scan mode (#35) splits on the first ':'. A short payload is a 21 × 21 code, a UUID-length one 29 × 29.
- Label drawing: the bottom face turned front to back (y0 at the top, x0 left): drawing y = Part y. Banded edges 1.1 mm
  lines inside the outline, named bold after a small block (the "▮"); unbanded 0.25 mm, grey names; y0 reads
  "y0 · front". Blind bottom ops outlined circles, through holes filled, grooves/pockets grey boxes, Flip Parts
  shaded #e6e6e6, sticker spot #c8c8c8. The ◐ and ✋ of the pills are drawn shapes (not in WinAnsi).
- Text shrinking: Owner label 15 pt and Part name 9.5 pt shrink to 7 pt (fitSize), then end in "…" (fitText).
- Not done: no "reprint after regenerate" filter yet (#36's reprintSelection(job, progress).parts could feed a
  `partIds` option to labels()).

## Kept Offcuts, Remake and the needs-nesting order (ticket #37)
Remake and Discard are MARKS IN THE STORED PLAN (no new JobDocument fields): Locked Boards are kept verbatim, so the
marks survive regenerates; an unlocked Board's Offcuts are new at each plan, so a Discard on one is lost (by design).
```
src/core/planner/index.ts  Plan additions (all OPTIONAL, so older stored Plans and hand-written Plans still compile):
                           Offcut.id ('W18-1-K1', kept Offcuts only, numbered per Board in saw order), Offcut.discarded,
                           Offcut.used (cut up later: its Blanks + leftovers lie inside it), Placement.remade /
                           SawPlacement.remade (a Remake greyed where it was cut; counts nowhere there, DXF unchanged),
                           Blank.from (kept Offcut id it was cut from), Cut.from (saw entry of that Offcut; labels 'K1.1',
                           'K1.1a'), SheetPlan.overflow (Part ids that need nesting and fit nowhere: on no Board) +
                           SheetPlan.extraBoards. PlanPrior.addBoards: Sheet ids allowed more Boards.
                           Exports: livePartIds(board) (Parts minus remade), boardLocked(board, isCut) / blankLocked(blank,
                           isCut) (a Cut Part OR a remade placement locks), remakePart(plan, id), discardOffcut(plan, id, bool).
                           USE livePartIds / skip `remade` wherever you list "the Parts on a Board/Blank" (rollups, labels,
                           locations, run order) -- a Remake Part sits on its old Blank AND on its new one.
src/core/job.ts            remake(job, progress, partId) -> {job, progress} | {error} (only a Part ticked Cut and on a Board;
                           clears all its ticks), setOffcutDiscarded(job, id, bool), addBoards(job, sheetIds, progress),
                           needsNesting(job) (model Parts on no Board, incl. overflow, excl. unplaced). lockedBoards uses
                           boardLocked. Shell saves Remake/Discard as {...doc, plan, updatedAt} (NOT withJob: not a re-plan,
                           so #38's stale/previous survive).
src/core/progress.ts       rollup/wouldUnlock/reprintSelection/sideADone/breakdownDone skip remade placements; locked via
                           blankLocked/boardLocked; sheet totals = model Parts of the Sheet (Remakes waiting still count).
src/core/documents/        saw.ts: SawCutRow.offcut; Offcut entries set from the Offcut's front edge / left end.
                           cut-sheet.ts: "Keep W18-1-K1", "Discarded W18-1-K2 · size" (hatched), used Offcut = dashed outline,
                           Offcut rips labelled inside it, one extra table per Offcut under "From kept Offcut W18-1-K1 (size)".
                           work.ts partRunOrder/partLocations: skip remade, waiting Parts last as 'needs nesting'. labels.ts
                           labelOrder skips remade (waiting Parts get no label until nested).
src/shell/                 BoardBreakdown: g.offcut.(kept|discarded|used), fieldset "Kept Offcuts of <code> Board <n>" with
                           checkboxes "Discard W18-1-K1"; cuts table "crosscut from W18-1-K1". BlankLayout: g.remade greyed
                           (--remade-bg). App: PartList button "Remake <displayName>" (Cut ticked) -> alertdialog "Confirm
                           Remake"; role=status "Parts that need nesting: … Regenerate" (when no re-import stale box); region
                           "Parts that did not fit" with button "Add Board 2 of 2 to W18" (n = Boards now, + extraBoards).
tests/                     planner (Remake onto Offcut, Discard ignored, fall-through, ask/addBoards, brand-new Sheet, random
                           invariants incl. used-Offcut containment), job, progress, remake-documents, cut-sheet golden
                           tests/golden/cut-sheet-saw-W18-1-offcut.txt (tests/cut-sheet-plan.ts offcutBoard()). e2e/offcuts.spec.ts.
```
**Needs-nesting order** (planSheet): needs = Parts of the Sheet not live on any Board of prior.plan (and not prior unplaced);
none without a prior Plan. 1) CNC needs-nesting Parts, largest first, onto each Locked Board's kept, non-discarded, unused
Offcuts in order (bestBoard with ctx.area = the Offcut: Blanks <= bed, clamp margin, kerf; leftovers become Offcuts K<next>, and
can take later Parts in the same pass). Saw Parts never go onto Offcuts. 2) Everything else not Locked is drafted together
(unlocked Boards re-planned from scratch as before). 3) allowed = max(Boards the non-needs Parts need alone, prior Board count -
Locked count); more Boards than that only with addBoards (else the first `allowed` drafts if the rest hold only needs Parts, else the
needs-free drafts; the left-out Parts -> overflow). A Sheet with no Boards in prior.plan is brand-new: no limit.
Not done: Remake of a Saw Part re-nests it as a Saw Part (no Offcut); Side A page of a Locked Blank still lists its remade Part
like any other (the page is "not rewritten"); no cross-Job Offcut stock (out of scope).

## Re-import treatments: Remake, Fix by hand, voids, Spares, label batch (ticket #39)
```
src/core/planner/index.ts  Placement.voided / SawPlacement.voided?: VoidReason ('moved'|'removed'|'spare'): a greyed void a
                           re-import left on a Locked Blank (Saw Part: on a Locked Board). isLive(p) = !remade && !voided.
                           USE isLive (not `!p.remade`) wherever you list the Parts cut on a Board/Blank (livePartIds,
                           progress, labels, work.ts, shell). Voids don't lock by themselves (a 'spare' does, through its
                           kept Cut tick). `sideB` is now re-exported from planner/index.ts.
src/core/reimport.ts       DiffJob.progress? (ticks decide the treatment), DiffChoices.fixByHand? (new ids).
                           DiffEntry.treatment?: 'remake'|'fixByHand'|'nest'|'clearSteps'|'spare'|'drop' (Changed/Removed
                           only), flags? (Changed (finishing): "banding changed after it was banded", "Manual ops changed
                           after they were done"), fixText? (Changed (cut) already cut: what Fix by hand would add).
                           clearedSteps(changes), needsNesting(d) (now excludes fixByHand), reimportLabelIds(d) (Renamed,
                           Changed, Added new ids), voidText(plan, partId) -> "moved to W18-2-A #1" | "moved: needs nesting"
                           | "removed from the export" | "Spare" | undefined.
                           applyReimport: remake -> remakePart + ticks cleared; fixByHand -> handFixes[id].push(fixText),
                           manualOps tick cleared; clearSteps -> Banded / Manual ops ticks cleared; nest / drop / spare ->
                           placements on a Locked Blank become voids, anywhere else they are REMOVED from the stale Plan (so
                           the planner sees them as needs-nesting); unplaced lists drop them; drop also clears ticks; spare
                           keeps ticks under the old id and adds a Spare. Then plan.sideB/manualOps are recomputed from the
                           new model + handFixes (applicable Steps). Log entry gains labelIds.
src/core/change-text.ts    describeChange(before, after, currentModel, nextModel): "now 517 wide", "now 560 long", "now 800 ×
                           596", "now 16 thick", Sheet/grain changes, "hole Ø5 added at 32, 96 and at 64, 96", "… no longer
                           wanted", grooves/pockets; cut sizes, cut frame, mm; parts joined "; ".
src/core/model.ts          ManualOp.reason gained 'fixByHand' (face 'top'). Diff ignores fixByHand ops (they're the Job's).
src/core/job-store/document.ts  JobDocument.handFixes {partId: string[]} ({} when missing), spares: Spare[] {partId (old id),
                           displayName, cutLength, cutWidth, thickness, where?, at} ([] when missing), ReimportLogEntry.labelIds?.
                           openJobDocument injects handFixes into the model (withHandFixes) so plan()/steps()/labels/PDF see
                           them as Manual ops. dismissSpare(doc, partId, now) (ticks stay, Blank stays Locked).
src/core/documents/        CutSheetJob.spares? / reimportLog?: cover "Before you start" gets a Spares line ("Spares: none." when
                           empty: every cover golden shifted 4 mm), then a "Spares" table and a "Re-import log" table at the
                           end. LabelsJob.partIds? = the re-import batch (reimportLabelOrder(plan, ids): label order, then
                           Parts on no Board as "needs nesting"); header "Labels for re-import · …". work.ts waitingIds also
                           lists 'moved' voids.
src/shell/                 ReimportDiff: "Work done" column + checkbox "Fix by hand <name>" + flags; SparesList (region
                           "Spares", "Dismiss <name>"). BlankLayout: required prop voidOf(partId) -> g.void, title suffix
                           "(moved to …)". LabelsPanel: required prop reimportBatch -> button "Print labels for this re-import
                           (n)" (downloads `<name>.reimport-labels.pdf`) while the last log entry has labelIds.
tests/reimport-treatment.test.ts, tests/reimport-documents.test.ts, goldens cut-sheet-cover-reimport.txt,
labels-reimport-batch.txt; e2e/reimport.spec.ts (+2 tests).
```
Limits: a Locked Blank's Side A PDF page still reads finished size/banding of a 'moved' Part from the NEW model (the drawing
and DXF use the stored placement, unchanged); an unlocked Blank on a Locked Board loses the placement (its DXF is rewritten,
it was not cut) and may be left empty.

## Review fixes (two-axis review of the integration branch)
Behaviour changes (each test-first):
- **Older Plans** (`job-store/document.ts` readPlan): a stored Plan missing #27/#28 lists (Board sawParts/offcuts/cuts, Sheet
  sawReasons/unplaced, Plan sideB/manualOps) opens with them filled in EMPTY and `stale = {needsNesting: [], olderPlan: true}`;
  shell box "Plan from an older version" + Regenerate. withJob clears it; applyDiff carries `olderPlan` over. Still jobFormat 1.
- **Locking is per Blank** (planner): a Locked Board (any Part on it Cut / remade) keeps its Breakdown verbatim (number, Blank
  OUTLINES and ids, Saw Parts, Offcuts, cuts). Only Blanks holding a Cut/remade Part keep their Layout. Its other Blanks keep
  their outline and are laid out again (`relayBlank`): their own still-CNC Parts keep their places if those still hold with the
  current clamp margin / bit gap, else are re-nested; what no longer fits goes back to the Sheet's pool. Saw/CNC toggle refuses
  only Parts on a Locked Blank or Saw Parts of a Locked Board; `reprintSelection` lists uncut Blanks of Locked Boards (not the
  Board's saw page). Tests: planner "Locked Boards and Blanks" use an `outline()` helper; invariant helper takes `blanks`.
- Saw Parts that need nesting (e.g. a Remake Saw Part) go onto kept Offcuts of Locked Boards too (PRD 10.3).
- **Only Regenerate re-plans** (PRD 3.5, 11.5): `setPartMode` / `setSheetCode` return the Job with the SAME Plan (choice
  recorded only); the shell stores them with `withChoices(doc, job, now)` (keeps stale/previous). `pendingChoices(job,
  progress)` -> {partModes, sheetCodes} drives the "Changes wait for Regenerate" status; `partMode(job, id)` = chosen mode (the
  Saw checkbox). e2e that edit a code or toggle must click Regenerate in that status.
- **Open Job** (`job-store/store.ts` openFileDecision(file, jobs)): new | same (open the saved copy) | replace (alertdialog
  "Confirm replace": Replace / Keep saved copy) | refuse (saved copy newer, or another Job's short id). Short ids are never
  rewritten for an opened file; only brand-new Jobs grow theirs (`shortIdFor`).
- DXF header is `$ACADVER AC1009` only (no `$INSUNITS`, an R14 variable). Goldens updated.
- **Reprint**: `cutSheet(plan, job, only?: ReprintSelection)` (saw pages of `only.boards`, Side A of `only.blanks`, Side B
  `only.sideB`, banding/Owner rows of `only.parts`, cover line "Reprint: …"); `labels(plan, job, selection?: {partIds, title})`
  (LabelsJob.partIds is GONE: the re-import batch passes `{partIds, title: 'Labels for re-import'}`). Shell: "Download reprint
  PDF: not Locked or Done" and "Labels to reprint (n)" once anything is ticked.
Refactors (behaviour-preserving):
- `src/core/units.ts`: `mmText(um, places = 1)` is the only µm->mm text (paper 1, op texts 2, app 3 via `mmExact`, DXF 4),
  `toMm` (number), `fromMm`. documents/format.ts re-exports mmText.
- `progress.ts`: exported `isCut(progress, id)`; rollup boards gain `sawCut`/`sawTotal`, rollup gains `sideB [{id, done, total}]`.
- `job.ts`: `nestingQueue(job)` -> {waiting, requests [{sheetId, code, partIds, first, last}]} ("Add Boards first–last of last").
- `model.ts`: `partNamer(model)` (display name else id). reimport's Diff-level needsNesting -> private `diffNestTargets`.
- Shell split: `useJobSession.ts` (state + actions, the store, saving), `App.tsx` (nav, inputs, Job list, header),
  `PlannedJob.tsx`, `SheetSection.tsx`, `PartList.tsx`, `fields.tsx`. Part locations in the shell come from documents
  `partLocations` ("W18-1 saw", PartList adds " (narrow)" etc.).
Interfaces vs the PRD "Modules" table (kept on purpose):
- Re-import: `applyDiff(doc, currentModel, next, diff, now)` (PRD `applyDiff(job, diff, choices)`): it needs the whole Job
  document (progress, aliases, log, previous) and the new export text; choices are already in the Diff (`diff(…, choices)`).
- Documents: `cutSheet(plan, job, only?)` / `labels(plan, job, selection?)`: `job` carries name/short id/model; progress is
  passed as the derived `ReprintSelection` (paper ticks stay empty). Barrel exports only the interface + page model.
- DXF: `toDxfFiles(plan, shortId)`: Side B file names carry the Job short id. `layerUsage`/`referenceLayers` stay exported
  for the cover's layer legend.
- Planner (narrowed in the second review-fix pass): `planner/index.ts` exports `plan(model, settings, prior)` + the Plan
  types, plus only `partRule` (Saw/CNC rule for the toggle between re-plans) and `sideB`/`sideBPoint` (re-import rebuilds
  Side B without re-planning; DXF/pages/shell use the geometry). Plan queries and hand edits moved to
  `src/core/plan-queries.ts`: `isLive`, `livePartIds`, `boardLocked`, `blankLocked`, `remakePart`, `discardOffcut`
  (the planner imports them too). Used by job.ts, progress.ts, reimport.ts, documents, shell PartList and planner tests.
  job.ts's pure pass-through `snapshotChanges` is gone: callers use `settingsChanges(job.settings, current)` (settings.ts).
- **Locked Blank's Side A page frozen** (PRD 11.8): `Blank.sideA?: SideAPrint` ({sheetName, parts by `#n`: name, cut
  size, finished size, bands [{edge, name}], grainLength, sideB file id, manualOps texts, steps}). documents/side-a.ts
  `sideAPrint(plan, model, sheet, blank)` builds it; the page always renders from `blank.sideA ?? sideAPrint(...)`.
  `freezeLockedPages(plan, model, isCut)` (documents barrel) sets it on Locked Blanks lacking one; called by applyDiff
  (old model, old progress, before renames) and by job.ts planJob on the prior Plan (regenerate/addBoards). Planner keeps
  Locked Blanks verbatim (so the snapshot); `relayBlank` drops it. Older Plans / unlocked Blanks: no `sideA`, rendered
  from the model as before (goldens unchanged). Not frozen: the Job header (name, short id, generatedAt).
