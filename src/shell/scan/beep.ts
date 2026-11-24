// Scan feedback sounds: one high beep for a tick, two middle ones for a tick or scan with a warning,
// one long low one for a rejected scan. Silent where Web Audio is unavailable.
export type Tone = 'ok' | 'warn' | 'error';

const PATTERNS: Record<Tone, { hz: number; ms: number }[]> = {
  ok: [{ hz: 1320, ms: 120 }],
  warn: [
    { hz: 660, ms: 110 },
    { hz: 660, ms: 110 },
  ],
  error: [{ hz: 220, ms: 450 }],
};

let context: AudioContext | null = null;

export function beep(tone: Tone): void {
  try {
    context ??= new AudioContext();
    let at = context.currentTime;
    for (const { hz, ms } of PATTERNS[tone]) {
      const osc = context.createOscillator();
      const gain = context.createGain();
      osc.frequency.value = hz;
      gain.gain.value = 0.2;
      osc.connect(gain).connect(context.destination);
      osc.start(at);
      osc.stop(at + ms / 1000);
      at += (ms + 60) / 1000;
    }
  } catch {
    // Sound is a convenience; the on-screen feedback carries the result.
  }
}
