// The webcam adapter: reads label QR codes from the camera into `video`. It uses the browser's
// `BarcodeDetector` where it can read QR codes, and the jsQR decoder (loaded on first use) elsewhere.
import type { ScanSource } from './source.ts';

/** How often a frame is decoded. */
const FRAME_MS = 150;
/** The same code held in front of the camera counts once until it has been gone this long. */
const REPEAT_MS = 2000;

/** The part of `BarcodeDetector` used here (it is not in TypeScript's DOM types yet). */
interface QrDetector {
  detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]>;
}
interface BarcodeDetectorClass {
  new (options: { formats: string[] }): QrDetector;
  getSupportedFormats(): Promise<string[]>;
}

type Decode = (video: HTMLVideoElement) => Promise<string | null>;

async function nativeDecoder(): Promise<Decode | null> {
  const Detector = (globalThis as { BarcodeDetector?: BarcodeDetectorClass }).BarcodeDetector;
  if (!Detector) return null;
  try {
    if (!(await Detector.getSupportedFormats()).includes('qr_code')) return null;
  } catch {
    return null;
  }
  const detector = new Detector({ formats: ['qr_code'] });
  return async (video) => (await detector.detect(video))[0]?.rawValue ?? null;
}

async function jsDecoder(): Promise<Decode> {
  const { default: jsQR } = await import('jsqr');
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { willReadFrequently: true });
  return (video) => {
    const { videoWidth: width, videoHeight: height } = video;
    if (!context || width === 0 || height === 0) return Promise.resolve(null);
    canvas.width = width;
    canvas.height = height;
    context.drawImage(video, 0, 0, width, height);
    const image = context.getImageData(0, 0, width, height);
    return Promise.resolve(jsQR(image.data, width, height, { inversionAttempts: 'dontInvert' })?.data ?? null);
  };
}

export function webcamSource(video: HTMLVideoElement): ScanSource {
  return {
    start(onScan, onError) {
      let stopped = false;
      let stream: MediaStream | null = null;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let lastText = '';
      let lastSeen = -Infinity;

      void (async () => {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
          if (stopped) {
            for (const track of stream.getTracks()) track.stop();
            return;
          }
          video.srcObject = stream;
          await video.play();
          const decode = (await nativeDecoder()) ?? (await jsDecoder());
          const frame = async () => {
            if (stopped) return;
            try {
              const text = await decode(video);
              const t = performance.now();
              if (text !== null) {
                if (text !== lastText || t - lastSeen > REPEAT_MS) onScan(text);
                lastText = text;
                lastSeen = t;
              }
            } catch {
              // A frame that can't be decoded is skipped.
            }
            if (!stopped) timer = setTimeout(() => void frame(), FRAME_MS);
          };
          void frame();
        } catch (err) {
          if (!stopped) onError(`The webcam could not be started: ${err instanceof Error ? err.message : String(err)}`);
        }
      })();

      return () => {
        stopped = true;
        clearTimeout(timer);
        if (stream) for (const track of stream.getTracks()) track.stop();
        video.srcObject = null;
      };
    },
  };
}
