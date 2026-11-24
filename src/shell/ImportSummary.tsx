import type { ImportIssue } from '../core/import/index.ts';
import type { Model } from '../core/model.ts';
import { PartDetail } from './PartDetail.tsx';

type Issue<K extends ImportIssue['kind']> = Extract<ImportIssue, { kind: K }>;

const mm = (um: number) => String(um / 1000);

const SKIP_REASON: Record<Issue<'skipped'>['reason'], string> = {
  invalid: 'invalid',
  placeholder: 'placeholder',
  noMaterial: 'no material',
};

/** The Skipped items: a persistent warning that the Job is incomplete. Renders nothing when there are none. */
export function SkippedWarning({ issues }: { issues: ImportIssue[] }) {
  const skipped = issues.filter((i): i is Issue<'skipped'> => i.kind === 'skipped');
  if (skipped.length === 0) return null;
  return (
    <section aria-label="Skipped items" className="warning-box">
      <strong>
        Incomplete Job: the export left out {skipped.length} item{skipped.length === 1 ? '' : 's'}. They have no
        Parts here.
      </strong>
      <ul>
        {skipped.map((s) => (
          <li key={`${s.ownerKind}/${s.id}`}>
            <strong>{s.label}</strong> {s.name} · {SKIP_REASON[s.reason]}
            {s.problems.length > 0 && <> ({s.problems.join(', ')})</>}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** What was loaded, before anything is planned: Sheets, Owners, Parts and import issues. */
export function ImportSummary({ model, issues }: { model: Model; issues: ImportIssue[] }) {
  const unknownKeys = issues.filter((i): i is Issue<'unknownKey'> => i.kind === 'unknownKey');
  const warnings = issues.filter((i): i is Issue<'warning'> => i.kind === 'warning');
  const partsOf = (pred: (p: Model['parts'][number]) => boolean) => model.parts.filter(pred).length;
  const sheetCode = new Map(model.sheets.map((s) => [s.id, s.code]));

  return (
    <section aria-label="Import summary">
      <h3>Import summary</h3>
      <p>
        {model.parts.length} Parts, {model.sheets.length} Sheets, {model.owners.length} Owners.
      </p>

      {unknownKeys.length > 0 && (
        <>
          <h4>Unknown Part keys</h4>
          <p>These Parts are named from their path with spaces added.</p>
          <ul>
            {unknownKeys.map((u) => (
              <li key={u.key}>
                <code>{u.key}</code>: {u.partIds.map((id) => <code key={id}>{id} </code>)}
              </li>
            ))}
          </ul>
        </>
      )}

      {warnings.length > 0 && (
        <>
          <h4>Warnings</h4>
          <ul className="warnings">
            {warnings.map((i, k) => (
              <li key={k}>
                {i.partId && <code>{i.partId}</code>} {i.message}
              </li>
            ))}
          </ul>
        </>
      )}

      <h4>Sheets</h4>
      <table>
        <thead>
          <tr>
            <th>Code</th>
            <th>Sheet</th>
            <th>Thickness</th>
            <th>Size</th>
            <th>Parts</th>
          </tr>
        </thead>
        <tbody>
          {model.sheets.map((s) => (
            <tr key={s.id}>
              <td>{s.code}</td>
              <td>{s.name}</td>
              <td>{mm(s.thickness)} mm</td>
              <td>
                {mm(s.length)} × {mm(s.width)}
              </td>
              <td>{partsOf((p) => p.sheetId === s.id)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h4>Owners</h4>
      <table>
        <thead>
          <tr>
            <th>Owner</th>
            <th>Cabinet or item</th>
            <th>Parts</th>
          </tr>
        </thead>
        <tbody>
          {model.owners.map((o) => (
            <tr key={o.id}>
              <td>{o.label}</td>
              <td>{o.kind === 'cabinet' ? o.cabinetName : 'Generated Item'}</td>
              <td>{partsOf((p) => p.ownerId === o.id)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h4>Parts</h4>
      <table>
        <thead>
          <tr>
            <th>Part</th>
            <th>Sheet</th>
            <th>Cut size</th>
          </tr>
        </thead>
        <tbody>
          {model.parts.map((p) => (
            <tr key={p.id}>
              <td>
                <PartDetail part={p} />
              </td>
              <td>{sheetCode.get(p.sheetId)}</td>
              <td>
                {mm(p.cutLength)} × {mm(p.cutWidth)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
