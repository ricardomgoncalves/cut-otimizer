// Machine settings: global to the browser, snapshotted into each Job when it is generated.
// All lengths are integer µm. The Planner and DXF writer read settings from an argument (or the
// Plan's snapshot), never from a global.
import type { CncOp } from './model.ts';
import { mmToken } from './units.ts';

export type OpKind = CncOp['kind'];
export const OP_KINDS: readonly OpKind[] = ['drill', 'groove', 'pocket'];

export interface Settings {
  /** Bed working area along X (the Board length runs along X). */
  bedLength: number;
  /** Bed working area along Y. */
  bedWidth: number;
  /** Kept clear of Parts on all four edges of a Blank. */
  clampMargin: number;
  /** End mill diameter: the gap kept between nested Parts. */
  bitDiameter: number;
  /** Saw kerf between pieces cut from a Board. */
  sawKerf: number;
  /** Trimmed off every edge of a Board before it is broken down. */
  edgeTrim: number;
  /** Per-Sheet edge trim, by Sheet id (a library id, so it holds across Jobs). Overrides `edgeTrim`. */
  edgeTrimBySheet: Record<string, number>;
  /** The shortest cut side a Part may have to be nested without a warning. */
  minCncWidth: number;
  /** The smallest leftover, on both sides, kept as an Offcut. */
  minOffcutSize: number;
  /** `bottom` op kinds always done by hand (Manual ops), sorted in `OP_KINDS` order. */
  manualBottomOpKinds: OpKind[];
  /** Free text, shown with Side B files. */
  fenceHeightNote: string;
  /**
   * Whether CAM may cut a Tiled Blank: a Blank longer than the bed along X, cut in several Tiles from one
   * file. On, a Part longer than the usable bed (but not wider) can go on the CNC. A stored copy without it
   * reads as off, so Jobs from before it plan as they did.
   */
  allowTiling: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
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
};

type LengthKey = {
  [K in keyof Settings]: Settings[K] extends number ? K : never;
}[keyof Settings];

const LENGTH_KEYS: LengthKey[] = [
  'bedLength',
  'bedWidth',
  'clampMargin',
  'bitDiameter',
  'sawKerf',
  'edgeTrim',
  'minCncWidth',
  'minOffcutSize',
];

const isLength = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

/**
 * Reads stored settings (e.g. from browser storage or a Job file). Each field that is missing or
 * malformed falls back to its default, so older or hand-edited settings always load. Allow tiling is the
 * exception: missing or malformed reads as off, so an older copy plans as it did.
 */
export function parseSettings(value: unknown): Settings {
  const raw: Partial<Record<keyof Settings, unknown>> =
    typeof value === 'object' && value !== null ? value : {};
  const settings: Settings = { ...DEFAULT_SETTINGS, edgeTrimBySheet: {}, manualBottomOpKinds: [] };
  for (const key of LENGTH_KEYS) {
    const v = raw[key];
    if (isLength(v)) settings[key] = v;
  }
  const bySheet = raw.edgeTrimBySheet;
  if (typeof bySheet === 'object' && bySheet !== null) {
    for (const [id, v] of Object.entries(bySheet)) if (isLength(v)) settings.edgeTrimBySheet[id] = v;
  }
  const kinds = raw.manualBottomOpKinds;
  if (Array.isArray(kinds)) settings.manualBottomOpKinds = OP_KINDS.filter((k) => kinds.includes(k));
  if (typeof raw.fenceHeightNote === 'string') settings.fenceHeightNote = raw.fenceHeightNote;
  // Missing means a copy from before tiling: it stays off, so that Job plans as it did.
  settings.allowTiling = raw.allowTiling === true;
  return settings;
}

export interface SettingsError {
  field: keyof Settings;
  message: string;
}

/** Problems that would stop the Planner from making a sensible Plan. Empty when the settings are usable. */
export function validateSettings(s: Settings): SettingsError[] {
  const errors: SettingsError[] = [];
  if (s.bedLength <= 0) errors.push({ field: 'bedLength', message: 'Bed length must be more than 0.' });
  if (s.bedWidth <= 0) errors.push({ field: 'bedWidth', message: 'Bed width must be more than 0.' });
  if (s.bitDiameter <= 0) errors.push({ field: 'bitDiameter', message: 'Bit diameter must be more than 0.' });
  const shortBed = Math.min(s.bedLength, s.bedWidth);
  if (2 * s.clampMargin >= shortBed) {
    errors.push({
      field: 'clampMargin',
      message: `Clamp margin leaves no room on the bed (2 × ${mmToken(s.clampMargin)} mm ≥ ${mmToken(shortBed)} mm).`,
    });
  }
  return errors;
}

/** The edge trim for one Sheet: its override if it has one, else the global edge trim. */
export function edgeTrimFor(s: Settings, sheetId: string): number {
  return s.edgeTrimBySheet[sheetId] ?? s.edgeTrim;
}

/** The settings fields whose values differ, in `Settings` order. Empty when `a` and `b` are equal. */
export function settingsChanges(a: Settings, b: Settings): (keyof Settings)[] {
  const keys = Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[];
  return keys.filter((k) => canonical(a[k]) !== canonical(b[k]));
}

function canonical(v: unknown): string {
  if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
    return JSON.stringify(Object.entries(v).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)));
  }
  return JSON.stringify(v);
}
