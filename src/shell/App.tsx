import { useState, type ChangeEvent } from 'react';
import { APP_NAME } from '../core/app.ts';
import { partLocations } from '../core/documents/index.ts';
import { JobNameField } from './fields.tsx';
import { ImportSummary, SkippedWarning } from './ImportSummary.tsx';
import { JobList } from './JobList.tsx';
import { PlannedJob } from './PlannedJob.tsx';
import { ReimportDiff, ReimportLog, SparesList } from './ReimportDiff.tsx';
import { ScanMode } from './ScanMode.tsx';
import { SettingsScreen } from './SettingsScreen.tsx';
import { useJobSession } from './useJobSession.ts';
import { ARTIFACT, ReskinPrototype, variantParam } from './prototype-reskin/index.tsx';

/** The chosen file of a file input, which is then cleared so the same file can be chosen again. */
function takeFile(e: ChangeEvent<HTMLInputElement>): File | undefined {
  const file = e.target.files?.[0];
  e.target.value = '';
  return file;
}

export function App() {
  const session = useJobSession();
  const { state, actions } = session;
  const { open } = state;
  const job = open?.job ?? null;
  const [view, setView] = useState<'job' | 'settings' | 'scan'>('job');
  const schemaErrors = state.issues.filter((i) => i.kind === 'schema');

  // PROTOTYPE (reskin): dev builds, or any build with ?variant=, show the layout variants.
  if (import.meta.env.DEV || ARTIFACT || variantParam() !== null) return <ReskinPrototype session={session} />;

  const navButton = (to: typeof view, label: string) => (
    <button
      type="button"
      aria-pressed={view === to}
      onClick={() => {
        setView(to);
      }}
    >
      {label}
    </button>
  );
  const header = (
    <>
      <h1>{APP_NAME}</h1>
      <nav>
        {navButton('job', 'Job')} {navButton('settings', 'Machine settings')} {navButton('scan', 'Scan mode')}
      </nav>
    </>
  );

  if (view === 'settings') {
    return (
      <main>
        {header}
        <SettingsScreen settings={state.settings} sheets={open?.model.sheets ?? []} onSave={actions.saveSettings} />
      </main>
    );
  }

  if (view === 'scan') {
    const where = job ? partLocations(job.plan) : new Map<string, string>();
    return (
      <main>
        {header}
        {open && job ? (
          <ScanMode
            job={job}
            progress={open.doc.progress}
            shortId={open.doc.shortId}
            aliases={open.doc.idAliases}
            whereOf={(id) => where.get(id)}
            onTicked={actions.scanned}
          />
        ) : (
          <p>Open a planned Job to scan its labels.</p>
        )}
      </main>
    );
  }

  return (
    <main>
      {header}

      <p>
        <label>
          Load export{' '}
          <input
            type="file"
            accept=".json,application/json"
            onChange={(e) => {
              const file = takeFile(e);
              if (file) void actions.loadExport(file);
            }}
          />
        </label>{' '}
        <label>
          Open Job{' '}
          <input
            type="file"
            accept=".json,application/json"
            onChange={(e) => {
              const file = takeFile(e);
              if (file) void actions.openFile(file);
            }}
          />
        </label>
      </p>

      {state.storeError && (
        <p role="alert" className="error">
          {state.storeError}
        </p>
      )}

      <JobList
        jobs={state.jobs}
        openId={open?.doc.id ?? null}
        onOpen={(id) => void actions.openStored(id)}
        onArchive={(id, archived) => void actions.archive(id, archived)}
        onDelete={(id) => void actions.remove(id)}
      />

      {state.pendingReplace && (
        <div role="alertdialog" aria-label="Confirm replace" className="warning-box">
          <p>{state.pendingReplace.question}</p>
          <button type="button" onClick={actions.confirmReplace}>
            Replace
          </button>{' '}
          <button type="button" onClick={actions.cancelReplace}>
            Keep saved copy
          </button>
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

      {open && (
        <>
          <h2>
            {open.doc.name} <small>({open.doc.fileName})</small>
          </h2>
          <p>
            Short id <code>{open.doc.shortId}</code>
            {open.doc.archived && ' · archived'}
          </p>
          <JobNameField key={open.doc.name} name={open.doc.name} onCommit={actions.rename} />
          <SkippedWarning issues={state.issues} />
          <p>
            {job ? (
              <button type="button" onClick={actions.downloadDxfs}>
                Download DXFs
              </button>
            ) : (
              <button type="button" onClick={actions.plan}>
                Plan
              </button>
            )}{' '}
            <button type="button" onClick={actions.downloadJob}>
              Download Job
            </button>{' '}
            <label>
              Re-import export…{' '}
              <input
                type="file"
                accept=".json,application/json"
                onChange={(e) => {
                  const file = takeFile(e);
                  if (file) void actions.reimportFile(file);
                }}
              />
            </label>{' '}
            {open.doc.previous && (
              <button type="button" onClick={actions.revertReimport}>
                Revert last re-import
              </button>
            )}
          </p>
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
          {!job && <ImportSummary model={open.model} issues={state.issues} />}
          {job && <PlannedJob session={session} open={open} job={job} />}
        </>
      )}
    </main>
  );
}
