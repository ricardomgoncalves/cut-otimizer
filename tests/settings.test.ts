import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  edgeTrimFor,
  parseSettings,
  settingsChanges,
  validateSettings,
} from '../src/core/settings.ts';

describe('DEFAULT_SETTINGS', () => {
  it('holds the PRD defaults, in µm', () => {
    expect(DEFAULT_SETTINGS).toEqual({
      bedLength: 1300000,
      bedWidth: 1300000,
      clampMargin: 40000,
      bitDiameter: 6000,
      sawKerf: 3200,
      edgeTrim: 0,
      edgeTrimBySheet: {},
      minCncWidth: 50000,
      minOffcutSize: 150000,
      manualBottomOpKinds: [],
      fenceHeightNote: '',
      allowTiling: true,
    });
  });
});

describe('parseSettings', () => {
  it('reads back settings it was given', () => {
    const s = {
      ...DEFAULT_SETTINGS,
      clampMargin: 30000,
      edgeTrimBySheet: { '1234': 5000 },
      manualBottomOpKinds: ['pocket', 'drill'],
      fenceHeightNote: 'Fence at 12 mm',
    };
    expect(parseSettings(JSON.parse(JSON.stringify(s)))).toEqual({
      ...s,
      manualBottomOpKinds: ['drill', 'pocket'],
    });
  });

  it('falls back to the default for each missing or malformed field', () => {
    expect(
      parseSettings({
        bedLength: 'big',
        clampMargin: 25000,
        sawKerf: -1,
        bitDiameter: 6.5,
        edgeTrimBySheet: { a: 2000, b: 'x' },
        manualBottomOpKinds: ['drill', 'saw', 'drill'],
        fenceHeightNote: 7,
        extra: true,
      }),
    ).toEqual({
      ...DEFAULT_SETTINGS,
      clampMargin: 25000,
      edgeTrimBySheet: { a: 2000 },
      manualBottomOpKinds: ['drill'],
      allowTiling: false,
    });
  });

  it('gives the defaults for anything that is not an object, with tiling off', () => {
    expect(parseSettings(null)).toEqual({ ...DEFAULT_SETTINGS, allowTiling: false });
    expect(parseSettings('{')).toEqual({ ...DEFAULT_SETTINGS, allowTiling: false });
  });

  it('reads a missing or malformed Allow tiling as off, so stored Jobs from before it plan as they did', () => {
    const older: Partial<typeof DEFAULT_SETTINGS> = { ...DEFAULT_SETTINGS };
    delete older.allowTiling;
    expect(parseSettings(older).allowTiling).toBe(false);
    expect(parseSettings({ ...older, allowTiling: 'yes' }).allowTiling).toBe(false);
    expect(parseSettings({ ...older, allowTiling: true }).allowTiling).toBe(true);
    expect(parseSettings({ ...older, allowTiling: false }).allowTiling).toBe(false);
  });
});

describe('validateSettings', () => {
  it('accepts the defaults', () => {
    expect(validateSettings(DEFAULT_SETTINGS)).toEqual([]);
  });

  it('rejects a clamp margin that leaves no room on the bed', () => {
    expect(validateSettings({ ...DEFAULT_SETTINGS, bedWidth: 80000 })).toEqual([
      { field: 'clampMargin', message: 'Clamp margin leaves no room on the bed (2 × 40 mm ≥ 80 mm).' },
    ]);
  });

  it('rejects a zero bit diameter and a zero bed', () => {
    expect(
      validateSettings({ ...DEFAULT_SETTINGS, bitDiameter: 0, bedLength: 0 }).map((e) => e.field),
    ).toEqual(['bedLength', 'bitDiameter', 'clampMargin']);
  });
});

describe('edgeTrimFor', () => {
  it('uses the per-Sheet override when there is one, else the global edge trim', () => {
    const s = { ...DEFAULT_SETTINGS, edgeTrim: 5000, edgeTrimBySheet: { s2: 0, s3: 8000 } };
    expect(edgeTrimFor(s, 's1')).toBe(5000);
    expect(edgeTrimFor(s, 's2')).toBe(0);
    expect(edgeTrimFor(s, 's3')).toBe(8000);
  });
});

describe('settingsChanges', () => {
  it('is empty for equal settings, even when built separately', () => {
    expect(
      settingsChanges(
        { ...DEFAULT_SETTINGS, edgeTrimBySheet: { a: 1000, b: 2000 }, manualBottomOpKinds: ['drill'] },
        { ...DEFAULT_SETTINGS, edgeTrimBySheet: { b: 2000, a: 1000 }, manualBottomOpKinds: ['drill'] },
      ),
    ).toEqual([]);
  });

  it('lists every field that differs', () => {
    expect(
      settingsChanges(DEFAULT_SETTINGS, {
        ...DEFAULT_SETTINGS,
        clampMargin: 30000,
        edgeTrimBySheet: { a: 1000 },
        fenceHeightNote: 'x',
        allowTiling: false,
      }),
    ).toEqual(['clampMargin', 'edgeTrimBySheet', 'fenceHeightNote', 'allowTiling']);
  });
});
