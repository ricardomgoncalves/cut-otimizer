import { partMode, type Job } from '../core/job.ts';
import { isLive, livePartIds } from '../core/plan-queries.ts';
import type { SawReason, SheetPlan } from '../core/planner/index.ts';
import { isCut, isDone, steps, STEPS, type Progress, type Step } from '../core/progress.ts';
import { mmExact } from '../core/units.ts';
import { STEP_LABELS } from './step-labels.ts';

const SAW_REASONS: Record<SawReason, string> = {
  oversize: 'bigger than the bed',
  narrow: 'narrow',
  long: 'longer than the bed',
  chosen: 'chosen',
};

interface Props {
  job: Job;
  sheet: SheetPlan;
  progress: Progress;
  /** Where each Part is cut (documents `partLocations`): `W18-1-A #3`, `W18-1 saw`… */
  where: ReadonlyMap<string, string>;
  /** Parts the stale Plan doesn't place as they are now (after a re-import, Remakes). */
  needsNesting: readonly string[];
  /** Parts that fit nowhere and wait for the person to add a Board. */
  overflow: readonly string[];
  /** Asks to mark a cut Part Remake. */
  onRemake: (partId: string) => void;
  onMode: (partId: string, mode: 'saw' | 'cnc') => void;
  onStep: (partId: string, step: Step, ticked: boolean) => void;
}

/** Every Part of a Sheet with where it is cut, the narrow warning, the Saw / CNC toggle and its Step ticks. */
export function PartList({ job, sheet, progress, where, needsNesting, overflow, onRemake, onMode, onStep }: Props) {
  const live = sheet.boards.flatMap((b) => b.blanks.flatMap((x) => x.parts.filter(isLive)));
  const narrow = new Set(live.filter((p) => p.narrow).map((p) => p.partId));
  const placedIds = new Set([...sheet.boards.flatMap(livePartIds), ...sheet.unplaced]);

  return (
    <table aria-label={`Parts of ${sheet.code}`}>
      <thead>
        <tr>
          <th scope="col">Part</th>
          <th scope="col">Cut size (mm)</th>
          <th scope="col">Where</th>
          <th scope="col">Saw / CNC</th>
          {STEPS.map((step) => (
            <th key={step} scope="col">
              {STEP_LABELS[step]}
            </th>
          ))}
          <th scope="col">Done</th>
        </tr>
      </thead>
      <tbody>
        {job.model.parts
          .filter((p) => p.sheetId === sheet.sheetId)
          .map((p) => {
            const at = where.get(p.id);
            const reason = sheet.sawReasons[p.id];
            const placed = placedIds.has(p.id);
            const applicable = steps(job, p.id);
            return (
              <tr key={p.id}>
                <td>{p.displayName}</td>
                <td>
                  {mmExact(p.cutLength)} × {mmExact(p.cutWidth)}
                </td>
                <td>
                  {overflow.includes(p.id) ? (
                    <span className="warn">waiting for a Board</span>
                  ) : needsNesting.includes(p.id) || !placed ? (
                    <span className="warn">needs nesting</span>
                  ) : (
                    <>
                      {at}
                      {reason &&
                        sheet.sawParts.includes(p.id) &&
                        ` (${SAW_REASONS[reason]}${reason === 'oversize' && job.plan.settings.allowTiling ? ': tiling only goes along X' : ''})`}
                    </>
                  )}
                  {placed && isCut(progress, p.id) && (
                    <>
                      {' '}
                      <button
                        type="button"
                        onClick={() => {
                          onRemake(p.id);
                        }}
                      >
                        Remake {p.displayName}
                      </button>
                    </>
                  )}
                  {placed && narrow.has(p.id) && <span className="warn"> · narrow: check tabs</span>}
                </td>
                <td>
                  <label
                    title={
                      reason === 'oversize'
                        ? 'Bigger than the usable bed: always cut on the saw (tiling only goes along X)'
                        : undefined
                    }
                  >
                    <input
                      type="checkbox"
                      checked={partMode(job, p.id) === 'saw'}
                      disabled={reason === 'oversize'}
                      onChange={(e) => {
                        onMode(p.id, e.target.checked ? 'saw' : 'cnc');
                      }}
                    />{' '}
                    Saw
                  </label>
                </td>
                {STEPS.map((step) => (
                  <td key={step}>
                    {applicable.includes(step) ? (
                      <input
                        type="checkbox"
                        aria-label={`${STEP_LABELS[step]}: ${p.displayName}`}
                        checked={progress[p.id]?.[step] !== undefined}
                        title={progress[p.id]?.[step]}
                        onChange={(e) => {
                          onStep(p.id, step, e.target.checked);
                        }}
                      />
                    ) : (
                      <span aria-hidden="true">—</span>
                    )}
                  </td>
                ))}
                <td>{isDone(job, progress, p.id) ? 'Done' : ''}</td>
              </tr>
            );
          })}
      </tbody>
    </table>
  );
}
