/* eslint-disable react-refresh/only-export-components -- prototype */
// PROTOTYPE (reskin): the app's content split into pieces so each ?variant= can lay them out differently.
// Mostly copied from App.tsx and PlannedJob.tsx. Throwaway: fold the winner back into App/PlannedJob.
import type { ChangeEvent, ReactNode } from 'react';
import { APP_NAME } from '../../core/app.ts';
import { partLocations } from '../../core/documents/index.ts';
import { nestingQueue, partMode, pendingChoices, sheetCode, type Job } from '../../core/job.ts';
import { partNamer } from '../../core/model.ts';
import { reprintSelection, rollup, type Rollup } from '../../core/progress.ts';
import { settingsChanges } from '../../core/settings.ts';
import { CutSheetPanel } from '../CutSheetPanel.tsx';
import { JobNameField } from '../fields.tsx';
import { ImportSummary, SkippedWarning } from '../ImportSummary.tsx';
import { JobList } from '../JobList.tsx';
import { LabelsPanel } from '../LabelsPanel.tsx';
import { ProgressPanel } from '../ProgressPanel.tsx';
import { ReimportDiff, ReimportLog, SparesList } from '../ReimportDiff.tsx';
import { ScanMode } from '../ScanMode.tsx';
import { SETTING_LABELS } from '../setting-labels.ts';
import { SettingsScreen } from '../SettingsScreen.tsx';
import { SheetSection } from '../SheetSection.tsx';
import { ManualOpsList, SideBView } from '../SideBView.tsx';
import { STEP_LABELS } from '../step-labels.ts';
import { now, type JobSession, type OpenJob } from '../useJobSession.ts';

export type View = 'job' | 'settings' | 'scan';

function takeFile(e: ChangeEvent<HTMLInputElement>): File | undefined {
  const file = e.target.files?.[0];
  e.target.value = '';
  return file;
}

function FileButton({ label, onFile }: { label: string; onFile: (f: File) => void }) {
  return (
    <label className="small">
      {label}{' '}
      <input
        type="file"
        accept=".json,application/json"
        onChange={(e) => {
          const f = takeFile(e);
          if (f) onFile(f);
        }}
      />
    </label>
  );
}

export interface SheetPiece {
  id: string;
  code: string;
  name: string;
  cut: number;
  total: number;
  node: ReactNode;
}

export interface Planned {
  job: Job;
  rolled: Rollup;
  notices: ReactNode;
  noticeCount: number;
  cutSheet: ReactNode;
  labels: ReactNode;
  progress: ReactNode;
  manualOps: ReactNode;
  sheets: SheetPiece[];
  sideB: ReactNode;
}

export interface Pieces {
  title: string;
  nav: (view: View, setView: (v: View) => void) => ReactNode;
  loadControls: ReactNode;
  alerts: ReactNode;
  jobList: ReactNode;
  open: OpenJob | null;
  jobMeta: ReactNode;
  jobActions: ReactNode;
  reimport: ReactNode;
  importSummary: ReactNode;
  planned: Planned | null;
  settings: ReactNode;
  scan: ReactNode;
}

export function pieces(session: JobSession): Pieces {
  const { state, actions } = session;
  const { open } = state;
  const job = open?.job ?? null;
  const schemaErrors = state.issues.filter((i) => i.kind === 'schema');

  const nav = (view: View, setView: (v: View) => void) => (
    <nav>
      {(
        [
          ['job', 'Job'],
          ['settings', 'Machine settings'],
          ['scan', 'Scan mode'],
        ] as const
      ).map(([v, label]) => (
        <button
          key={v}
          type="button"
          aria-pressed={view === v}
          onClick={() => {
            setView(v);
          }}
        >
          {label}
        </button>
      ))}
    </nav>
  );

  const loadControls = (
    <div className="row">
      <FileButton label="Load export" onFile={(f) => void actions.loadExport(f)} />
      <FileButton label="Open Job" onFile={(f) => void actions.openFile(f)} />
    </div>
  );

  const alerts = (
    <>
      {state.storeError && (
        <p role="alert" className="error">
          {state.storeError}
        </p>
      )}
      {state.pendingReplace && (
        <div role="alertdialog" aria-label="Confirm replace" className="warning-box">
          <p>{state.pendingReplace.question}</p>
          <div className="row">
            <button type="button" className="primary" onClick={actions.confirmReplace}>
              Replace
            </button>
            <button type="button" onClick={actions.cancelReplace}>
              Keep saved copy
            </button>
          </div>
        </div>
      )}
      {state.loadError && (
        <div role="alert" className="error">
          <p>{state.loadError}</p>
          {schemaErrors.length > 0 && (
            <ul>
              {schemaErrors.map((i, k) => (
                <li key={k}>
                  <code>{i.path}</code> {i.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  );

  const jobList = (
    <JobList
      jobs={state.jobs}
      openId={open?.doc.id ?? null}
      onOpen={(id) => void actions.openStored(id)}
      onArchive={(id, archived) => void actions.archive(id, archived)}
      onDelete={(id) => void actions.remove(id)}
    />
  );

  const jobMeta = open && (
    <>
      <JobNameField key={open.doc.name} name={open.doc.name} onCommit={actions.rename} />
      <dl className="stats" style={{ marginTop: 6 }}>
        <dt>File</dt>
        <dd>{open.doc.fileName}</dd>
        <dt>Short id</dt>
        <dd>{open.doc.shortId}</dd>
        <dt>Parts</dt>
        <dd>{open.model.parts.length}</dd>
        <dt>Sheets</dt>
        <dd>{open.model.sheets.length}</dd>
        <dt>Owners</dt>
        <dd>{open.model.owners.length}</dd>
        {open.doc.archived && (
          <>
            <dt>State</dt>
            <dd>archived</dd>
          </>
        )}
      </dl>
      <SkippedWarning issues={state.issues} />
    </>
  );

  const jobActions = open && (
    <div className="row">
      {job ? (
        <button type="button" className="primary" onClick={actions.downloadDxfs}>
          Download DXFs
        </button>
      ) : (
        <button type="button" className="primary" onClick={actions.plan}>
          Plan
        </button>
      )}
      <button type="button" onClick={actions.downloadJob}>
        Download Job
      </button>
      <FileButton label="Re-import export…" onFile={(f) => void actions.reimportFile(f)} />
      {open.doc.previous && (
        <button type="button" onClick={actions.revertReimport}>
          Revert last re-import
        </button>
      )}
    </div>
  );

  const reimport = open && (
    <>
      {state.reimport && state.reviewDiff && (
        <ReimportDiff
          fileName={state.reimport.fileName}
          diff={state.reviewDiff}
          onUnpair={actions.unpair}
          onFixByHand={actions.fixByHand}
          onApply={actions.applyReimport}
          onCancel={actions.cancelReimport}
        />
      )}
      <ReimportLog log={open.doc.reimportLog} />
      <SparesList spares={open.doc.spares} onDismiss={actions.dismissSpare} />
    </>
  );

  const importSummary = open && !job && <ImportSummary model={open.model} issues={state.issues} />;

  const settings = (
    <SettingsScreen settings={state.settings} sheets={open?.model.sheets ?? []} onSave={actions.saveSettings} />
  );

  const where = job ? partLocations(job.plan) : new Map<string, string>();
  const scan =
    open && job ? (
      <ScanMode
        job={job}
        progress={open.doc.progress}
        shortId={open.doc.shortId}
        aliases={open.doc.idAliases}
        whereOf={(id) => where.get(id)}
        onTicked={actions.scanned}
      />
    ) : (
      <p className="muted">Open a planned Job to scan its labels.</p>
    );

  return {
    title: APP_NAME,
    nav,
    loadControls,
    alerts,
    jobList,
    open,
    jobMeta,
    jobActions,
    reimport,
    importSummary,
    planned: open && job ? plannedPieces(session, open, job) : null,
    settings,
    scan,
  };
}

function plannedPieces(session: JobSession, open: OpenJob, job: Job): Planned {
  const { state, actions } = session;
  const { doc } = open;
  const progress = doc.progress;
  const nameOf = partNamer(job.model);
  const sideBById = new Map(job.plan.sideB.flatMap((f) => f.partIds.map((id) => [id, f.id])));
  const sideBOf = (id: string) => sideBById.get(id);
  const where = partLocations(job.plan);
  const changed = settingsChanges(job.settings, state.settings);
  const pending = pendingChoices(job, progress);
  const queue = nestingQueue(job);
  const rolled = rollup(job, progress);
  const reprint = Object.keys(progress).length > 0 ? reprintSelection(job, progress) : null;
  const stale = doc.stale;
  const regenerate = (
    <button type="button" className="primary" onClick={actions.regenerate}>
      Regenerate
    </button>
  );

  const list: ReactNode[] = [];
  if (stale?.olderPlan)
    list.push(
      <div key="older" role="status" aria-label="Plan from an older version" className="stale warning-box">
        <p>
          This Job was saved by an older version of {APP_NAME}: its Plan lacks the Saw Parts, Offcuts, cuts, Side B
          files or Manual ops this version adds. Regenerate it before you use its files.
        </p>
        {regenerate}
      </div>,
    );
  if (stale && (!stale.olderPlan || stale.needsNesting.length > 0))
    list.push(
      <div key="stale" role="status" aria-label="Export updated" className="stale warning-box">
        <p>
          Export updated, {stale.needsNesting.length} {stale.needsNesting.length === 1 ? 'Part needs' : 'Parts need'}{' '}
          nesting. The Layouts are from the previous export until you regenerate.
        </p>
        {stale.needsNesting.length > 0 && (
          <ul>
            {stale.needsNesting.map((id) => (
              <li key={id}>{nameOf(id)}</li>
            ))}
          </ul>
        )}
        {regenerate}
      </div>,
    );
  if (!stale && queue.waiting.length > 0)
    list.push(
      <div key="queue" role="status" className="stale warning-box">
        <p>
          Parts that need nesting: {queue.waiting.map(nameOf).join(', ')}. Regenerate to nest them on a kept Offcut of a
          Locked Board, else in the Breakdown of the unlocked Boards.
        </p>
        {regenerate}
      </div>,
    );
  if (queue.requests.length > 0)
    list.push(
      <section key="nofit" aria-label="Parts that did not fit" className="warning-box">
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
      </section>,
    );
  if (state.pendingRemake)
    list.push(
      <div key="remake" role="alertdialog" aria-label="Confirm Remake" className="warning-box">
        <p>
          Remake {nameOf(state.pendingRemake)}? Its ticks are cleared, it stays greyed out on its old Blank, and it is
          nested again at the next regenerate.
        </p>
        <div className="row">
          <button
            type="button"
            className="primary"
            onClick={() => {
              if (state.pendingRemake) actions.remake(state.pendingRemake);
            }}
          >
            Remake
          </button>
          <button
            type="button"
            onClick={() => {
              actions.askRemake(null);
            }}
          >
            Cancel
          </button>
        </div>
      </div>,
    );
  if (pending.partModes.length > 0 || pending.sheetCodes.length > 0)
    list.push(
      <div key="pending" role="status" aria-label="Changes wait for Regenerate" className="stale">
        <p>
          {[
            ...pending.partModes.map((id) => `${nameOf(id)} to the ${partMode(job, id) === 'saw' ? 'saw' : 'CNC'}`),
            ...pending.sheetCodes.map((id) => `Sheet code ${sheetCode(job, id)}`),
          ].join(', ')}
          : the Plan and its files change when you regenerate.
        </p>
        {regenerate}
      </div>,
    );
  if (changed.length > 0)
    list.push(
      <div key="settings" role="status" className="stale">
        <p>
          This Job was generated with different Machine settings ({changed.map((k) => SETTING_LABELS[k]).join(', ')}).
          Its files keep the old settings until you regenerate it.
          {rolled.boards.some((b) => b.locked) &&
            ' Locked Blanks (with a Part ticked Cut) stay exactly as they are, and Locked Boards keep their Breakdown; only the rest is planned again.'}
        </p>
        {regenerate}
      </div>,
    );
  if (state.codeError)
    list.push(
      <p key="code" role="alert" className="error">
        {state.codeError}
      </p>,
    );
  if (state.pendingUntick)
    list.push(
      <div key="untick" role="alertdialog" aria-label="Confirm untick" className="warning-box">
        <p>
          Unticking {STEP_LABELS[state.pendingUntick.step]} on {nameOf(state.pendingUntick.partId)} would unlock{' '}
          {state.pendingUntick.unlocks.join(' and ')}: nothing else on{' '}
          {state.pendingUntick.unlocks.length > 1 ? 'them' : 'it'} is ticked Cut.
        </p>
        <div className="row">
          <button type="button" className="primary" onClick={actions.confirmUntick}>
            Untick
          </button>
          <button type="button" onClick={actions.cancelUntick}>
            Keep ticked
          </button>
        </div>
      </div>,
    );

  const sheets: SheetPiece[] = job.plan.sheets.map((sheet) => {
    const roll = rolled.sheets.find((s) => s.sheetId === sheet.sheetId);
    return {
      id: sheet.sheetId,
      code: sheet.code,
      name: job.model.sheets.find((s) => s.id === sheet.sheetId)?.name ?? '',
      cut: roll?.cut ?? 0,
      total: roll?.total ?? 0,
      node: (
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
      ),
    };
  });

  return {
    job,
    rolled,
    notices: list.length > 0 ? <>{list}</> : null,
    noticeCount: list.length,
    cutSheet: (
      <CutSheetPanel
        plan={job.plan}
        job={{
          name: doc.name,
          shortId: doc.shortId,
          model: job.model,
          skipped: state.issues.flatMap((i) =>
            i.kind === 'skipped' ? [{ label: i.label, name: i.name, reason: i.reason }] : [],
          ),
          spares: doc.spares,
          reimportLog: doc.reimportLog,
        }}
        reprint={reprint}
      />
    ),
    labels: (
      <LabelsPanel
        plan={job.plan}
        job={{ name: doc.name, shortId: doc.shortId, model: job.model }}
        reimportBatch={doc.reimportLog.at(-1)?.labelIds ?? []}
        reprint={reprint?.parts ?? null}
      />
    ),
    progress: <ProgressPanel rollup={rolled} owners={job.model.owners} />,
    manualOps: <ManualOpsList ops={job.plan.manualOps} nameOf={nameOf} />,
    sheets,
    sideB: (
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
    ),
  };
}

/** A 6px progress track filled with the accent. */
export function Bar({ value, total }: { value: number; total: number }) {
  return (
    <div className="progress" aria-hidden>
      <i style={{ width: `${String(total === 0 ? 0 : (100 * value) / total)}%` }} />
    </div>
  );
}
