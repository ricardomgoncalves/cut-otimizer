import type { Step } from '../core/progress.ts';

/** How each Step is named on screen. */
export const STEP_LABELS: Record<Step, string> = {
  cut: 'Cut',
  sideB: 'Side B',
  banded: 'Banded',
  manualOps: 'Manual ops',
};
