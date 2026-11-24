import { useState, type ChangeEvent } from 'react';
import { APP_NAME } from '../core/app.ts';
import { toDxfFiles } from '../core/dxf/index.ts';
import { importExport, type ImportIssue } from '../core/import/index.ts';
import type { Model } from '../core/model.ts';
import { plan, type Plan } from '../core/planner/index.ts';
import { DEFAULT_SETTINGS } from '../core/settings.ts';
import { BlankLayout } from './BlankLayout.tsx';
import { downloadBytes, safeFileName, zipFiles } from './download.ts';

/** The Job, held in memory only for now (the Job store comes in ticket #29). */
interface Job {
  fileName: string;
  model: Model;
  plan: Plan;
}

export function App() {
  const [job, setJob] = useState<Job | null>(null);
  const [issues, setIssues] = useState<ImportIssue[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  async function onLoad(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setJob(null);
    setIssues([]);
    setLoadError(null);

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
    setJob({ fileName: file.name, model: result.model, plan: plan(result.model, DEFAULT_SETTINGS) });
  }

  function onDownload() {
    if (!job) return;
    const zip = zipFiles(toDxfFiles(job.plan));
    downloadBytes(zip, `${safeFileName(job.model.projectName)}.dxf.zip`, 'application/zip');
  }

  const schemaErrors = issues.filter((i) => i.kind === 'schema');
  const warnings = issues.filter((i) => i.kind === 'warning');

  return (
    <main>
      <h1>{APP_NAME}</h1>

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
