import { sideBFileName } from '../core/dxf/index.ts';
import type { CncOp, Point } from '../core/model.ts';
import { sideBPoint, type Edge, type JobManualOp, type SideBFile } from '../core/planner/index.ts';
import { mmExact, toMm as mm } from '../core/units.ts';

const OPPOSITE: Record<Edge, Edge> = { x0: 'xL', xL: 'x0', y0: 'yW', yW: 'y0' };

interface SideBProps {
  files: SideBFile[];
  /** The Job's short id: Side B file names start with it. */
  job: string;
  nameOf: (partId: string) => string;
  /** Where a Part is cut (`W18-1-A #1`, `Saw · Board 1`). */
  whereOf: (partId: string) => string | undefined;
  onDownload: (file: SideBFile) => void;
  /** "Side B done": ticks Side B on every Part of the file. */
  onDone: (file: SideBFile) => void;
  /** How many of a file's Parts have Side B ticked. */
  doneOf: (file: SideBFile) => number;
}

/** The Side B batch: one card per file with its bottom view, the Fence corner, the edge names and its Parts. */
export function SideBView({ files, job, nameOf, whereOf, onDownload, onDone, doneOf }: SideBProps) {
  if (files.length === 0) return null;
  return (
    <section aria-label="Side B">
      <h3>Side B</h3>
      <p>
        After Side A, set each Flip Part bottom-up and push it into the Fence corner: its edges go against the
        fences as named. Then run its file.
      </p>
      {files.map((file) => (
        <figure key={file.id}>
          <figcaption>
            <strong>{file.id}</strong> · <code>{sideBFileName(job, file)}</code> · {mmExact(file.cutLength)} ×{' '}
            {mmExact(file.cutWidth)} mm · {file.partIds.length} Part(s){' '}
            <button
              type="button"
              onClick={() => {
                onDownload(file);
              }}
            >
              Download {file.id}
            </button>{' '}
            <button
              type="button"
              disabled={doneOf(file) === file.partIds.length}
              onClick={() => {
                onDone(file);
              }}
            >
              Side B done {file.id}
            </button>{' '}
            <span className="tally">
              {doneOf(file)} / {file.partIds.length} Side B
            </span>
          </figcaption>
          <SideBDrawing file={file} />
          <p>
            <code>{file.longFence}</code> against long fence · <code>{file.shortFence}</code> against short fence
          </p>
          <ul>
            {file.partIds.map((id) => {
              const where = whereOf(id);
              return (
                <li key={id}>
                  {nameOf(id)}
                  {where === undefined ? '' : ` (${where})`}
                </li>
              );
            })}
          </ul>
        </figure>
      ))}
    </section>
  );
}

/**
 * The bottom view as the Side B file draws it: the Fence corner at the bottom left, the long fence along
 * the bottom edge, the short fence up the left edge, every edge named.
 */
function SideBDrawing({ file }: { file: SideBFile }) {
  const L = mm(file.length);
  const W = mm(file.width);
  const pad = Math.max(40, Math.max(L, W) * 0.08);
  const font = Math.max(14, Math.min(L, W) * 0.06);
  // File Y runs up from the long fence; SVG Y runs down.
  const at = (p: Point) => {
    const q = sideBPoint(file, p);
    return { x: pad + mm(q.x), y: pad + W - mm(q.y) };
  };
  const box = (a: Point, b: Point) => {
    const [p, q] = [at(a), at(b)];
    const x0 = Math.max(Math.min(p.x, q.x), pad);
    const x1 = Math.min(Math.max(p.x, q.x), pad + L);
    const y0 = Math.max(Math.min(p.y, q.y), pad);
    const y1 = Math.min(Math.max(p.y, q.y), pad + W);
    return { x: x0, y: y0, width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0) };
  };

  return (
    <svg
      viewBox={`0 0 ${String(L + 2 * pad)} ${String(W + 2 * pad)}`}
      width={Math.min(420, (L + 2 * pad) / 2.5)}
      role="img"
      aria-label={`Side B view of ${file.id}`}
      style={{ background: 'var(--blank-bg)', display: 'block' }}
    >
      <rect x={pad} y={pad} width={L} height={W} fill="var(--flip-bg)" stroke="var(--part)" strokeWidth={2} />
      <path
        className="fence-corner"
        d={`M ${String(pad - 6)} ${String(pad)} V ${String(pad + W + 6)} H ${String(pad + L)}`}
        fill="none"
        stroke="var(--cut)"
        strokeWidth={8}
      >
        <title>Fence corner (0, 0)</title>
      </path>
      {file.ops.map((op, i) => (
        <OpShape key={i} op={op} at={at} box={box} />
      ))}
      <text x={pad + L / 2} y={pad + W + pad * 0.75} textAnchor="middle" fontSize={font} fill="var(--text)">
        {file.longFence} · long fence
      </text>
      <text
        x={pad * 0.4}
        y={pad + W / 2}
        textAnchor="middle"
        fontSize={font}
        fill="var(--text)"
        transform={`rotate(-90 ${String(pad * 0.4)} ${String(pad + W / 2)})`}
      >
        {file.shortFence} · short fence
      </text>
      <text x={pad + L / 2} y={pad * 0.7} textAnchor="middle" fontSize={font} fill="var(--muted)">
        {OPPOSITE[file.longFence]}
      </text>
      <text
        x={pad + L + 4}
        y={pad + W / 2}
        textAnchor="start"
        dominantBaseline="central"
        fontSize={font}
        fill="var(--muted)"
      >
        {OPPOSITE[file.shortFence]}
      </text>
    </svg>
  );
}

function OpShape(props: {
  op: CncOp;
  at: (p: Point) => Point;
  box: (a: Point, b: Point) => { x: number; y: number; width: number; height: number };
}) {
  const { op, at, box } = props;
  const style = { fill: 'none', stroke: 'var(--text)', strokeWidth: 2 };
  switch (op.kind) {
    case 'drill': {
      const c = at(op.at);
      return <circle cx={c.x} cy={c.y} r={op.diameter / 2000} {...style} />;
    }
    case 'groove': {
      const half = op.width / 2;
      const alongX = op.from.y === op.to.y;
      const a = alongX ? { x: op.from.x, y: op.from.y - half } : { x: op.from.x - half, y: op.from.y };
      const b = alongX ? { x: op.to.x, y: op.to.y + half } : { x: op.to.x + half, y: op.to.y };
      return <rect {...box(a, b)} {...style} />;
    }
    case 'pocket': {
      const a = { x: op.centre.x - op.length / 2, y: op.centre.y - op.width / 2 };
      const b = { x: op.centre.x + op.length / 2, y: op.centre.y + op.width / 2 };
      return <rect {...box(a, b)} {...style} />;
    }
  }
}

/** The Job's Manual ops, with a warning: they are in no file. Renders nothing when there are none. */
export function ManualOpsList(props: { ops: JobManualOp[]; nameOf: (partId: string) => string }) {
  const { ops, nameOf } = props;
  if (ops.length === 0) return null;
  const count = ops.length === 1 ? '1 Manual op is' : `${String(ops.length)} Manual ops are`;
  return (
    <section aria-label="Manual ops" className="warning-box">
      <h3>Manual ops</h3>
      <p>
        {count} not in any file: do {ops.length === 1 ? 'it' : 'them'} by hand.
      </p>
      <table>
        <thead>
          <tr>
            <th scope="col">Part</th>
            <th scope="col">Op</th>
          </tr>
        </thead>
        <tbody>
          {ops.map((op, i) => (
            <tr key={i}>
              <td>{nameOf(op.partId)}</td>
              <td>{op.text}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
