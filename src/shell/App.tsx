import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { APP_NAME } from '../core/app.ts';
import { sideBFileName, toDxfFiles } from '../core/dxf/index.ts';
import { importExport, type ImportIssue } from '../core/import/index.ts';
import {
  addBoards,
  generateJob,
  needsNesting,
  regenerate,
  remake,
  setOffcutDiscarded,
  setPartMode,
  setSheetCode,
  sheetCode,
  snapshotChanges,
  type Job,
} from '../core/job.ts';
import {
  createJobDocument,
  dismissSpare,
  fromJobFile,
  jobFileName,
  openJobDocument,
  renameJob,
  setArchived,
  shortIdFor,
  toJobFile,
  withJob,
  withProgress,
  type JobDocument,
} from '../core/job-store/document.ts';
import type { JobSummary } from '../core/job-store/store.ts';
import type { Model, Part } from '../core/model.ts';
import { isLive, type PartMode, type SawReason, type SheetPlan, type SideBFile } from '../core/planner/index.ts';
import {
  apply,
  boardId,
  isDone,
  rollup,
  steps,
  STEPS,
  wouldUnlock,
  type Progress,
  type ProgressEvent,
  type Step,
} from '../core/progress.ts';
import { applyReimport, diff, revertReimport, voidText, type Unpair } from '../core/reimport.ts';
import type { Settings } from '../core/settings.ts';
import { BlankLayout } from './BlankLayout.tsx';
import { BoardBreakdown } from './BoardBreakdown.tsx';
import { CutSheetPanel } from './CutSheetPanel.tsx';
import { LabelsPanel } from './LabelsPanel.tsx';
import { downloadBytes, safeFileName, zipFiles } from './download.ts';
import { ImportSummary, SkippedWarning } from './ImportSummary.tsx';
import { createDexieJobStore } from './job-store-dexie.ts';
import { JobList } from './JobList.tsx';
import { PartDetail } from './PartDetail.tsx';
import { ReimportDiff, ReimportLog, SparesList } from './ReimportDiff.tsx';
import { ProgressPanel } from './ProgressPanel.tsx';
import { ScanMode } from './ScanMode.tsx';
import { SETTING_LABELS } from './setting-labels.ts';
import { SettingsScreen } from './SettingsScreen.tsx';
import { ManualOpsList, SideBView } from './SideBView.tsx';
import { loadSettings, saveSettings } from './settings-store.ts';
import { STEP_LABELS } from './step-labels.ts';

/** Every Job lives in IndexedDB; every change to the open Job is saved straight away. */
const store = createDexieJobStore();

/**
 * The Job open in the page: its stored document, the model Import rebuilt from its raw export, and
 * the planned Job (null while the maker reviews the import summary).
 */
interface OpenJob {
  doc: JobDocument;
  model: Model;
  job: Job | null;
}

/** An updated export loaded into the open Job, under review in the diff screen. */
interface PendingReimport {
  fileName: string;
  rawExport: string;
  model: Model;
  unpaired: Unpair[];
  /** New ids of Changed (cut) Parts already cut that the maker fixes by hand instead of remaking. */
  fixByHand: string[];
}

/** localStorage key of the Job to reopen after a reload. */
const OPEN_JOB_KEY = 'cut-optimizer.open-job';

function rememberOpenJob(id: string | null) {
  try {
    if (id === null) localStorage.removeItem(OPEN_JOB_KEY);
    else localStorage.setItem(OPEN_JOB_KEY, id);
  } catch {
    // Reopening the last Job on reload is a convenience only.
  }
}

function lastOpenJob(): string | null {
  try {
    return localStorage.getItem(OPEN_JOB_KEY);
  } catch {
    return null;
  }
}

const now = () => new Date().toISOString();
const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function App() {
  const [open, setOpen] = useState<OpenJob | null>(null);
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [issues, setIssues] = useState<ImportIssue[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [storeError, setStoreError] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [view, setView] = useState<'job' | 'settings' | 'scan'>('job');
  const [codeError, setCodeError] = useState<string | null>(null);
  /** An untick waiting for confirmation because it would unlock these Board and Blank ids. */
  const [pendingUntick, setPendingUntick] = useState<{ partId: string; step: Step; unlocks: string[] } | null>(null);
  const [pendingRemake, setPendingRemake] = useState<string | null>(null);
  const [reimport, setReimport] = useState<PendingReimport | null>(null);

  useEffect(() => {
    let current = true;
    void (async () => {
      try {
        const list = await store.list();
        if (!current) return;
        setJobs(list);
        const last = lastOpenJob();
        const doc = last === null ? undefined : await store.get(last);
        if (!current || !doc) return;
        const opened = openJobDocument(doc);
        if ('error' in opened) {
          setLoadError(opened.error);
          return;
        }
        setOpen({ doc, model: opened.model, job: opened.job });
        setIssues(opened.issues);
      } catch (err) {
        if (current) setStoreError(`The saved Jobs could not be read: ${errorText(err)}`);
      }
    })();
    return () => {
      current = false;
    };
  }, []);

  async function refreshJobs() {
    setJobs(await store.list());
  }

  /** Makes `doc` the open Job and saves it. */
  function save(doc: JobDocument, model: Model, job: Job | null) {
    setOpen({ doc, model, job });
    rememberOpenJob(doc.id);
    store
      .put(doc)
      .then(() => {
        setStoreError(null);
        return refreshJobs();
      })
      .catch((err: unknown) => {
        setStoreError(`This Job could not be saved in the browser: ${errorText(err)}. Download it to keep it.`);
      });
  }

  function resetMessages() {
    setPendingUntick(null);
    setReimport(null);
    setIssues([]);
    setLoadError(null);
    setCodeError(null);
  }

  async function onLoad(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setOpen(null);
    resetMessages();

    const text = await file.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch (err) {
      setLoadError(`${file.name} is not JSON: ${errorText(err)}`);
      return;
    }
    const result = importExport(json);
    setIssues(result.issues);
    if (!result.model) {
      setLoadError(`${file.name} is not a valid Parts Export v1. Nothing was loaded.`);
      return;
    }
    const id = crypto.randomUUID();
    const shortId = shortIdFor(
      id,
      jobs.map((j) => j.shortId),
    );
    const doc = createJobDocument({
      id,
      shortId,
      rawExport: text,
      fileName: file.name,
      model: result.model,
      settings,
      now: now(),
    });
    save(doc, result.model, null);
  }

  function onPlan() {
    if (!open) return;
    const job = generateJob(open.model, settings, open.doc.sheetCodes, open.doc.sawCncOverrides);
    save(withJob(open.doc, job, now()), open.model, job);
  }

  /** Loads an updated export into the open Job and shows the diff screen. Nothing changes until Apply. */
  async function onReimportFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !open) return;
    setReimport(null);
    setLoadError(null);
    const text = await file.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch (err) {
      setLoadError(`${file.name} is not JSON: ${errorText(err)}`);
      return;
    }
    const result = importExport(json);
    if (!result.model) {
      setIssues(result.issues);
      setLoadError(`${file.name} is not a valid Parts Export v1. The Job is unchanged.`);
      return;
    }
    setReimport({ fileName: file.name, rawExport: text, model: result.model, unpaired: [], fixByHand: [] });
  }

  /** Applies the reviewed re-import, all or nothing, and reopens the Job from its new document. */
  function onApplyReimport() {
    if (!open || !reimport) return;
    const doc = applyReimport(open.doc, open.model, reimport, reviewDiff(open, reimport), now());
    setReimport(null);
    reopen(doc);
  }

  function onDismissSpare(partId: string) {
    if (!open) return;
    save(dismissSpare(open.doc, partId, now()), open.model, open.job);
  }

  function onRevertReimport() {
    if (!open) return;
    const doc = revertReimport(open.doc);
    if (doc) reopen(doc);
  }

  /** Saves a document whose raw export changed, rebuilding its model and issues. */
  function reopen(doc: JobDocument) {
    const opened = openJobDocument(doc);
    if ('error' in opened) {
      setLoadError(opened.error);
      return;
    }
    setPendingUntick(null);
    setIssues(opened.issues);
    save(doc, opened.model, opened.job);
  }

  /** Opens a Job document: shows it, and saves it when it came from a file. */
  function openDocument(doc: JobDocument, persist: boolean) {
    const opened = openJobDocument(doc);
    if ('error' in opened) {
      setLoadError(opened.error);
      return;
    }
    setIssues(opened.issues);
    if (persist) save(doc, opened.model, opened.job);
    else {
      setOpen({ doc, model: opened.model, job: opened.job });
      rememberOpenJob(doc.id);
    }
  }

  async function onOpenFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    resetMessages();
    const read = fromJobFile(await file.text());
    if ('error' in read) {
      setLoadError(`${file.name}: ${read.error}`);
      return;
    }
    // The same Job (same UUID) replaces its saved copy. Another Job's short id is never reused.
    let doc = read.doc;
    const taken = jobs.filter((j) => j.id !== doc.id).map((j) => j.shortId);
    if (taken.includes(doc.shortId)) doc = { ...doc, shortId: shortIdFor(doc.id, taken) };
    openDocument(doc, true);
  }

  async function onOpenStored(id: string) {
    resetMessages();
    try {
      const doc = await store.get(id);
      if (doc) openDocument(doc, false);
    } catch (err) {
      setLoadError(errorText(err));
    }
  }

  async function onArchive(id: string, archived: boolean) {
    try {
      if (open?.doc.id === id) {
        save(setArchived(open.doc, archived, now()), open.model, open.job);
        return;
      }
      const doc = await store.get(id);
      if (!doc) return;
      await store.put(setArchived(doc, archived, now()));
      await refreshJobs();
    } catch (err) {
      setStoreError(errorText(err));
    }
  }

  async function onDelete(id: string) {
    try {
      await store.delete(id);
      if (open?.doc.id === id) {
        setOpen(null);
        resetMessages();
        rememberOpenJob(null);
      }
      await refreshJobs();
    } catch (err) {
      setStoreError(errorText(err));
    }
  }

  function onRename(name: string) {
    if (!open) return;
    const doc = renameJob(open.doc, name, now());
    if (doc !== open.doc) save(doc, open.model, open.job);
  }

  function onSaveSettings(next: Settings): boolean {
    setSettings(next);
    return saveSettings(next);
  }

  function onRegenerate() {
    if (!open?.job) return;
    const job = regenerate(open.job, settings, open.doc.progress);
    save(withJob(open.doc, job, now()), open.model, job);
  }

  /** Marks a ruined Part Remake (after confirmation): ticks cleared, greyed on its old Blank, nested at regenerate. */
  function onRemake(partId: string) {
    if (!open?.job) return;
    const result = remake(open.job, open.doc.progress, partId);
    if ('error' in result) {
      setCodeError(result.error);
      return;
    }
    setCodeError(null);
    // Not a re-plan: only marks in the stored Plan change, so a pending re-import stays revertable.
    const at = now();
    save(withProgress({ ...open.doc, plan: result.job.plan, updatedAt: at }, result.progress, at), open.model, result.job);
  }

  function onDiscard(offcutId: string, discarded: boolean) {
    if (!open?.job) return;
    const result = setOffcutDiscarded(open.job, offcutId, discarded);
    if ('error' in result) {
      setCodeError(result.error);
      return;
    }
    setCodeError(null);
    save({ ...open.doc, plan: result.job.plan, updatedAt: now() }, open.model, result.job);
  }

  /** The person agreed to more Boards for a Sheet whose Parts fit nowhere else. */
  function onAddBoards(sheetId: string) {
    if (!open?.job) return;
    const job = addBoards(open.job, [sheetId], open.doc.progress);
    save(withJob(open.doc, job, now()), open.model, job);
  }

  function onSheetCode(sheetId: string, code: string) {
    if (!open?.job) return;
    const result = setSheetCode(open.job, sheetId, code, open.doc.progress);
    if ('error' in result) {
      setCodeError(result.error);
      return;
    }
    setCodeError(null);
    save(withJob(open.doc, result.job, now()), open.model, result.job);
  }

  function onPartMode(partId: string, mode: PartMode) {
    if (!open?.job) return;
    const result = setPartMode(open.job, partId, mode, open.doc.progress);
    if ('error' in result) {
      setCodeError(result.error);
      return;
    }
    setCodeError(null);
    save(withJob(open.doc, result.job, now()), open.model, result.job);
  }

  /** Applies a tick, untick or bulk tick to the open Job and saves it. */
  function onProgress(event: ProgressEvent) {
    if (!open?.job) return;
    const progress = apply(open.job, open.doc.progress, event);
    if (progress !== open.doc.progress) save(withProgress(open.doc, progress, now()), open.model, open.job);
  }

  /** Ticks or unticks one Step. Unticking asks first when it would unlock a Board or Blank. */
  function onStep(partId: string, step: Step, ticked: boolean) {
    if (!open?.job) return;
    setPendingUntick(null);
    if (ticked) {
      onProgress({ kind: 'tick', partId, step, at: now() });
      return;
    }
    const unlocks = wouldUnlock(open.job, open.doc.progress, partId, step);
    if (unlocks.length > 0) setPendingUntick({ partId, step, unlocks });
    else onProgress({ kind: 'untick', partId, step });
  }

  function onDownload() {
    if (!open?.job) return;
    const zip = zipFiles(toDxfFiles(open.job.plan, open.doc.shortId));
    downloadBytes(zip, `${safeFileName(open.model.projectName)}.dxf.zip`, 'application/zip');
  }

  function onDownloadSideB(file: SideBFile) {
    if (!open?.job) return;
    const name = sideBFileName(open.doc.shortId, file);
    const text = toDxfFiles(open.job.plan, open.doc.shortId).get(name);
    if (text !== undefined) downloadBytes(new TextEncoder().encode(text), name, 'application/dxf');
  }

  function onDownloadJob() {
    if (!open) return;
    const bytes = new TextEncoder().encode(toJobFile(open.doc));
    downloadBytes(bytes, safeFileName(jobFileName(open.doc)), 'application/json');
  }

  const job = open?.job ?? null;

  const schemaErrors = issues.filter((i) => i.kind === 'schema');
  const partById = new Map<string, Part>(job?.model.parts.map((p) => [p.id, p]) ?? []);
  const nameOf = (id: string) => partById.get(id)?.displayName ?? id;
  const sideBById = new Map(job?.plan.sideB.flatMap((f) => f.partIds.map((id) => [id, f.id])) ?? []);
  const sideBOf = (id: string) => sideBById.get(id);
  const whereById = job ? partLocations(job.plan.sheets) : new Map<string, string>();
  const changed = job ? snapshotChanges(job, settings) : [];
  const progress: Progress = open?.doc.progress ?? {};
  // Parts on no Board yet (Remakes not nested again): the next regenerate nests them.
  const overflowIds = new Set(job?.plan.sheets.flatMap((s) => s.overflow ?? []) ?? []);
  const waiting = job ? needsNesting(job).filter((id) => !overflowIds.has(id)) : [];
  const rolled = job ? rollup(job, progress) : null;
  const blankRoll = new Map(rolled?.blanks.map((b) => [b.id, b]) ?? []);

  const header = (
    <>
      <h1>{APP_NAME}</h1>
      <nav>
        <button
          type="button"
          aria-pressed={view === 'job'}
          onClick={() => {
            setView('job');
          }}
        >
          Job
        </button>{' '}
        <button
          type="button"
          aria-pressed={view === 'settings'}
          onClick={() => {
            setView('settings');
          }}
        >
          Machine settings
        </button>{' '}
        <button
          type="button"
          aria-pressed={view === 'scan'}
          onClick={() => {
            setView('scan');
          }}
        >
          Scan mode
        </button>
      </nav>
    </>
  );

  if (view === 'settings') {
    return (
      <main>
        {header}
        <SettingsScreen settings={settings} sheets={open?.model.sheets ?? []} onSave={onSaveSettings} />
      </main>
    );
  }

  if (view === 'scan') {
    return (
      <main>
        {header}
        {open && job ? (
          <ScanMode
            job={job}
            progress={progress}
            shortId={open.doc.shortId}
            aliases={open.doc.idAliases}
            whereOf={(id) => whereById.get(id)}
            onTicked={(next) => {
              save(withProgress(open.doc, next, now()), open.model, job);
            }}
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
          Load export <input type="file" accept=".json,application/json" onChange={(e) => void onLoad(e)} />
        </label>{' '}
        <label>
          Open Job <input type="file" accept=".json,application/json" onChange={(e) => void onOpenFile(e)} />
        </label>
      </p>

      {storeError && (
        <p role="alert" className="error">
          {storeError}
        </p>
      )}

      <JobList
        jobs={jobs}
        openId={open?.doc.id ?? null}
        onOpen={(id) => void onOpenStored(id)}
        onArchive={(id, archived) => void onArchive(id, archived)}
        onDelete={(id) => void onDelete(id)}
      />

      {loadError && (
        <div role="alert" className="error">
          <p>{loadError}</p>
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
          <JobNameField key={open.doc.name} name={open.doc.name} onCommit={onRename} />
          <SkippedWarning issues={issues} />
          <p>
            {job ? (
              <button type="button" onClick={onDownload}>
                Download DXFs
              </button>
            ) : (
              <button type="button" onClick={onPlan}>
                Plan
              </button>
            )}{' '}
            <button type="button" onClick={onDownloadJob}>
              Download Job
            </button>{' '}
            <label>
              Re-import export…{' '}
              <input type="file" accept=".json,application/json" onChange={(e) => void onReimportFile(e)} />
            </label>{' '}
            {open.doc.previous && (
              <button type="button" onClick={onRevertReimport}>
                Revert last re-import
              </button>
            )}
          </p>
          {reimport && (
            <ReimportDiff
              fileName={reimport.fileName}
              diff={reviewDiff(open, reimport)}
              onUnpair={(entry) => {
                if (entry.oldId === undefined || entry.newId === undefined) return;
                const pair = { oldId: entry.oldId, newId: entry.newId };
                setReimport({ ...reimport, unpaired: [...reimport.unpaired, pair] });
              }}
              onFixByHand={(entry, fix) => {
                const id = entry.newId;
                if (id === undefined) return;
                const others = reimport.fixByHand.filter((x) => x !== id);
                setReimport({ ...reimport, fixByHand: fix ? [...others, id] : others });
              }}
              onApply={onApplyReimport}
              onCancel={() => {
                setReimport(null);
              }}
            />
          )}
          <ReimportLog log={open.doc.reimportLog} />
          <SparesList spares={open.doc.spares} onDismiss={onDismissSpare} />
          {!job && <ImportSummary model={open.model} issues={issues} />}
        </>
      )}

      {job && (
        <>
          {open?.doc.stale?.olderPlan && (
            <div role="status" aria-label="Plan from an older version" className="stale warning-box">
              <p>
                This Job was saved by an older version of {APP_NAME}: its Plan lacks the Saw Parts, Offcuts, cuts, Side
                B files or Manual ops this version adds. Regenerate it before you use its files.
              </p>
              <button type="button" onClick={onRegenerate}>
                Regenerate
              </button>
            </div>
          )}
          {open?.doc.stale && (!open.doc.stale.olderPlan || open.doc.stale.needsNesting.length > 0) && (
            <div role="status" aria-label="Export updated" className="stale warning-box">
              <p>
                Export updated, {open.doc.stale.needsNesting.length}{' '}
                {open.doc.stale.needsNesting.length === 1 ? 'Part needs' : 'Parts need'} nesting. The Layouts below
                are from the previous export until you regenerate.
              </p>
              {open.doc.stale.needsNesting.length > 0 && (
                <ul>
                  {open.doc.stale.needsNesting.map((id) => (
                    <li key={id}>{nameOf(id)}</li>
                  ))}
                </ul>
              )}
              <button type="button" onClick={onRegenerate}>
                Regenerate
              </button>
            </div>
          )}
          {!open?.doc.stale && waiting.length > 0 && (
            <div role="status" className="stale warning-box">
              <p>
                Parts that need nesting: {waiting.map(nameOf).join(', ')}. Regenerate to nest them on a kept Offcut
                of a Locked Board, else in the Breakdown of the unlocked Boards.
              </p>
              <button type="button" onClick={onRegenerate}>
                Regenerate
              </button>
            </div>
          )}
          {job.plan.sheets.some((s) => (s.overflow ?? []).length > 0) && (
            <section aria-label="Parts that did not fit" className="warning-box">
              <h3>Parts that did not fit</h3>
              {job.plan.sheets
                .filter((s) => (s.overflow ?? []).length > 0)
                .map((s) => {
                  const n = s.boards.length;
                  const extra = Math.max(1, s.extraBoards ?? 1);
                  const which = extra === 1 ? `Board ${String(n + 1)}` : `Boards ${String(n + 1)}–${String(n + extra)}`;
                  return (
                    <div key={s.sheetId}>
                      <p>
                        {s.code}: {(s.overflow ?? []).map(nameOf).join(', ')} fit no kept Offcut of a Locked Board and
                        no unlocked Board. Add a Board?
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          onAddBoards(s.sheetId);
                        }}
                      >
                        Add {which} of {n + extra} to {s.code}
                      </button>
                    </div>
                  );
                })}
            </section>
          )}
          {pendingRemake && (
            <div role="alertdialog" aria-label="Confirm Remake" className="warning-box">
              <p>
                Remake {nameOf(pendingRemake)}? Its ticks are cleared, it stays greyed out on its old Blank, and it is
                nested again at the next regenerate.
              </p>
              <button
                type="button"
                onClick={() => {
                  setPendingRemake(null);
                  onRemake(pendingRemake);
                }}
              >
                Remake
              </button>{' '}
              <button
                type="button"
                onClick={() => {
                  setPendingRemake(null);
                }}
              >
                Cancel
              </button>
            </div>
          )}
          {changed.length > 0 && (
            <div role="status" className="stale">
              <p>
                This Job was generated with different Machine settings (
                {changed.map((k) => SETTING_LABELS[k]).join(', ')}). Its files keep the old settings until
                you regenerate it.
                {rolled?.boards.some((b) => b.locked) &&
                  ' Locked Blanks (with a Part ticked Cut) stay exactly as they are, and Locked Boards keep their Breakdown; only the rest is planned again.'}
              </p>
              <button type="button" onClick={onRegenerate}>
                Regenerate
              </button>
            </div>
          )}
          {codeError && (
            <p role="alert" className="error">
              {codeError}
            </p>
          )}
          {pendingUntick && (
            <div role="alertdialog" aria-label="Confirm untick" className="warning-box">
              <p>
                Unticking {STEP_LABELS[pendingUntick.step]} on {nameOf(pendingUntick.partId)} would unlock{' '}
                {pendingUntick.unlocks.join(' and ')}: nothing else on {pendingUntick.unlocks.length > 1 ? 'them' : 'it'}{' '}
                is ticked Cut.
              </p>
              <button
                type="button"
                onClick={() => {
                  setPendingUntick(null);
                  onProgress({ kind: 'untick', partId: pendingUntick.partId, step: pendingUntick.step });
                }}
              >
                Untick
              </button>{' '}
              <button
                type="button"
                onClick={() => {
                  setPendingUntick(null);
                }}
              >
                Keep ticked
              </button>
            </div>
          )}
          <CutSheetPanel
            plan={job.plan}
            job={{
              name: open?.doc.name ?? job.model.projectName,
              shortId: open?.doc.shortId ?? '',
              model: job.model,
              skipped: issues.flatMap((i) =>
                i.kind === 'skipped' ? [{ label: i.label, name: i.name, reason: i.reason }] : [],
              ),
              spares: open?.doc.spares ?? [],
              reimportLog: open?.doc.reimportLog ?? [],
            }}
          />
          <LabelsPanel
            plan={job.plan}
            job={{ name: open?.doc.name ?? job.model.projectName, shortId: open?.doc.shortId ?? '', model: job.model }}
            reimportBatch={open?.doc.reimportLog.at(-1)?.labelIds ?? []}
          />
          {rolled && <ProgressPanel rollup={rolled} owners={job.model.owners} />}
          <ManualOpsList ops={job.plan.manualOps} nameOf={nameOf} />
          {job.plan.sheets.map((sheet) => (
            <section key={sheet.sheetId}>
              <h3>
                {sheet.code} · {job.model.sheets.find((s) => s.id === sheet.sheetId)?.name}
              </h3>
              <SheetCodeField
                key={sheetCode(job, sheet.sheetId)}
                code={sheetCode(job, sheet.sheetId)}
                sheetName={job.model.sheets.find((s) => s.id === sheet.sheetId)?.name ?? sheet.sheetId}
                onCommit={(code) => {
                  onSheetCode(sheet.sheetId, code);
                }}
              />
              <h4>Breakdown</h4>
              {sheet.boards.map((board) => {
                const sawLeft = board.sawParts.filter((p) => isLive(p) && progress[p.partId]?.cut === undefined).length;
                return (
                  <div key={board.number}>
                    <BoardBreakdown code={sheet.code} board={board} nameOf={nameOf} onDiscard={onDiscard} />
                    {board.sawParts.length > 0 && (
                      <p>
                        <button
                          type="button"
                          disabled={sawLeft === 0}
                          onClick={() => {
                            onProgress({ kind: 'breakdownDone', boardId: boardId(sheet, board), at: now() });
                          }}
                        >
                          Breakdown done {sheet.code} Board {board.number}
                        </button>{' '}
                        <span className="tally">
                          {board.sawParts.length - sawLeft} / {board.sawParts.length} Saw Parts Cut
                        </span>
                      </p>
                    )}
                  </div>
                );
              })}
              <h4>Layouts</h4>
              {sheet.boards.flatMap((board) =>
                board.blanks.map((blank) => (
                  <figure key={blank.id}>
                    <figcaption>
                      <strong>{blank.id}</strong> · {blank.length / 1000} × {blank.width / 1000} mm ·{' '}
                      {blank.from && <>from kept Offcut {blank.from} · </>}
                      {blankRoll.get(blank.id)?.total ?? blank.parts.length} Part(s){' '}
                      <button
                        type="button"
                        disabled={blankRoll.get(blank.id)?.cut === blankRoll.get(blank.id)?.total}
                        onClick={() => {
                          onProgress({ kind: 'sideADone', blankId: blank.id, at: now() });
                        }}
                      >
                        Side A done {blank.id}
                      </button>{' '}
                      <span className="tally">
                        {blankRoll.get(blank.id)?.cut ?? 0} / {blankRoll.get(blank.id)?.total ?? blank.parts.length} Cut ·{' '}
                        {blankRoll.get(blank.id)?.done ?? 0} / {blankRoll.get(blank.id)?.total ?? blank.parts.length} Done
                      </span>
                      {blankRoll.get(blank.id)?.locked && <span className="locked"> · Locked</span>}
                    </figcaption>
                    <BlankLayout
                      blank={blank}
                      clampMargin={blank.clampMargin ?? job.plan.settings.clampMargin}
                      nameOf={nameOf}
                      sideBOf={sideBOf}
                      voidOf={(id) => voidText(job.plan, id)}
                    />
                    <ol>
                      {blank.parts.map((p) => {
                        const part = partById.get(p.partId);
                        const size = `${String(p.cutLength / 1000)} × ${String(p.cutWidth / 1000)}${p.rotated ? ' (turned)' : ''}`;
                        return (
                          <li key={p.partId} value={p.n}>
                            {part ? (
                              <PartDetail part={part}>
                                <div>
                                  {size}
                                  {p.narrow && <span className="warn"> · narrow: check tabs</span>}
                                </div>
                              </PartDetail>
                            ) : (
                              <code>{p.partId}</code>
                            )}
                          </li>
                        );
                      })}
                    </ol>
                  </figure>
                )),
              )}
              <PartList
                job={job}
                sheet={sheet}
                progress={progress}
                needsNesting={[...(open?.doc.stale?.needsNesting ?? []), ...waiting]}
                overflow={sheet.overflow ?? []}
                onRemake={setPendingRemake}
                onMode={onPartMode}
                onStep={onStep}
              />
            </section>
          ))}
          <SideBView
            files={job.plan.sideB}
            job={open?.doc.shortId ?? ''}
            nameOf={nameOf}
            whereOf={(id) => whereById.get(id)}
            onDownload={onDownloadSideB}
            onDone={(file) => {
              onProgress({ kind: 'sideBDone', fileId: file.id, at: now() });
            }}
            doneOf={(file) => file.partIds.filter((id) => progress[id]?.sideB !== undefined).length}
          />
        </>
      )}
    </main>
  );
}

/** A Sheet code input, committed on Enter or when it loses focus. Empty goes back to the derived code. */
function SheetCodeField(props: { code: string; sheetName: string; onCommit: (code: string) => void }) {
  const [value, setValue] = useState(props.code);
  const commit = () => {
    if (value.trim().toUpperCase() !== props.code) props.onCommit(value);
  };
  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        commit();
      }}
    >
      <label>
        Sheet code for {props.sheetName}{' '}
        <input
          size={8}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
          }}
          onBlur={commit}
        />
      </label>
    </form>
  );
}

/** The open Job's name, committed on Enter or when it loses focus. A blank name keeps the old one. */
function JobNameField(props: { name: string; onCommit: (name: string) => void }) {
  const [value, setValue] = useState(props.name);
  const commit = () => {
    if (value.trim() === '') setValue(props.name);
    else if (value.trim() !== props.name) props.onCommit(value);
  };
  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        commit();
      }}
    >
      <label>
        Job name{' '}
        <input
          size={40}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
          }}
          onBlur={commit}
        />
      </label>
    </form>
  );
}

/** The diff under review: the open Job's ticks decide Remake or Spare; the maker's unpairs and Fix by hand choices. */
function reviewDiff(open: OpenJob, reimport: PendingReimport) {
  return diff({ model: open.model, plan: open.doc.plan, progress: open.doc.progress }, reimport.model, {
    unpaired: reimport.unpaired,
    fixByHand: reimport.fixByHand,
  });
}

/** Where each Part is cut, Job-wide: `W18-1-A #1` on a Blank, `Saw · Board 1` for a Saw Part. */
function partLocations(sheets: SheetPlan[]): Map<string, string> {
  const where = new Map<string, string>();
  for (const sheet of sheets) {
    for (const board of sheet.boards) {
      for (const blank of board.blanks) {
        for (const p of blank.parts) if (isLive(p)) where.set(p.partId, `${blank.id} #${String(p.n)}`);
      }
      for (const p of board.sawParts) if (isLive(p)) where.set(p.partId, `Saw · ${sheet.code} Board ${String(board.number)}`);
    }
    for (const id of sheet.unplaced) where.set(id, 'Saw · too big for a Board');
    for (const id of sheet.overflow ?? []) where.set(id, 'waiting for a Board');
  }
  return where;
}

const SAW_REASONS: Record<SawReason, string> = {
  oversize: 'bigger than the bed',
  narrow: 'narrow',
  chosen: 'chosen',
};

/** Every Part of a Sheet with where it is cut, the narrow warning, the Saw / CNC toggle and its Step ticks. */
function PartList(props: {
  job: Job;
  sheet: SheetPlan;
  progress: Progress;
  /** After a re-import: Parts the stale Plan doesn't place as they are now. */
  needsNesting: readonly string[];
  /** Parts that fit nowhere and wait for the person to add a Board. */
  overflow: readonly string[];
  /** Asks to mark a cut Part Remake. */
  onRemake: (partId: string) => void;
  onMode: (partId: string, mode: PartMode) => void;
  onStep: (partId: string, step: Step, ticked: boolean) => void;
}) {
  const { job, sheet, progress } = props;
  const model = job.model;
  const where = new Map<string, { text: string; narrow: boolean }>();
  for (const board of sheet.boards) {
    for (const blank of board.blanks) {
      for (const p of blank.parts) {
        if (isLive(p)) where.set(p.partId, { text: `${blank.id} #${String(p.n)}`, narrow: p.narrow });
      }
    }
    for (const p of board.sawParts.filter(isLive)) {
      where.set(p.partId, { text: `Saw · Board ${String(board.number)} (${SAW_REASONS[p.reason]})`, narrow: false });
    }
  }
  for (const id of sheet.unplaced) where.set(id, { text: 'Saw · too big for a Board', narrow: false });

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
        {model.parts
          .filter((p) => p.sheetId === sheet.sheetId)
          .map((p) => {
            const at = where.get(p.id);
            const saw = sheet.sawParts.includes(p.id);
            const fixed = sheet.sawReasons[p.id] === 'oversize';
            const applicable = steps(job, p.id);
            return (
              <tr key={p.id}>
                <td>{p.displayName}</td>
                <td>
                  {p.cutLength / 1000} × {p.cutWidth / 1000}
                </td>
                <td>
                  {props.overflow.includes(p.id) ? (
                    <span className="warn">waiting for a Board</span>
                  ) : props.needsNesting.includes(p.id) ? (
                    <span className="warn">needs nesting</span>
                  ) : (
                    at?.text
                  )}
                  {at && progress[p.id]?.cut !== undefined && (
                    <>
                      {' '}
                      <button
                        type="button"
                        onClick={() => {
                          props.onRemake(p.id);
                        }}
                      >
                        Remake {p.displayName}
                      </button>
                    </>
                  )}
                  {at?.narrow && <span className="warn"> · narrow: check tabs</span>}
                </td>
                <td>
                  <label title={fixed ? 'Bigger than the usable bed: always cut on the saw' : undefined}>
                    <input
                      type="checkbox"
                      checked={saw}
                      disabled={fixed}
                      onChange={(e) => {
                        props.onMode(p.id, e.target.checked ? 'saw' : 'cnc');
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
                          props.onStep(p.id, step, e.target.checked);
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
