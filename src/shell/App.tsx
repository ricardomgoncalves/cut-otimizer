import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { APP_NAME } from '../core/app.ts';
import { toDxfFiles } from '../core/dxf/index.ts';
import { importExport, type ImportIssue } from '../core/import/index.ts';
import { generateJob, regenerate, setSheetCode, sheetCode, snapshotChanges, type Job } from '../core/job.ts';
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
import type { Settings } from '../core/settings.ts';
import { BlankLayout } from './BlankLayout.tsx';
import { downloadBytes, safeFileName, zipFiles } from './download.ts';
import { createDexieJobStore } from './job-store-dexie.ts';
import { JobList } from './JobList.tsx';
import { SETTING_LABELS } from './setting-labels.ts';
import { SettingsScreen } from './SettingsScreen.tsx';
import { loadSettings, saveSettings } from './settings-store.ts';

/** Every Job lives in IndexedDB; every change to the open Job is saved straight away. */
const store = createDexieJobStore();

/** The Job open in the page: its stored document and the working Job built from it. */
interface OpenJob {
  doc: JobDocument;
  job: Job;
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
        setOpen({ doc, job: opened.job });
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
  function save(doc: JobDocument, job: Job) {
    setOpen({ doc, job });
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
    const job = generateJob(result.model, settings);
    const id = crypto.randomUUID();
    const shortId = shortIdFor(
      id,
      jobs.map((j) => j.shortId),
    );
    save(createJobDocument({ id, shortId, rawExport: text, fileName: file.name, job, now: now() }), job);
  }

  /** Opens a Job document: shows it, and saves it when it came from a file. */
  function openDocument(doc: JobDocument, persist: boolean) {
    const opened = openJobDocument(doc);
    if ('error' in opened) {
      setLoadError(opened.error);
      return;
    }
    setIssues(opened.issues);
    if (persist) save(doc, opened.job);
    else {
      setOpen({ doc, job: opened.job });
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
        save(setArchived(open.doc, archived, now()), open.job);
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
    if (doc !== open.doc) save(doc, open.job);
  }

  function onSaveSettings(next: Settings): boolean {
    setSettings(next);
    return saveSettings(next);
  }

  function onRegenerate() {
    if (!open) return;
    const job = regenerate(open.job, settings);
    save(withJob(open.doc, job, now()), job);
  }

  function onSheetCode(sheetId: string, code: string) {
    if (!open) return;
    const result = setSheetCode(open.job, sheetId, code);
    if ('error' in result) {
      setCodeError(result.error);
      return;
    }
    setCodeError(null);
    save(withJob(open.doc, result.job, now()), result.job);
  }

  function onDownload() {
    if (!open) return;
    const zip = zipFiles(toDxfFiles(open.job.plan));
    downloadBytes(zip, `${safeFileName(open.job.model.projectName)}.dxf.zip`, 'application/zip');
  }

  function onDownloadJob() {
    if (!open) return;
    const bytes = new TextEncoder().encode(toJobFile(open.doc));
    downloadBytes(bytes, safeFileName(jobFileName(open.doc)), 'application/json');
  }

  const job = open?.job ?? null;

  const schemaErrors = issues.filter((i) => i.kind === 'schema');
  const warnings = issues.filter((i) => i.kind === 'warning');
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
        <SettingsScreen settings={settings} sheets={job?.model.sheets ?? []} onSave={onSaveSettings} />
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

      {open && job && (
        <>
          <h2>
            {open.doc.name} <small>({open.doc.fileName})</small>
          </h2>
          <p>
            Short id <code>{open.doc.shortId}</code>
            {open.doc.archived && ' · archived'}
          </p>
          <JobNameField key={open.doc.name} name={open.doc.name} onCommit={onRename} />
          {warnings.length > 0 && (
            <ul className="warnings">
              {warnings.map((i, k) => (
                <li key={k}>
                  {i.partId && <code>{i.partId}</code>} {i.message}
                </li>
              ))}
            </ul>
          )}
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
          <p>
            <button type="button" onClick={onDownload}>
              Download DXFs
            </button>{' '}
            <button type="button" onClick={onDownloadJob}>
              Download Job
            </button>
          </p>
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
              {sheet.sawParts.length > 0 && (
                <p>
                  Saw Parts:{' '}
                  {sheet.sawParts.map((id) => (
                    <code key={id}>{id} </code>
                  ))}
                </p>
              )}
              {sheet.boards.flatMap((board) =>
                board.blanks.map((blank) => (
                  <figure key={blank.id}>
                    <figcaption>
                      <strong>{blank.id}</strong> · {blank.length / 1000} × {blank.width / 1000} mm ·{' '}
                      {blank.parts.length} Part(s)
                    </figcaption>
                    <BlankLayout blank={blank} clampMargin={job.plan.settings.clampMargin} />
                    <ol>
                      {blank.parts.map((p) => (
                        <li key={p.partId} value={p.n}>
                          <code>{p.partId}</code> {p.cutLength / 1000} × {p.cutWidth / 1000}
                          {p.rotated ? ' (turned)' : ''}
                        </li>
                      ))}
                    </ol>
                  </figure>
                )),
              )}
            </section>
          ))}
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
