import { describe, expect, it } from 'vitest';
import { qrCode } from '../src/core/documents/qr.ts';
import { decodeModules } from './qr-decode.ts';

describe('qrCode: text -> module grid', () => {
  it('encodes a short payload as a 21 × 21 (version 1) code that decodes back', () => {
    const modules = qrCode('7F3A:p017', 'M');

    expect(modules).toHaveLength(21);
    expect(modules.every((row) => row.length === 21)).toBe(true);
    expect(decodeModules(modules)).toBe('7F3A:p017');
  });

  it('grows the version with the text: a UUID-length payload is 29 × 29 (version 3) at level M', () => {
    const text = '7F3A:3f2a9c1e-7b4d-4e0a-9c2b-5d8e1f6a7b30';
    const modules = qrCode(text, 'M');

    expect(modules).toHaveLength(29);
    expect(decodeModules(modules)).toBe(text);
  });

  // Lengths that land on single-block, multi-block (mixed block sizes) and version-info (>= 7) versions.
  it.each(['L', 'M', 'Q', 'H'] as const)('decodes back at level %s for payloads from 1 to 300 bytes', (ecc) => {
    for (const len of [1, 17, 30, 60, 100, 150, 220, 300]) {
      const text = Array.from({ length: len }, (_, i) => 'ABCdef0123:/-[]._'[i % 17]).join('');
      const modules = qrCode(text, ecc);
      expect(decodeModules(modules, 4, 3), `${ecc} ${String(len)} bytes, ${String(modules.length)} modules`).toBe(text);
    }
  });

  it('encodes non-ASCII text as UTF-8', () => {
    expect(decodeModules(qrCode('B3:Prateleira ção', 'M'))).toBe('B3:Prateleira ção');
  });
});
