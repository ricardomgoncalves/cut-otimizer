/**
 * Where Scan mode's scans come from: the keyboard wedge scanner or the webcam. Both hand over the
 * decoded text of a label's QR code; the Progress module's `scan` decides what it ticks.
 */
export interface ScanSource {
  /** Starts reading. Returns a function that stops it. */
  start(onScan: (text: string) => void, onError: (message: string) => void): () => void;
}
