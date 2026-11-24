import { describe, expect, it } from 'vitest';
import { wedgeSource, type KeyTarget, type WedgeKey } from '../src/shell/scan/wedge.ts';

/** A stand-in for `window`: records listeners and plays key timings into them. */
function fakeTarget() {
  const listeners = new Set<(e: WedgeKey) => void>();
  const target: KeyTarget = {
    addEventListener: (_type, listener) => listeners.add(listener),
    removeEventListener: (_type, listener) => listeners.delete(listener),
  };
  let clock = 1000;
  const prevented: string[] = [];
  /** Presses each key `gapMs` after the previous one. */
  const type = (keys: readonly string[], gapMs: number) => {
    for (const key of keys) {
      clock += gapMs;
      const e: WedgeKey = { key, timeStamp: clock, preventDefault: () => prevented.push(key) };
      for (const l of listeners) l(e);
    }
  };
  const wait = (ms: number) => (clock += ms);
  return { target, type, wait, prevented, listeners };
}

const keysOf = (text: string) => [...text];

function started(options?: Parameters<typeof wedgeSource>[1]) {
  const t = fakeTarget();
  const scans: string[] = [];
  const stop = wedgeSource(t.target, options).start((text) => scans.push(text), () => undefined);
  return { ...t, scans, stop };
}

describe('the keyboard wedge adapter', () => {
  it('reads a fast burst of keys ending in Enter as one scan', () => {
    const t = started();
    t.type([...keysOf('K7Q2:c1/s0.rail[1]'), 'Enter'], 8);
    expect(t.scans).toEqual(['K7Q2:c1/s0.rail[1]']);
    // The Enter of a scan doesn't also submit whatever form has focus.
    expect(t.prevented).toEqual(['Enter']);
  });

  it('ignores normal typing, even when it ends in Enter', () => {
    const t = started();
    t.type([...keysOf('K7Q2:c1/s0.rail[1]'), 'Enter'], 120);
    expect(t.scans).toEqual([]);
    expect(t.prevented).toEqual([]);
  });

  it('starts over after a pause, so typed keys before a scan are not part of it', () => {
    const t = started();
    t.type(keysOf('abc'), 150);
    t.wait(400);
    t.type([...keysOf('K7Q2:x/y'), 'Enter'], 10);
    expect(t.scans).toEqual(['K7Q2:x/y']);
  });

  it('drops a burst that stalls before its Enter, and bursts too short to be a payload', () => {
    const t = started();
    t.type(keysOf('K7Q2:x/y'), 10);
    t.type(['Enter'], 300);
    t.type([...keysOf('ab'), 'Enter'], 10);
    expect(t.scans).toEqual([]);
  });

  it('skips Shift and other non-character keys a scanner sends between characters', () => {
    const t = started();
    t.type(['Shift', 'K', 'Shift', '7', 'Shift', 'Q', '2', ':', 'a', '/', 'b', 'Enter'], 6);
    expect(t.scans).toEqual(['K7Q2:a/b']);
  });

  it('reads several scans in a row, and stops listening when stopped', () => {
    const t = started();
    t.type([...keysOf('K7Q2:a/1'), 'Enter'], 5);
    t.wait(200);
    t.type([...keysOf('K7Q2:a/2'), 'Enter'], 5);
    expect(t.scans).toEqual(['K7Q2:a/1', 'K7Q2:a/2']);
    t.stop();
    expect(t.listeners.size).toBe(0);
  });

  it('takes the burst speed as an option', () => {
    const t = started({ maxGapMs: 20 });
    t.type([...keysOf('K7Q2:a/1'), 'Enter'], 30);
    expect(t.scans).toEqual([]);
  });
});
