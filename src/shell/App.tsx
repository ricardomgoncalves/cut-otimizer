import { useState, type ChangeEvent, type FormEvent } from 'react';
import { APP_NAME } from '../core/app.ts';
import { toDxfFiles } from '../core/dxf/index.ts';
import { importExport, type ImportIssue } from '../core/import/index.ts';
import { generateJob, regenerate, setSheetCode, sheetCode, snapshotChanges, type Job } from '../core/job.ts';
import type { Settings } from '../core/settings.ts';
import { BlankLayout } from './BlankLayout.tsx';
import { downloadBytes, safeFileName, zipFiles } from './download.ts';
import { SETTING_LABELS } from './setting-labels.ts';
import { SettingsScreen } from './SettingsScreen.tsx';
import { loadSettings, saveSettings } from './settings-store.ts';

/** The open Job, held in memory only for now (the Job store comes in ticket #29). */
interface LoadedJob extends Job {
  fileName: string;
}

export function App() {
  const [job, setJob] = useState<LoadedJob | null>(null);
  const [issues, setIssues] = useState<ImportIssue[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [view, setView] = useState<'job' | 'settings'>('job');
  const [codeError, setCodeError] = useState<string | null>(null);

  async function onLoad(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setJob(null);
    setIssues([]);
    setLoadError(null);
    setCodeError(null);

    let json: unknown;
    try {
      json = JSON.parse(await file.text());
    } catch (err) {
      setLoadError(`${file.name} is not JSON: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    const result = importExport(json);
    setIssues(result.issues);
    if (!result.model) {
      setLoadError(`${file.name} is not a valid Parts Export v1. Nothing was loaded.`);
      return;
    }
    setJob({ fileName: file.name, ...generateJob(result.model, settings) });
  }

  function onSaveSettings(next: Settings): boolean {
    setSettings(next);
    return saveSettings(next);
  }

  function onRegenerate() {
    if (!job) return;
    setJob({ fileName: job.fileName, ...regenerate(job, settings) });
  }

  function onSheetCode(sheetId: string, code: string) {
    if (!job) return;
    const result = setSheetCode(job, sheetId, code);
    if ('error' in result) {
      setCodeError(result.error);
      return;
    }
    setCodeError(null);
    setJob({ fileName: job.fileName, ...result.job });
  }

  function onDownload() {
    if (!job) return;
    const zip = zipFiles(toDxfFiles(job.plan));
    downloadBytes(zip, `${safeFileName(job.model.projectName)}.dxf.zip`, 'application/zip');
  }

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
        </label>
      </p>

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

      {job && (
        <>
          <h2>
            {job.model.projectName} <small>({job.fileName})</small>
          </h2>
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
