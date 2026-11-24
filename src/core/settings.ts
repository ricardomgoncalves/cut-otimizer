// Machine settings. All lengths are integer µm. Hard-coded defaults for now;
// a Machine settings screen and the per-Job snapshot come later (ticket #26).

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
}

export const DEFAULT_SETTINGS: Settings = {
  bedLength: 1300000,
  bedWidth: 1300000,
  clampMargin: 40000,
  bitDiameter: 6000,
  sawKerf: 3200,
};
