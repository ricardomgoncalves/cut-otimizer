/** The id of a Sheet's block on the stage, for the Sheet list to jump to. */
export function sheetAnchor(code: string): string {
  return `sheet-${code}`;
}
