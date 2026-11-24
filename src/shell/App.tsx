import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { APP_NAME } from '../core/app.ts';
import { sideBFileName, toDxfFiles } from '../core/dxf/index.ts';
import { importExport, type ImportIssue } from '../core/import/index.ts';
import {
  generateJob,
  regenerate,
  setPartMode,
  setSheetCode,
  sheetCode,
  snapshotChanges,
  type Job,
} from '../core/job.ts';
import {
  createJobDocument,
  fromJobFile,
  jobFileName,
  openJobDocument,
  renameJob,
  setArchived,
  shortIdFor,
  toJobFile,
  withJob,
  type JobDocument,
} from '../core/job-store/document.ts';
import type { JobSummary } from '../core/job-store/store.ts';
import type { Model, Part } from '../core/model.ts';
import type { PartMode, SawReason, SheetPlan, SideBFile } from '../core/planner/index.ts';
import type { Settings } from '../core/settings.ts';
import { BlankLayout } from './BlankLayout.tsx';
import { BoardBreakdown } from './BoardBreakdown.tsx';
import { downloadBytes, safeFileName, zipFiles } from './download.ts';
import { ImportSummary, SkippedWarning } from './ImportSummary.tsx';
import { createDexieJobStore } from './job-store-dexie.ts';
import { JobList } from './JobList.tsx';
import { PartDetail } from './PartDetail.tsx';
import { SETTING_LABELS } from './setting-labels.ts';
import { SettingsScreen } from './SettingsScreen.tsx';
import { ManualOpsList, SideBView } from './SideBView.tsx';
import { loadSettings, saveSettings } from './settings-store.ts';

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
  const [view, setView] = useState<'job' | 'settings'>('job');
  const [codeError, setCodeError] = useState<string | null>(null);

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
    const job = regenerate(open.job, settings);
    save(withJob(open.doc, job, now()), open.model, job);
  }

  function onSheetCode(sheetId: string, code: string) {
    if (!open?.job) return;
    const result = setSheetCode(open.job, sheetId, code);
    if ('error' in result) {
      setCodeError(result.error);
      return;
    }
    setCodeError(null);
    save(withJob(open.doc, result.job, now()), open.model, result.job);
  }

  function onPartMode(partId: string, mode: PartMode) {
    if (!open?.job) return;
    const result = setPartMode(open.job, partId, mode);
    if ('error' in result) {
      setCodeError(result.error);
      return;
    }
    setCodeError(null);
    save(withJob(open.doc, result.job, now()), open.model, result.job);
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
            </button>
          </p>
          {!job && <ImportSummary model={open.model} issues={issues} />}
        </>
      )}

      {job && (
        <>
          {changed.length > 0 && (
            <div role="status" className="stale">
              <p>
                This Job was generated with different Machine settings (
                {changed.map((k) => SETTING_LABELS[k]).join(', ')}). Its files keep the old settings until
                you regenerate it.
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
              {sheet.boards.map((board) => (
                <BoardBreakdown key={board.number} code={sheet.code} board={board} nameOf={nameOf} />
              ))}
              <h4>Layouts</h4>
              {sheet.boards.flatMap((board) =>
                board.blanks.map((blank) => (
                  <figure key={blank.id}>
                    <figcaption>
                      <strong>{blank.id}</strong> · {blank.length / 1000} × {blank.width / 1000} mm ·{' '}
                      {blank.parts.length} Part(s)
                    </figcaption>
                    <BlankLayout
                      blank={blank}
                      clampMargin={job.plan.settings.clampMargin}
                      nameOf={nameOf}
                      sideBOf={sideBOf}
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
              <PartList model={job.model} sheet={sheet} onMode={onPartMode} />
            </section>
          ))}
          <SideBView
            files={job.plan.sideB}
            job={open?.doc.shortId ?? ''}
            nameOf={nameOf}
            whereOf={(id) => whereById.get(id)}
            onDownload={onDownloadSideB}
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

/** Where each Part is cut, Job-wide: `W18-1-A #1` on a Blank, `Saw · Board 1` for a Saw Part. */
function partLocations(sheets: SheetPlan[]): Map<string, string> {
  const where = new Map<string, string>();
  for (const sheet of sheets) {
    for (const board of sheet.boards) {
      for (const blank of board.blanks) for (const p of blank.parts) where.set(p.partId, `${blank.id} #${String(p.n)}`);
      for (const p of board.sawParts) where.set(p.partId, `Saw · ${sheet.code} Board ${String(board.number)}`);
    }
    for (const id of sheet.unplaced) where.set(id, 'Saw · too big for a Board');
  }
  return where;
}

const SAW_REASONS: Record<SawReason, string> = {
  oversize: 'bigger than the bed',
  narrow: 'narrow',
  chosen: 'chosen',
};

/** Every Part of a Sheet with where it is cut, the narrow warning and the Saw / CNC toggle. */
function PartList(props: { model: Model; sheet: SheetPlan; onMode: (partId: string, mode: PartMode) => void }) {
  const { model, sheet } = props;
  const where = new Map<string, { text: string; narrow: boolean }>();
  for (const board of sheet.boards) {
    for (const blank of board.blanks) {
      for (const p of blank.parts) where.set(p.partId, { text: `${blank.id} #${String(p.n)}`, narrow: p.narrow });
    }
    for (const p of board.sawParts) {
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
        </tr>
      </thead>
      <tbody>
        {model.parts
          .filter((p) => p.sheetId === sheet.sheetId)
          .map((p) => {
            const at = where.get(p.id);
            const saw = sheet.sawParts.includes(p.id);
            const fixed = sheet.sawReasons[p.id] === 'oversize';
            return (
              <tr key={p.id}>
                <td>{p.displayName}</td>
                <td>
                  {p.cutLength / 1000} × {p.cutWidth / 1000}
                </td>
                <td>
                  {at?.text}
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
              </tr>
            );
          })}
      </tbody>
    </table>
  );
}
