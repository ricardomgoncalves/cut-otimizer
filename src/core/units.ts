// Unit helpers shared by core modules. Lengths are integer µm throughout.

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
