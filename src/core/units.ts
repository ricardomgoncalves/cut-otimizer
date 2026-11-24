// Unit helpers shared by core modules and the shell. Lengths are integer µm throughout.

/** µm -> mm text as the app shows and edits it: exact (3 places). */
export function mmExact(um: number): string {
  return mmText(um, 3);
}

/** mm (as typed) -> whole µm. */
export function fromMm(mm: number): number {
  return Math.round(mm * 1000);
}

/** µm -> mm, as a number (drawing coordinates). */
export function toMm(um: number): number {
  return um / 1000;
}

/**
 * µm -> mm text, rounded to `decimals` places with no trailing zeros (`596800` -> `596.8`, `600000` ->
 * `600`). The one place lengths become text: 1 place on paper (the default), 2 in op descriptions, 3
 * (exact) in the app, 4 in DXF coordinates.
 */
export function mmText(um: number, decimals = 1): string {
  const scale = 10 ** decimals;
  const value = Math.round((um * scale) / 1000) / scale;
  return String(value === 0 ? 0 : value);
}

/**
 * µm -> mm rounded to 0.1 mm, written as an integer when whole and with `P` as the decimal
 * point (`4500` -> `4P5`, `18000` -> `18`). Used in Sheet codes and DXF layer names.
 */
export function mmToken(um: number): string {
  const tenths = Math.round(um / 100);
  const sign = tenths < 0 ? '-' : '';
  const abs = Math.abs(tenths);
  const whole = Math.trunc(abs / 10);
  const frac = abs % 10;
  return `${sign}${String(whole)}${frac === 0 ? '' : `P${String(frac)}`}`;
}
