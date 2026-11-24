// PROTOTYPE (reskin) variant A — "Document": today's single scrolling page, reskinned. Top bar + one
// centred column; each section gets a panel heading. The smallest change from the current app.
import { useState, type ReactNode } from 'react';
import type { JobSession } from '../useJobSession.ts';
import { pieces, type View } from './pieces.tsx';

export const NAME = 'Document';

function Panel({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 6, marginBottom: 12 }}>
      <div className="panelhead">
        <span>{title}</span>
        {aside}
      </div>
      <div className="pad">{children}</div>
    </section>
  );
}

export function VariantA({ session }: { session: JobSession }) {
  const [view, setView] = useState<View>('job');
  const p = pieces(session);
  const body =
    view === 'settings' ? (
      <Panel title="Machine settings">{p.settings}</Panel>
    ) : view === 'scan' ? (
      <Panel title="Scan mode">{p.scan}</Panel>
    ) : (
      <>
        {p.alerts}
        <Panel title="Jobs">{p.jobList}</Panel>
        {p.open && (
          <Panel title={p.open.doc.name} aside={<code>{p.open.doc.shortId}</code>}>
            {p.jobMeta}
            <div style={{ marginTop: 8 }}>{p.jobActions}</div>
            {p.reimport}
          </Panel>
        )}
        {p.importSummary && <Panel title="Import summary">{p.importSummary}</Panel>}
        {p.planned && (
          <>
            {p.planned.notices}
            <Panel title="Documents">
              {p.planned.cutSheet}
              {p.planned.labels}
            </Panel>
            <Panel title="Progress">{p.planned.progress}</Panel>
            {p.planned.manualOps}
            {p.planned.sheets.map((s) => (
              <Panel key={s.id} title={`${s.code} · ${s.name}`} aside={<span className="tally">{s.cut} / {s.total} Cut</span>}>
                {s.node}
              </Panel>
            ))}
            <Panel title="Side B">{p.planned.sideB}</Panel>
          </>
        )}
      </>
    );
  return (
    <div style={{ display: 'grid', gridTemplateRows: 'auto 1fr', height: '100%' }}>
      <header className="topbar">
        <h1>{p.title}</h1>
        {p.nav(view, setView)}
        <span className="spacer" />
        {p.loadControls}
      </header>
      <main className="scroll">
        <div style={{ maxWidth: 980, margin: '0 auto', padding: 12 }}>{body}</div>
      </main>
    </div>
  );
}
