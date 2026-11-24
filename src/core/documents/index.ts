// Documents: printed paper for the shop, as a page model (pages of positioned items in mm) that a PDF
// renderer (shell, pdf-lib) and an SVG renderer (preview) draw the same way.
export { cutSheet, type CutSheetJob } from './cut-sheet.ts';
export { sawCuts, type SawCutRow } from './saw.ts';
export { partLocations, partRunOrder } from './work.ts';
export { A4, BLACK, hatchLines, qrSquares, type BoxItem, type HatchItem, type Item, type LineItem, type Page, type PolygonItem, type QrItem, type TextItem } from './page.ts';
export { pageToSvg } from './svg.ts';
export { LABEL, LABEL_QR, labelOrder, labels, reimportLabelOrder, sizeLadder, stickerSpot, type LabelEntry, type LabelsJob, type StickerSpot } from './labels.ts';
export { qrCode, type QrEcc } from './qr.ts';
