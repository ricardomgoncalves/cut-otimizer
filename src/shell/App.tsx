import { useState, type ChangeEvent, type ReactNode } from 'react';
import { APP_NAME } from '../core/app.ts';
import { partLocations } from '../core/documents/index.ts';
import { JobNameField } from './fields.tsx';
import { ImportSummary, SkippedWarning } from './ImportSummary.tsx';
import { JobList } from './JobList.tsx';
import { rollup } from '../core/progress.ts';
import { PlannedInspector, PlannedNotices, PlannedStage } from './PlannedJob.tsx';
import { sheetAnchor } from './sheet-anchor.ts';
import { ReimportDiff, ReimportLog, SparesList } from './ReimportDiff.tsx';
import { ScanMode } from './ScanMode.tsx';
import { SettingsScreen } from './SettingsScreen.tsx';
import { useJobSession } from './useJobSession.ts';

type View = 'job' | 'settings' | 'scan';

/** A file input shown as a button. The input keeps the label's name, so it can be found by it. */
function FileButton({ label, onFile }: { label: string; onFile: (file: File) => void }) {
  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // so the same file can be chosen again
    if (file) onFile(file);
  };
  return (
    <label className="file-button">
      {label}
      <input type="file" accept=".json,application/json" onChange={onChange} />
    </label>
  );
}

/** A 6px progress track. */
function Bar({ value, total }: { value: number; total: number }) {
  return (
    <div className="bar" aria-hidden>
      <i style={{ width: `${String(total === 0 ? 0 : (100 * value) / total)}%` }} />
    </div>
  );
}

/**
 * The Workbench: the top bar; Jobs, the open Job and its Sheets on the left; the drawings on the stage; what
 * needs attention, progress and documents in the inspector. Machine settings and Scan mode take the whole page.
 */
export function App() {
  const session = useJobSession();
  const { state, actions } = session;
  const { open } = state;
  const job = open?.job ?? null;
  const [view, setView] = useState<View>('job');
  const [currentSheet, setCurrentSheet] = useState<string | null>(null);
  const schemaErrors = state.issues.filter((i) => i.kind === 'schema');

  const topbar = (
    <header className="topbar">
      <h1>{APP_NAME}</h1>
      {open && <span className="crumb">/ {open.doc.name}</span>}
      <span className="spacer" />
      <FileButton label="Load export" onFile={(f) => void actions.loadExport(f)} />
      <FileButton label="Open Job" onFile={(f) => void actions.openFile(f)} />
      <nav>
        {(
          [
            ['job', 'Job'],
            ['settings', 'Machine settings'],
            ['scan', 'Scan mode'],
          ] as const
        ).map(([to, label]) => (
          <button
            key={to}
            type="button"
            aria-pressed={view === to}
            onClick={() => {
              setView(to);
            }}
          >
            {label}
          </button>
        ))}
      </nav>
    </header>
  );

  if (view !== 'job') {
    const where = job ? partLocations(job.plan) : new Map<string, string>();
    let main: ReactNode;
    if (view === 'settings')
      main = <SettingsScreen settings={state.settings} sheets={open?.model.sheets ?? []} onSave={actions.saveSettings} />;
    else if (open && job)
      main = (
        <ScanMode
          job={job}
          progress={open.doc.progress}
          shortId={open.doc.shortId}
          aliases={open.doc.idAliases}
          whereOf={(id) => where.get(id)}
          onTicked={actions.scanned}
        />
      );
    else main = <p className="muted">Open a planned Job to scan its labels.</p>;
    return (
      <div className="workbench single">
        {topbar}
        <main className="single-main">{main}</main>
      </div>
    );
  }

  const rolled = open && job ? rollup(job, open.doc.progress) : null;
  const plannedProps = open && job ? { session, open, job } : null;

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

  return (
    <div className="workbench">
      {topbar}

      <aside className="side" aria-label="Jobs and Sheets">
        <JobList
          jobs={state.jobs}
          openId={open?.doc.id ?? null}
          onOpen={(id) => void actions.openStored(id)}
          onArchive={(id, archived) => void actions.archive(id, archived)}
          onDelete={(id) => void actions.remove(id)}
        />
        {open && (
          <>
            <div className="panelhead">Open Job</div>
            <div className="pane">
              <JobNameField key={open.doc.name} name={open.doc.name} onCommit={actions.rename} />
              <div className="facts">
                <p>
                  File <code>{open.doc.fileName}</code>
                </p>
                <p>
                  Short id <code>{open.doc.shortId}</code>
                  {open.doc.archived && ' · archived'}
                </p>
                <p>
                  Parts <code>{open.model.parts.length}</code>
                </p>
              </div>
              <SkippedWarning issues={state.issues} />
              <div className="row" style={{ marginTop: 8 }}>
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
            </div>
          </>
        )}
        {job && rolled && (
          <>
            <div className="panelhead">Sheets</div>
            {job.plan.sheets.map((sheet) => {
              const roll = rolled.sheets.find((s) => s.sheetId === sheet.sheetId);
              const name = job.model.sheets.find((s) => s.id === sheet.sheetId)?.name;
              return (
                <button
                  key={sheet.sheetId}
                  type="button"
                  className="sheet-nav"
                  aria-current={currentSheet === sheet.sheetId ? 'true' : undefined}
                  onClick={() => {
                    setCurrentSheet(sheet.sheetId);
                    document.getElementById(sheetAnchor(sheet.code))?.scrollIntoView({ behavior: 'smooth' });
                  }}
                >
                  <span className="row" style={{ justifyContent: 'space-between' }}>
                    <span>
                      <code>{sheet.code}</code> <small>{name}</small>
                    </span>
                    <span className="tally">
                      {roll?.cut ?? 0}/{roll?.total ?? 0} Cut
                    </span>
                  </span>
                  <Bar value={roll?.cut ?? 0} total={roll?.total ?? 0} />
                </button>
              );
            })}
          </>
        )}
      </aside>

      <main className="stage" aria-label="Stage">
        {alerts}
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
        {!open && <p className="muted">Load an export to start a Job, or open one from the Jobs list.</p>}
        {open && !job && <ImportSummary model={open.model} issues={state.issues} />}
        {plannedProps && <PlannedStage {...plannedProps} />}
      </main>

      <aside className="inspector" aria-label="Inspector">
        {plannedProps && <PlannedNotices {...plannedProps} />}
        {open && (open.doc.reimportLog.length > 0 || open.doc.spares.length > 0) && (
          <div className="pane">
            <ReimportLog log={open.doc.reimportLog} />
            <SparesList spares={open.doc.spares} onDismiss={actions.dismissSpare} />
          </div>
        )}
        {rolled && (
          <>
            <div className="panelhead">
              <span>Done</span>
              <span className="tally">
                {rolled.job.done}/{rolled.job.total}
              </span>
            </div>
            <div className="pane">
              <Bar value={rolled.job.done} total={rolled.job.total} />
            </div>
          </>
        )}
        {plannedProps ? (
          <PlannedInspector {...plannedProps} />
        ) : (
          <p className="empty">{open ? 'Plan the Job to see its progress and documents here.' : 'No Job open.'}</p>
        )}
      </aside>
    </div>
  );
}

