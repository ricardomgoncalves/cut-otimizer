// Number formats for printed documents. Lengths in µm in, mm text out.

/** µm -> mm rounded to 0.1 mm, no trailing zero (`596800` -> `596.8`, `600000` -> `600`). */
export function mmText(um: number): string {
  const tenths = Math.round(um / 100);
  return String(tenths / 10);
}

/** `length × width` in mm. */
export function sizeText(length: number, width: number): string {
  return `${mmText(length)} × ${mmText(width)}`;
}
