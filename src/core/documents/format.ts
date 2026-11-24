// Number formats for printed documents. Lengths in µm in, mm text out (0.1 mm on paper).
import { mmText } from '../units.ts';

export { mmText };

/** `length × width` in mm. */
export function sizeText(length: number, width: number): string {
  return `${mmText(length)} × ${mmText(width)}`;
}
