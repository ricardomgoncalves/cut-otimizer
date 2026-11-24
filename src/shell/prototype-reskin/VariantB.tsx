// PROTOTYPE (reskin) variant B — "Workbench": the gcode-viewer grid. Jobs + open Job on the left, the
// selected Sheet's drawings on a dark stage in the centre, notices / progress / documents on the right.
import { useState } from 'react';
import type { JobSession } from '../useJobSession.ts';
import { Bar, pieces, type View } from './pieces.tsx';

export const NAME = 'Workbench';

export function VariantB({ session }: { session: JobSession }) {
  const [view, setView] = useState<View>('job');
  const [stageTab, setStageTab] = useState<string>('jobs');
  const p = pieces(session);
  const { state, actions } = session;
  const planned = p.planned;
  const sheet = planned?.sheets.find((s) => s.id === stageTab);
  const tab = sheet ? stageTab : stageTab === 'sideB' && planned ? 'sideB' : planned ? (planned.sheets[0]?.id ?? 'jobs') : 'jobs';
  const shown = planned?.sheets.find((s) => s.id === tab);

  const top = (
    <header className="topbar" style={{ gridArea: 'top' }}>
      <h1>{p.title}</h1>
      {p.open && (
        <span className="muted">
          / {p.open.doc.name} <code>{p.open.doc.shortId}</code>
        </span>
      )}
      <span className="spacer" />
      {p.loadControls}
      {p.nav(view, setView)}
    </header>
  );

  if (view !== 'job')
    return (
      <div style={{ display: 'grid', gridTemplateRows: 'auto 1fr', height: '100%' }}>
        {top}
        <main className="scroll pad" style={{ background: 'var(--panel)' }}>
          <div style={{ maxWidth: 720 }}>{view === 'settings' ? p.settings : p.scan}</div>
        </main>
      </div>
    );

  return (
    <div
      style={{
        display: 'grid',
        height: '100%',
        gridTemplate: '"top top top" auto "side stage right" 1fr / 300px minmax(0, 1fr) 340px',
      }}
    >
      {top}
      <aside className="scroll" style={{ gridArea: 'side', background: 'var(--panel)', borderRight: '1px solid var(--line)' }}>
        <div className="panelhead">Jobs</div>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {state.jobs
            .filter((j) => !j.archived || j.id === p.open?.doc.id)
            .map((j) => (
              <li
                key={j.id}
                onClick={() => void actions.openStored(j.id)}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr auto',
                  gap: 6,
                  padding: '4px 10px',
                  borderBottom: '1px solid var(--line)',
                  cursor: 'pointer',
                  background: j.id === p.open?.doc.id ? 'var(--current)' : undefined,
                }}
              >
                <span>{j.name}</span>
                <code className="muted">{j.shortId}</code>
              </li>
            ))}
          {state.jobs.length === 0 && <li className="pad muted">No Jobs yet. Load an export to start one.</li>}
        </ul>
        {p.open && (
          <>
            <div className="panelhead">Open Job</div>
            <div className="pad section">
              {p.jobMeta}
              <div style={{ marginTop: 8 }}>{p.jobActions}</div>
            </div>
          </>
        )}
        {planned && (
          <>
            <div className="panelhead">Sheets</div>
            {planned.sheets.map((s) => (
              <div
                key={s.id}
                onClick={() => {
                  setStageTab(s.id);
                }}
                style={{
                  padding: '4px 10px',
                  borderBottom: '1px solid var(--line)',
                  cursor: 'pointer',
                  background: s.id === tab ? 'var(--current)' : undefined,
                }}
              >
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span>
                    <code>{s.code}</code> <span className="small muted">{s.name}</span>
                  </span>
                  <span className="tally">
                    {s.cut}/{s.total}
                  </span>
                </div>
                <Bar value={s.cut} total={s.total} />
              </div>
            ))}
          </>
        )}
      </aside>

      <main className="scroll stage" style={{ gridArea: 'stage', background: 'var(--viewport)', position: 'relative', minWidth: 0 }}>
        <div className="pad">
          {p.alerts}
          {!p.open && p.jobList}
          {p.open && !planned && (
            <>
              {p.reimport}
              {p.importSummary}
            </>
          )}
          {planned && (
            <>
              <div className="row" style={{ marginBottom: 8 }}>
                {planned.sheets.map((s) => (
                  <button key={s.id} type="button" aria-selected={s.id === tab} onClick={() => setStageTab(s.id)}>
                    {s.code}
                  </button>
                ))}
                <button type="button" aria-selected={tab === 'sideB'} onClick={() => setStageTab('sideB')}>
                  Side B
                </button>
                <span className="spacer" />
                <button type="button" aria-selected={tab === 'jobs'} onClick={() => setStageTab('jobs')}>
                  All Jobs
                </button>
              </div>
              {tab === 'jobs' ? p.jobList : tab === 'sideB' ? planned.sideB : shown?.node}
            </>
          )}
        </div>
      </main>

      <aside className="scroll" style={{ gridArea: 'right', background: 'var(--panel)', borderLeft: '1px solid var(--line)' }}>
        {planned ? (
          <>
            {planned.noticeCount > 0 && (
              <>
                <div className="panelhead">
                  <span>Needs attention</span>
                  <span className="dot warning" />
                </div>
                <div className="pad section">{planned.notices}</div>
              </>
            )}
            {p.reimport && <div className="pad section">{p.reimport}</div>}
            <div className="panelhead">
              <span>Progress</span>
              <span className="tally">
                {planned.rolled.job.done}/{planned.rolled.job.total} Done
              </span>
            </div>
            <div className="pad section">
              <Bar value={planned.rolled.job.done} total={planned.rolled.job.total} />
              {planned.progress}
            </div>
            <div className="panelhead">Documents</div>
            <div className="pad section">
              {planned.cutSheet}
              {planned.labels}
            </div>
            <div className="pad">{planned.manualOps}</div>
          </>
        ) : (
          <div className="pad muted">Plan a Job to see its progress and documents here.</div>
        )}
      </aside>
    </div>
  );
}
