import { useMemo, useState } from 'react';
import { cutSheet, pageToSvg, type CutSheetJob } from '../core/documents/index.ts';
import type { Plan } from '../core/planner/index.ts';
import { downloadBytes, safeFileName } from './download.ts';

interface Props {
  plan: Plan;
  job: Omit<CutSheetJob, 'generatedAt'>;
}

/** Local time as `YYYY-MM-DD HH:MM`. */
function localTime(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${String(d.getFullYear())}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * The cut sheet: "Cut sheet" shows the pages as SVG (the same page model the PDF is drawn from);
 * "Download PDF" renders them with pdf-lib, loaded on demand.
 */
export function CutSheetPanel({ plan, job }: Props) {
  const [shown, setShown] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewAt, setPreviewAt] = useState(() => localTime(new Date()));
  const pages = useMemo(
    () => (shown ? cutSheet(plan, { ...job, generatedAt: previewAt }) : []),
    [shown, plan, job, previewAt],
  );

  async function onDownload() {
    setError(null);
    try {
      const { pagesToPdf } = await import('./pdf.ts');
      const title = `Cut sheet · ${job.name}`;
      const bytes = await pagesToPdf(cutSheet(plan, { ...job, generatedAt: localTime(new Date()) }), { title });
      downloadBytes(bytes, `${safeFileName(job.name)}.cut-sheet.pdf`, 'application/pdf');
    } catch (e) {
      setError(`The PDF could not be made: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return (
    <section aria-label="Cut sheet" className="cut-sheet">
      <p>
        <button
          type="button"
          aria-expanded={shown}
          onClick={() => {
            setPreviewAt(localTime(new Date()));
            setShown(!shown);
          }}
        >
          Cut sheet
        </button>{' '}
        <button type="button" onClick={() => void onDownload()}>
          Download PDF
        </button>
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {shown && (
        <div className="sheet-pages">
          {pages.map((page, i) => (
            <div
              key={i}
              className="sheet-page"
              role="img"
              aria-label={`Cut sheet page ${String(i + 1)} of ${String(pages.length)}`}
              dangerouslySetInnerHTML={{ __html: pageToSvg(page) }}
            />
          ))}
        </div>
      )}
    </section>
  );
}
