// Documents: printed paper for the shop, as a page model (pages of positioned items in mm) that a PDF
// renderer (shell, pdf-lib) and an SVG renderer (preview) draw the same way.
//
// The interface: `cutSheet(plan, job, only?)` and `labels(plan, job, selection?)` (+ the size ladder), the
// page model with the geometry both renderers share, the SVG renderer, where each Part is cut, and freezing Locked Blanks' Side A pages. Saw cut
// rows, label order, sticker spots and the QR encoder are internal (tests reach them by module path).
export { cutSheet, type CutSheetJob } from './cut-sheet.ts';
export { partLocations } from './work.ts';
export { freezeLockedPages } from './side-a.ts';
export { A4, BLACK, hatchLines, qrSquares, type BoxItem, type HatchItem, type Item, type LineItem, type Page, type PolygonItem, type QrItem, type TextItem } from './page.ts';
export { pageToSvg } from './svg.ts';
export { labels, sizeLadder, type LabelSelection, type LabelsJob } from './labels.ts';
