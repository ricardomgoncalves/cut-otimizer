import { useMemo, useState } from 'react';
import { labels, pageToSvg, sizeLadder, type LabelsJob } from '../core/documents/index.ts';
import type { Plan } from '../core/planner/index.ts';
import { downloadBytes, safeFileName } from './download.ts';

interface Props {
  plan: Plan;
  job: LabelsJob;
}

/**
 * Part labels on L7163 sticker sheets: "Labels" shows the sheets as SVG (the same page model the PDF is drawn
 * from); "Download labels PDF" and "Download size ladder PDF" render with pdf-lib, loaded on demand.
 */
export function LabelsPanel({ plan, job }: Props) {
  const [shown, setShown] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pages = useMemo(() => (shown ? labels(plan, job) : []), [shown, plan, job]);

  async function download(make: () => ReturnType<typeof labels>, title: string, fileName: string) {
    setError(null);
    try {
      const { pagesToPdf } = await import('./pdf.ts');
      downloadBytes(await pagesToPdf(make(), { title }), fileName, 'application/pdf');
    } catch (e) {
      setError(`The PDF could not be made: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return (
    <section aria-label="Part labels" className="cut-sheet">
      <p>
        <button
          type="button"
          aria-expanded={shown}
          onClick={() => {
            setShown(!shown);
          }}
        >
          Labels
        </button>{' '}
        <button
          type="button"
          onClick={() => void download(() => labels(plan, job), `Labels · ${job.name}`, `${safeFileName(job.name)}.labels.pdf`)}
        >
          Download labels PDF
        </button>{' '}
        <button
          type="button"
          onClick={() => void download(() => [sizeLadder(job)], 'Size ladder', 'size-ladder.pdf')}
        >
          Download size ladder PDF
        </button>
      </p>
      <p>Print on L7163 sheets (2 × 7, 99.1 × 38.1 mm) at 100 %; stick each label on the Part&apos;s bottom face.</p>
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
              aria-label={`Label sheet ${String(i + 1)} of ${String(pages.length)}`}
              dangerouslySetInnerHTML={{ __html: pageToSvg(page) }}
            />
          ))}
        </div>
      )}
    </section>
  );
}
