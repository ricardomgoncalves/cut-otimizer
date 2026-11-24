import { APP_NAME } from '../core/app.ts';
import { partLocations } from '../core/documents/index.ts';
import { nestingQueue, partMode, pendingChoices, sheetCode, snapshotChanges, type Job } from '../core/job.ts';
import { partNamer } from '../core/model.ts';
import { reprintSelection, rollup } from '../core/progress.ts';
import { CutSheetPanel } from './CutSheetPanel.tsx';
import { LabelsPanel } from './LabelsPanel.tsx';
import { ProgressPanel } from './ProgressPanel.tsx';
import { SETTING_LABELS } from './setting-labels.ts';
import { SheetSection } from './SheetSection.tsx';
import { ManualOpsList, SideBView } from './SideBView.tsx';
import { STEP_LABELS } from './step-labels.ts';
import { now, type JobSession, type OpenJob } from './useJobSession.ts';

interface Props {
  session: JobSession;
  open: OpenJob;
  job: Job;
}

/**
 * The planned Job: what waits for Regenerate, confirmations, the cut sheet and labels, progress, and each
 * Sheet's Breakdowns, Layouts and Parts, then the Side B files.
 */
export function PlannedJob({ session, open, job }: Props) {
  const { state, actions } = session;
  const { doc } = open;
  const progress = doc.progress;
  const nameOf = partNamer(job.model);
  const sideBById = new Map(job.plan.sideB.flatMap((f) => f.partIds.map((id) => [id, f.id])));
  const sideBOf = (id: string) => sideBById.get(id);
  const where = partLocations(job.plan);
  const changed = snapshotChanges(job, state.settings);
  const pending = pendingChoices(job, progress);
  const queue = nestingQueue(job);
  const rolled = rollup(job, progress);
  // Once anything is ticked, the PDF and labels can be limited to what isn't Locked or Done.
  const reprint = Object.keys(progress).length > 0 ? reprintSelection(job, progress) : null;
  const stale = doc.stale;
  const regenerate = (
    <button type="button" onClick={actions.regenerate}>
      Regenerate
    </button>
  );

  return (
    <>
      {stale?.olderPlan && (
        <div role="status" aria-label="Plan from an older version" className="stale warning-box">
          <p>
            This Job was saved by an older version of {APP_NAME}: its Plan lacks the Saw Parts, Offcuts, cuts, Side B
            files or Manual ops this version adds. Regenerate it before you use its files.
          </p>
          {regenerate}
        </div>
      )}
      {stale && (!stale.olderPlan || stale.needsNesting.length > 0) && (
        <div role="status" aria-label="Export updated" className="stale warning-box">
          <p>
            Export updated, {stale.needsNesting.length} {stale.needsNesting.length === 1 ? 'Part needs' : 'Parts need'}{' '}
            nesting. The Layouts below are from the previous export until you regenerate.
          </p>
          {stale.needsNesting.length > 0 && (
            <ul>
              {stale.needsNesting.map((id) => (
                <li key={id}>{nameOf(id)}</li>
              ))}
            </ul>
          )}
          {regenerate}
        </div>
      )}
      {!stale && queue.waiting.length > 0 && (
        <div role="status" className="stale warning-box">
          <p>
            Parts that need nesting: {queue.waiting.map(nameOf).join(', ')}. Regenerate to nest them on a kept Offcut of a
            Locked Board, else in the Breakdown of the unlocked Boards.
          </p>
          {regenerate}
        </div>
      )}
      {queue.requests.length > 0 && (
        <section aria-label="Parts that did not fit" className="warning-box">
          <h3>Parts that did not fit</h3>
          {queue.requests.map((r) => (
            <div key={r.sheetId}>
              <p>
                {r.code}: {r.partIds.map(nameOf).join(', ')} fit no kept Offcut of a Locked Board and no unlocked Board.
                Add a Board?
              </p>
              <button
                type="button"
                onClick={() => {
                  actions.addBoards(r.sheetId);
                }}
              >
                Add {r.first === r.last ? `Board ${String(r.first)}` : `Boards ${String(r.first)}–${String(r.last)}`} of{' '}
                {r.last} to {r.code}
              </button>
            </div>
          ))}
        </section>
      )}
      {state.pendingRemake && (
        <div role="alertdialog" aria-label="Confirm Remake" className="warning-box">
          <p>
            Remake {nameOf(state.pendingRemake)}? Its ticks are cleared, it stays greyed out on its old Blank, and it is
            nested again at the next regenerate.
          </p>
          <button
            type="button"
            onClick={() => {
              if (state.pendingRemake) actions.remake(state.pendingRemake);
            }}
          >
            Remake
          </button>{' '}
          <button
            type="button"
            onClick={() => {
              actions.askRemake(null);
            }}
          >
            Cancel
          </button>
        </div>
      )}
      {(pending.partModes.length > 0 || pending.sheetCodes.length > 0) && (
        <div role="status" aria-label="Changes wait for Regenerate" className="stale">
          <p>
            {[
              ...pending.partModes.map((id) => `${nameOf(id)} to the ${partMode(job, id) === 'saw' ? 'saw' : 'CNC'}`),
              ...pending.sheetCodes.map((id) => `Sheet code ${sheetCode(job, id)}`),
            ].join(', ')}
            : the Plan and its files change when you regenerate.
          </p>
          {regenerate}
        </div>
      )}
      {changed.length > 0 && (
        <div role="status" className="stale">
          <p>
            This Job was generated with different Machine settings ({changed.map((k) => SETTING_LABELS[k]).join(', ')}).
            Its files keep the old settings until you regenerate it.
            {rolled.boards.some((b) => b.locked) &&
              ' Locked Blanks (with a Part ticked Cut) stay exactly as they are, and Locked Boards keep their Breakdown; only the rest is planned again.'}
          </p>
          {regenerate}
        </div>
      )}
      {state.codeError && (
        <p role="alert" className="error">
          {state.codeError}
        </p>
      )}
      {state.pendingUntick && (
        <div role="alertdialog" aria-label="Confirm untick" className="warning-box">
          <p>
            Unticking {STEP_LABELS[state.pendingUntick.step]} on {nameOf(state.pendingUntick.partId)} would unlock{' '}
            {state.pendingUntick.unlocks.join(' and ')}: nothing else on{' '}
            {state.pendingUntick.unlocks.length > 1 ? 'them' : 'it'} is ticked Cut.
          </p>
          <button type="button" onClick={actions.confirmUntick}>
            Untick
          </button>{' '}
          <button type="button" onClick={actions.cancelUntick}>
            Keep ticked
          </button>
        </div>
      )}
      <CutSheetPanel
        plan={job.plan}
        job={{
          name: doc.name,
          shortId: doc.shortId,
          model: job.model,
          skipped: state.issues.flatMap((i) => (i.kind === 'skipped' ? [{ label: i.label, name: i.name, reason: i.reason }] : [])),
          spares: doc.spares,
          reimportLog: doc.reimportLog,
        }}
        reprint={reprint}
      />
      <LabelsPanel
        plan={job.plan}
        job={{ name: doc.name, shortId: doc.shortId, model: job.model }}
        reimportBatch={doc.reimportLog.at(-1)?.labelIds ?? []}
        reprint={reprint?.parts ?? null}
      />
      <ProgressPanel rollup={rolled} owners={job.model.owners} />
      <ManualOpsList ops={job.plan.manualOps} nameOf={nameOf} />
      {job.plan.sheets.map((sheet) => (
        <SheetSection
          key={sheet.sheetId}
          job={job}
          sheet={sheet}
          progress={progress}
          rolled={rolled}
          nameOf={nameOf}
          sideBOf={sideBOf}
          where={where}
          needsNesting={[...(stale?.needsNesting ?? []), ...queue.waiting]}
          actions={actions}
        />
      ))}
      <SideBView
        files={job.plan.sideB}
        job={doc.shortId}
        nameOf={nameOf}
        whereOf={(id) => where.get(id)}
        onDownload={actions.downloadSideB}
        onDone={(file) => {
          actions.progress({ kind: 'sideBDone', fileId: file.id, at: now() });
        }}
        doneOf={(file) => rolled.sideB.find((f) => f.id === file.id)?.done ?? 0}
      />
    </>
  );
}
