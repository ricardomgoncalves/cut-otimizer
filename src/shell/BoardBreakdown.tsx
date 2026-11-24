import type { Board } from '../core/planner/index.ts';

interface Props {
  code: string;
  board: Board;
  /** How to show a Saw Part. */
  nameOf: (partId: string) => string;
  /** Discards a kept Offcut (it is no longer stock), or undoes that. */
  onDiscard: (offcutId: string, discarded: boolean) => void;
}

const mm = (um: number) => um / 1000;
const fmt = (um: number) => String(Math.round(um / 100) / 10);

/**
 * One Board's Breakdown: Blanks, Saw Parts and Offcuts, with the rips (`1, 2…`) and crosscuts
 * (`1a, 1b…`) numbered in saw order, and the cut list beside it. Front edge at the bottom, in mm.
 */
export function BoardBreakdown({ code, board, nameOf, onDiscard }: Props) {
  const L = mm(board.length);
  const W = mm(board.width);
  const flipY = (y: number, h: number) => W - y - h;
  const name = `${code} Board ${String(board.number)}`;
  const font = Math.max(28, Math.min(L, W) / 30);
  const hatch = `hatch-${code}-${String(board.number)}`;

  const label = (x: number, y: number, length: number, width: number, text: string, sub?: string) => {
    const cx = mm(x + length / 2);
    const cy = flipY(mm(y), mm(width)) + mm(width) / 2;
    const size = Math.min(font, mm(width) * 0.6, (mm(length) / Math.max(text.length, 1)) * 1.6);
    return (
      <text
        className="piece-label"
        x={cx}
        y={cy}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={size}
        fill="var(--text)"
      >
        {text}
        {sub && (
          <tspan x={cx} dy={size * 1.1} fontSize={size * 0.7}>
            {sub}
          </tspan>
        )}
      </text>
    );
  };

  return (
    <figure className="breakdown">
      <figcaption>
        <strong>{name}</strong> · {fmt(board.length)} × {fmt(board.width)} mm
      </figcaption>
      <svg
        viewBox={`0 0 ${String(L)} ${String(W)}`}
        width={Math.min(640, L / 4)}
        role="img"
        aria-label={`Breakdown of ${name}`}
        style={{ background: 'var(--waste-bg)', display: 'block' }}
      >
        <defs>
          <pattern id={hatch} width={40} height={40} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1={0} y1={0} x2={0} y2={40} stroke="var(--ref)" strokeWidth={6} />
          </pattern>
        </defs>
        <rect x={0} y={0} width={L} height={W} fill={`url(#${hatch})`} stroke="var(--ref)" strokeWidth={4} />
        {board.offcuts.map((o, i) => {
          const size = `${fmt(o.length)} × ${fmt(o.width)}`;
          const keep = o.kept && !o.discarded && !o.used;
          const classes = ['offcut', o.kept ? 'kept' : '', o.discarded ? 'discarded' : '', o.used ? 'used' : ''];
          const note = o.used ? ' (cut up for new Blanks)' : o.discarded ? ' (discarded)' : o.kept ? ' (keep)' : '';
          return (
            <g key={`o${String(i)}`} className={classes.join(' ').trim()}>
              <title>{`Offcut${o.id ? ` ${o.id}` : ''} ${size}${note}`}</title>
              <rect
                x={mm(o.x)}
                y={flipY(mm(o.y), mm(o.width))}
                width={mm(o.length)}
                height={mm(o.width)}
                fill={o.used ? 'none' : keep ? 'var(--offcut-bg)' : `url(#${hatch})`}
                stroke="var(--ref)"
                strokeWidth={2}
                strokeDasharray={o.used ? '16 10' : undefined}
              />
              {keep && label(o.x, o.y, o.length, o.width, o.id ? `Keep ${o.id}` : 'Keep', size)}
              {o.discarded && label(o.x, o.y, o.length, o.width, `Discarded ${o.id ?? ''}`, size)}
            </g>
          );
        })}
        {board.blanks.map((b) => (
          <g key={b.id} className="blank">
            <title>{`${b.id} ${fmt(b.length)} × ${fmt(b.width)}`}</title>
            <rect
              x={mm(b.x)}
              y={flipY(mm(b.y), mm(b.width))}
              width={mm(b.length)}
              height={mm(b.width)}
              fill="var(--blank-bg)"
              stroke="var(--part)"
              strokeWidth={3}
            />
            {label(b.x, b.y, b.length, b.width, b.id)}
          </g>
        ))}
        {board.sawParts.map((p) => (
          <g key={p.partId} className="saw-part">
            <title>{`Saw Part ${nameOf(p.partId)} ${fmt(p.length)} × ${fmt(p.width)}`}</title>
            <rect
              x={mm(p.x)}
              y={flipY(mm(p.y), mm(p.width))}
              width={mm(p.length)}
              height={mm(p.width)}
              fill="var(--saw-bg)"
              stroke="var(--part)"
              strokeWidth={3}
            />
            {label(p.x, p.y, p.length, p.width, nameOf(p.partId))}
          </g>
        ))}
        {board.cuts.map((c) => {
          const rip = c.kind === 'rip';
          const x1 = mm(c.x);
          const y1 = W - mm(c.y);
          const x2 = rip ? mm(c.x + c.length) : x1;
          const y2 = rip ? y1 : W - mm(c.y + c.length);
          return (
            <g key={c.label} className="cut">
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--cut)" strokeWidth={6} />
              <text
                className="cut-label"
                x={rip ? x1 + font * 0.4 : x1 + font * 0.3}
                y={rip ? y1 - font * 0.3 : y2 + font}
                fontSize={font}
                fontWeight="bold"
                fill="var(--cut)"
              >
                {c.label}
              </text>
            </g>
          );
        })}
      </svg>
      <table aria-label={`Cuts of ${name}`} className="cuts">
        <thead>
          <tr>
            <th scope="col">Cut</th>
            <th scope="col">Kind</th>
            <th scope="col">At (mm)</th>
            <th scope="col">Length (mm)</th>
          </tr>
        </thead>
        <tbody>
          {board.cuts.map((c) => (
            <tr key={c.label}>
              <th scope="row">{c.label}</th>
              <td>
                {c.kind === 'rip' ? 'rip' : 'crosscut'}
                {c.from && ` from ${c.from}`}
              </td>
              <td>{c.kind === 'rip' ? `y ${fmt(c.y)}` : `x ${fmt(c.x)}`}</td>
              <td>{fmt(c.length)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {board.offcuts.some((o) => o.kept && !o.used && o.id) && (
        <fieldset className="offcuts">
          <legend>Kept Offcuts of {name}</legend>
          {board.offcuts.map((o) =>
            o.kept && !o.used && o.id ? (
              <label key={o.id}>
                <input
                  type="checkbox"
                  checked={o.discarded === true}
                  onChange={(e) => {
                    if (o.id) onDiscard(o.id, e.target.checked);
                  }}
                />{' '}
                Discard {o.id}{' '}
                <span className="tally">
                  ({fmt(o.length)} × {fmt(o.width)})
                </span>{' '}
              </label>
            ) : null,
          )}
        </fieldset>
      )}
    </figure>
  );
}
