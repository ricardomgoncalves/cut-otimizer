import { useCallback, useEffect, useRef, useState } from 'react';
import type { Job } from '../core/job.ts';
import { rollup, scan, STEPS, type IdAliases, type Progress, type ScanOutcome, type Step } from '../core/progress.ts';
import { beep, type Tone } from './scan/beep.ts';
import { webcamSource } from './scan/webcam.ts';
import { wedgeSource } from './scan/wedge.ts';
import { STEP_LABELS } from './step-labels.ts';

interface Props {
  job: Job;
  progress: Progress;
  shortId: string;
  aliases: IdAliases;
  /** `W18-1-A #3`, or where a Saw Part is cut. */
  whereOf: (partId: string) => string | undefined;
  /** Stores the ticks after a scan ticked a Step. */
  onTicked: (progress: Progress) => void;
}

interface Feedback {
  tone: Tone;
  headline: string;
  /** `B3 · Left side`. */
  part?: string | undefined;
  where?: string | undefined;
  /** `B3: 6 / 8 Done`. */
  owner?: string | undefined;
  warnings: string[];
}

const stepList = (steps: readonly Step[]) => steps.map((s) => STEP_LABELS[s]).join(', ');

function feedbackFor(job: Job, outcome: ScanOutcome, progress: Progress, whereOf: Props['whereOf']): Feedback {
  if (outcome.kind === 'rejected') {
    const headline = {
      unreadable: 'Not a label of this app',
      otherJob: 'Not this Job: this label is from another Job',
      unknownPart: 'No such Part in this Job',
    }[outcome.reason];
    return { tone: 'error', headline, warnings: [`Scanned: ${outcome.payload}`] };
  }
  const part = job.model.parts.find((p) => p.id === outcome.partId);
  const owner = rollup(job, progress).owners.find((o) => o.ownerId === part?.ownerId);
  const about = {
    part: part?.displayName ?? outcome.partId,
    where: whereOf(outcome.partId),
    owner: owner && `${owner.label}: ${String(owner.done)} / ${String(owner.total)} Done`,
  };
  const step = STEP_LABELS[outcome.step];
  if (outcome.kind === 'notTicked') {
    const headline = outcome.reason === 'noSuchStep' ? `No ${step} step on this Part` : `${step} was already ticked`;
    return { tone: 'warn', headline: `${headline}: nothing ticked`, ...about, warnings: [] };
  }
  const warnings = outcome.openEarlier.length > 0 ? [`Still open before ${step}: ${stepList(outcome.openEarlier)}`] : [];
  return { tone: warnings.length > 0 ? 'warn' : 'ok', headline: `${step} ticked`, ...about, warnings };
}

/**
 * Scan mode: choose a Step, then scan labels with the wedge scanner (anywhere on the page) or the
 * webcam. Each scan ticks that Step on the scanned Part, by the Progress module's Scan-mode rules.
 */
export function ScanMode(props: Props) {
  const [step, setStep] = useState<Step>('cut');
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [webcam, setWebcam] = useState(false);
  const [webcamError, setWebcamError] = useState<string | null>(null);
  const video = useRef<HTMLVideoElement>(null);

  // Sources outlive renders; they always read the latest Job, ticks and Step from here.
  const latest = useRef({ props, step });
  useEffect(() => {
    latest.current = { props, step };
  });

  const onScan = useCallback((text: string) => {
    const { props: p, step: s } = latest.current;
    const outcome = scan(p.job, { shortId: p.shortId, aliases: p.aliases }, p.progress, {
      payload: text,
      step: s,
      at: new Date().toISOString(),
    });
    const progress = outcome.kind === 'ticked' ? outcome.progress : p.progress;
    if (outcome.kind === 'ticked') {
      p.onTicked(progress);
      // Until the parent re-renders, a second quick scan must see this tick.
      latest.current = { props: { ...p, progress }, step: s };
    }
    const next = feedbackFor(p.job, outcome, progress, p.whereOf);
    beep(next.tone);
    setFeedback(next);
  }, []);

  useEffect(() => wedgeSource(window).start(onScan, () => undefined), [onScan]);

  useEffect(() => {
    if (!webcam || !video.current) return;
    setWebcamError(null);
    return webcamSource(video.current).start(onScan, setWebcamError);
  }, [webcam, onScan]);

  return (
    <section aria-label="Scan mode" className="scan-mode">
      <h2>Scanning: {STEP_LABELS[step]}</h2>
      <fieldset>
        <legend>Step each scan ticks</legend>
        {STEPS.map((s) => (
          <label key={s} className="step-choice">
            <input
              type="radio"
              name="scan-step"
              checked={step === s}
              onChange={() => {
                setStep(s);
                setFeedback(null);
              }}
            />{' '}
            {STEP_LABELS[s]}
          </label>
        ))}
      </fieldset>
      <p>
        Scan a label with the barcode scanner; no field needs focus. Or{' '}
        <button
          type="button"
          aria-pressed={webcam}
          onClick={() => {
            setWebcam(!webcam);
          }}
        >
          {webcam ? 'Stop webcam' : 'Use webcam'}
        </button>
      </p>
      {webcamError && (
        <p role="alert" className="error">
          {webcamError}
        </p>
      )}
      {webcam && <video ref={video} className="scan-video" muted playsInline aria-label="Webcam" />}
      <div role="status" aria-label="Scan feedback" className={`scan-feedback${feedback ? ` ${feedback.tone}` : ''}`}>
        {feedback ? (
          <>
            <p className="scan-headline">{feedback.headline}</p>
            {feedback.part && <p className="scan-part">{feedback.part}</p>}
            {feedback.where && <p className="scan-where">{feedback.where}</p>}
            {feedback.owner && <p className="scan-owner">{feedback.owner}</p>}
            {feedback.warnings.map((w) => (
              <p key={w} className="scan-warning">
                {w}
              </p>
            ))}
          </>
        ) : (
          <p className="scan-headline">Waiting for a scan…</p>
        )}
      </div>
    </section>
  );
}
