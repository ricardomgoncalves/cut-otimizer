// The keyboard wedge adapter. A wedge scanner "types" the payload very fast and presses Enter; a person
// types far slower. So a scan is a burst of character keys, each within `maxGapMs` of the one before,
// at least `minLength` long and ended by Enter within the same gap. It listens on the whole page, so no
// text field needs focus. No DOM types here: the unit tests run it in Node with a stand-in target.
import type { ScanSource } from './source.ts';

/** The parts of a keydown event the wedge reads. */
export interface WedgeKey {
  key: string;
  /** Milliseconds; only differences matter. */
  timeStamp: number;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  preventDefault?: () => void;
}

/** Where keydown events come from (`window` in the app). */
export interface KeyTarget {
  addEventListener(type: 'keydown', listener: (e: WedgeKey) => void, capture: boolean): void;
  removeEventListener(type: 'keydown', listener: (e: WedgeKey) => void, capture: boolean): void;
}

export interface WedgeOptions {
  /** The longest gap between two keys of one scan. Scanners send a key every few ms; people take 100+. */
  maxGapMs: number;
  /** The shortest scan (Enter not counted). A payload is `<short id>:<Part id>`, so at least 6. */
  minLength: number;
}

export const WEDGE_DEFAULTS: WedgeOptions = { maxGapMs: 50, minLength: 6 };

export function wedgeSource(target: KeyTarget, options: Partial<WedgeOptions> = {}): ScanSource {
  const { maxGapMs, minLength } = { ...WEDGE_DEFAULTS, ...options };
  return {
    start(onScan) {
      let buffer = '';
      let last = -Infinity;
      const listener = (e: WedgeKey) => {
        if (e.ctrlKey || e.altKey || e.metaKey) {
          buffer = '';
          return;
        }
        const fast = e.timeStamp - last <= maxGapMs;
        if (e.key === 'Enter') {
          if (fast && buffer.length >= minLength) {
            e.preventDefault?.();
            onScan(buffer);
          }
          buffer = '';
        } else if (e.key.length === 1) {
          buffer = fast ? buffer + e.key : e.key;
        } else {
          // Shift and other non-character keys: not part of the text, and they don't break a burst.
          return;
        }
        last = e.timeStamp;
      };
      target.addEventListener('keydown', listener, true);
      return () => {
        target.removeEventListener('keydown', listener, true);
      };
    },
  };
}
