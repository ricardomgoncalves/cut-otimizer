import { describe, expect, it } from 'vitest';
import { mmText, mmToken, toMm } from '../src/core/units.ts';

describe('mmText', () => {
  it('rounds µm to 0.1 mm by default, without trailing zeros', () => {
    expect(mmText(596800)).toBe('596.8');
    expect(mmText(600000)).toBe('600');
    expect(mmText(596850)).toBe('596.9');
  });

  it('keeps as many places as asked', () => {
    expect(mmText(21500, 2)).toBe('21.5');
    expect(mmText(21505, 2)).toBe('21.51');
    expect(mmText(3200, 3)).toBe('3.2');
    expect(mmText(55750, 4)).toBe('55.75');
    expect(mmText(-0.01, 4)).toBe('0');
  });
});

describe('toMm and mmToken', () => {
  it('convert µm to mm numbers and layer tokens', () => {
    expect(toMm(18000)).toBe(18);
    expect(mmToken(4500)).toBe('4P5');
  });
});
