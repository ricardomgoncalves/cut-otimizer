// PROTOTYPE (reskin) variant C — "Tabs": no side panels. A top bar with a Job picker, then one row of
// tabs that splits the Job into stages (Overview, Sheets, Documents, Progress, Side B). One thing at a time.
import { useState } from 'react';
import type { JobSession } from '../useJobSession.ts';
import { Bar, pieces } from './pieces.tsx';

export const NAME = 'Tabs';

type Tab = 'overview' | 'sheets' | 'documents' | 'progress' | 'sideB' | 'jobs' | 'settings' | 'scan';

export function VariantC({ session }: { session: JobSession }) {
  const [tab, setTab] = useState<Tab>('overview');
  const [sheetId, setSheetId] = useState<string | null>(null);
  const p = pieces(session);
  const { state, actions } = session;
  const planned = p.planned;
  const sheet = planned?.sheets.find((s) => s.id === sheetId) ?? planned?.sheets[0];

  const tabs: [Tab, string, boolean][] = [
    ['overview', 'Overview', true],
    ['sheets', 'Sheets', !!planned],
    ['documents', 'Documents', !!planned],
    ['progress', 'Progress', !!planned],
    ['sideB', 'Side B', !!planned],
    ['jobs', 'All Jobs', true],
    ['settings', 'Machine settings', true],
    ['scan', 'Scan mode', true],
  ];

  let body;
  if (tab === 'settings') body = <div className="pad" style={{ maxWidth: 720 }}>{p.settings}</div>;
  else if (tab === 'scan') body = <div className="pad">{p.scan}</div>;
  else if (tab === 'jobs') body = <div className="pad">{p.jobList}</div>;
  else if (tab === 'sheets' && planned)
    body = (
      <div style={{ display: 'grid', gridTemplateColumns: '220px minmax(0,1fr)', height: '100%', minHeight: 0 }}>
        <div className="scroll" style={{ borderRight: '1px solid var(--line)', background: 'var(--panel)' }}>
          {planned.sheets.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-current={s.id === sheet?.id}
              onClick={() => setSheetId(s.id)}
              style={{ display: 'block', width: '100%', textAlign: 'left', borderRadius: 0, border: 'none', borderBottom: '1px solid var(--line)', padding: '6px 10px' }}
            >
              <code>{s.code}</code> {s.name}
              <div className="tally" style={{ color: 'inherit' }}>
                {s.cut} / {s.total} Cut
              </div>
            </button>
          ))}
        </div>
        <div className="scroll pad">{sheet?.node}</div>
      </div>
    );
  else if (tab === 'documents' && planned)
    body = (
      <div className="pad" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <h3>Cut sheet</h3>
          {planned.cutSheet}
        </div>
        <div>
          <h3>Labels</h3>
          {planned.labels}
        </div>
        <div style={{ gridColumn: '1 / -1' }}>{planned.manualOps}</div>
      </div>
    );
  else if (tab === 'progress' && planned) body = <div className="pad" style={{ maxWidth: 900 }}>{planned.progress}</div>;
  else if (tab === 'sideB' && planned) body = <div className="pad" style={{ maxWidth: 900 }}>{planned.sideB}</div>;
  else
    body = (
      <div className="pad" style={{ maxWidth: 900 }}>
        {p.alerts}
        {!p.open && (
          <>
            <h3>Start</h3>
            <p className="muted">Load an export to start a Job, or open one from All Jobs.</p>
            {p.loadControls}
          </>
        )}
        {p.open && (
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 300px', gap: 12 }}>
            <div>
              {planned?.notices}
              {p.reimport}
              {p.importSummary}
              {planned && (
                <>
                  <h3>Sheets</h3>
                  {planned.sheets.map((s) => (
                    <div
                      key={s.id}
                      onClick={() => {
                        setSheetId(s.id);
                        setTab('sheets');
                      }}
                      style={{ display: 'grid', gridTemplateColumns: '60px 1fr 160px 60px', gap: 10, alignItems: 'center', padding: '4px 0', borderBottom: '1px solid var(--line)', cursor: 'pointer' }}
                    >
                      <code>{s.code}</code>
                      <span>{s.name}</span>
                      <Bar value={s.cut} total={s.total} />
                      <span className="tally" style={{ textAlign: 'right' }}>
                        {s.cut}/{s.total}
                      </span>
                    </div>
                  ))}
                </>
              )}
            </div>
            <div>
              <h3>Job</h3>
              {p.jobMeta}
              <div style={{ marginTop: 8 }}>{p.jobActions}</div>
              {planned && (
                <>
                  <h3>Done</h3>
                  <Bar value={planned.rolled.job.done} total={planned.rolled.job.total} />
                  <p className="tally">
                    {planned.rolled.job.done} / {planned.rolled.job.total} Done · {planned.rolled.job.cut} /{' '}
                    {planned.rolled.job.total} Cut
                  </p>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    );

  return (
    <div style={{ display: 'grid', gridTemplateRows: 'auto auto 1fr', height: '100%' }}>
      <header className="topbar">
        <h1>{p.title}</h1>
        <select
          style={{ width: 260 }}
          value={p.open?.doc.id ?? ''}
          onChange={(e) => void actions.openStored(e.target.value)}
          aria-label="Open Job"
        >
          {!p.open && <option value="">No Job open</option>}
          {state.jobs
            .filter((j) => !j.archived || j.id === p.open?.doc.id)
            .map((j) => (
              <option key={j.id} value={j.id}>
                {j.name} · {j.shortId}
              </option>
            ))}
        </select>
        <span className="spacer" />
        {p.loadControls}
      </header>
      <div className="row" style={{ gap: 0, background: 'var(--panel)', borderBottom: '1px solid var(--line)', padding: '0 12px' }}>
        {tabs.map(([k, label, enabled]) => (
          <button
            key={k}
            type="button"
            disabled={!enabled}
            onClick={() => setTab(k)}
            style={{
              background: 'none',
              border: 'none',
              borderRadius: 0,
              padding: '6px 10px',
              borderBottom: `2px solid ${tab === k ? 'var(--accent)' : 'transparent'}`,
              color: tab === k ? 'var(--fg)' : 'var(--muted)',
            }}
          >
            {label}
            {k === 'overview' && planned && planned.noticeCount > 0 && (
              <span className="dot warning" style={{ marginLeft: 6 }} />
            )}
          </button>
        ))}
      </div>
      <main className="scroll" style={{ minHeight: 0 }}>
        {body}
      </main>
    </div>
  );
}
