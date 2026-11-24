// Decodes a QR module grid with jsQR (the decoder Scan mode falls back to), as a printed code would be read.
import jsQR from 'jsqr';

/** Draws `modules` with a `quiet`-module white border at `scale` px per module and decodes it; null when unreadable. */
export function decodeModules(modules: boolean[][], quiet = 4, scale = 4): string | null {
  const n = modules.length + 2 * quiet;
  const px = n * scale;
  const data = new Uint8ClampedArray(px * px * 4).fill(255);
  modules.forEach((row, r) => {
    row.forEach((dark, c) => {
      if (!dark) return;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const i = (((r + quiet) * scale + dy) * px + (c + quiet) * scale + dx) * 4;
          data[i] = 0;
          data[i + 1] = 0;
          data[i + 2] = 0;
        }
      }
    });
  });
  return jsQR(data, px, px, { inversionAttempts: 'dontInvert' })?.data ?? null;
}
