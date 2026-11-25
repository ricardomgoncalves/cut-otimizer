import type { Settings } from '../core/settings.ts';

/** How each setting is named in the UI (also used to say which settings a Job's snapshot differs in). */
export const SETTING_LABELS: Record<keyof Settings, string> = {
  bedLength: 'Bed length',
  bedWidth: 'Bed width',
  clampMargin: 'Clamp margin',
  bitDiameter: 'Bit diameter',
  sawKerf: 'Saw kerf',
  edgeTrim: 'Edge trim',
  edgeTrimBySheet: 'Edge trim per Sheet',
  minCncWidth: 'Min CNC width',
  minOffcutSize: 'Min Offcut size',
  manualBottomOpKinds: '`bottom` op kinds done by hand',
  fenceHeightNote: 'Fence height note',
  allowTiling: 'Allow tiling',
};
