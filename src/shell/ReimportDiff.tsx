import type { ReimportLogEntry } from '../core/job-store/document.ts';
import { CATEGORIES, type Category, type Change, type Diff, type DiffEntry } from '../core/reimport.ts';

const CATEGORY_LABELS: Record<Category, string> = {
  changedCut: 'Changed (cut)',
  changedFinishing: 'Changed (finishing)',
  added: 'Added',
  removed: 'Removed',
  renamed: 'Renamed',
  same: 'Same',
};

const CHANGE_LABELS: Record<Change, string> = {
  id: 'id',
  name: 'name',
  owner: 'Owner',
  sheet: 'Sheet',
  sheetDefinition: 'Sheet definition',
  size: 'size',
  grain: 'grain',
  cncOps: 'CNC ops',
  edgebands: 'Edgebands',
  manualOps: 'Manual ops',
};

const percent = (share: number) => `${String(Math.round(share * 100))}%`;
const day = (iso: string | undefined) => (iso === undefined ? 'unknown' : iso.replace('T', ' ').slice(0, 16));

/**
 * The diff screen of a re-import: the sanity hint, warnings, and the Parts grouped by category with counts,
 * affected Owners and where they are nested. Auto-paired Parts can be unpaired. Apply is all or nothing.
 */
export function ReimportDiff(props: {
  fileName: string;
  diff: Diff;
  onUnpair: (entry: DiffEntry) => void;
  onApply: () => void;
  onCancel: () => void;
}) {
  const { diff } = props;
  const { hint } = diff;
  return (
    <section aria-label="Re-import">
      <h3>Re-import {props.fileName}</h3>
      <p className="hint">
        Project: {hint.newProject}
        {hint.sameProject ? ' (same as this Job)' : ` (this Job: ${hint.currentProject})`} ·{' '}
        {percent(hint.idMatchShare)} of Part ids match
      </p>
      {(hint.lowOverlap || diff.olderExport) && (
        <div role="status" className="warning-box">
          {hint.lowOverlap && (
            <p>Only {percent(hint.idMatchShare)} of Part ids match. Is this export for this Job?</p>
          )}
          {diff.olderExport && (
            <p>
              This file was exported on {day(diff.newExportedAt)}, before this Job&apos;s current export (
              {day(diff.currentExportedAt)}).
            </p>
          )}
        </div>
      )}
      <ul aria-label="Re-import counts">
        {CATEGORIES.map((c) => (
          <li key={c}>
            {CATEGORY_LABELS[c]}: {diff.counts[c]}
          </li>
        ))}
      </ul>
      {CATEGORIES.filter((c) => c !== 'same' && diff.counts[c] > 0).map((c) => (
        <section key={c} aria-label={CATEGORY_LABELS[c]}>
          <h4>
            {CATEGORY_LABELS[c]} ({diff.counts[c]})
          </h4>
          <p>Owners: {diff.owners[c].join(', ')}</p>
          <table aria-label={`${CATEGORY_LABELS[c]} Parts`}>
            <thead>
              <tr>
                <th scope="col">Part</th>
                <th scope="col">Was</th>
                <th scope="col">Where</th>
                <th scope="col">Changes</th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {diff.entries
                .filter((e) => e.category === c)
                .map((e) => (
                  <tr key={`${e.oldId ?? ''}>${e.newId ?? ''}`}>
                    <td>
                      {e.displayName} <span className="raw-name">{e.newId ?? e.oldId}</span>
                    </td>
                    <td>
                      {e.oldDisplayName}
                      {e.oldId !== undefined && e.oldId !== e.newId && e.newId !== undefined && (
                        <span className="raw-name"> {e.oldId}</span>
                      )}
                    </td>
                    <td>{e.where}</td>
                    <td>{e.changes.map((k) => CHANGE_LABELS[k]).join(', ')}</td>
                    <td>
                      {e.paired && (
                        <button
                          type="button"
                          onClick={() => {
                            props.onUnpair(e);
                          }}
                        >
                          Unpair {e.displayName}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </section>
      ))}
      <p>
        <button type="button" onClick={props.onApply}>
          Apply re-import
        </button>{' '}
        <button type="button" onClick={props.onCancel}>
          Cancel re-import
        </button>
      </p>
    </section>
  );
}

/** Every re-import applied to the Job: when, the export's date, and counts per category. */
export function ReimportLog({ log }: { log: ReimportLogEntry[] }) {
  if (log.length === 0) return null;
  return (
    <table aria-label="Re-import log">
      <thead>
        <tr>
          <th scope="col">Re-imported</th>
          <th scope="col">Exported</th>
          <th scope="col">File</th>
          {CATEGORIES.map((c) => (
            <th key={c} scope="col">
              {CATEGORY_LABELS[c]}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {log.map((entry) => (
          <tr key={entry.at}>
            <td>{day(entry.at)}</td>
            <td>{day(entry.exportedAt)}</td>
            <td>{entry.fileName}</td>
            {CATEGORIES.map((c) => (
              <td key={c}>{entry.counts[c]}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
