import type { Blank } from '../core/planner/index.ts';

interface Props {
  blank: Blank;
  clampMargin: number;
  /** A Part's display name (`<Owner label> · <Part name>`) from its id. */
  nameOf: (partId: string) => string;
  /** The Side B file id of a Flip Part (drawn shaded); undefined for other Parts. */
  sideBOf: (partId: string) => string | undefined;
}

/** A plain SVG of one Blank's Layout: front edge at the bottom, X to the right, in mm. */
export function BlankLayout({ blank, clampMargin, nameOf, sideBOf }: Props) {
  const mm = (um: number) => um / 1000;
  const L = mm(blank.length);
  const W = mm(blank.width);
  const c = mm(clampMargin);
  // SVG Y runs down; the Blank's Y runs back from the front edge, drawn upwards.
  const flipY = (y: number, h: number) => W - y - h;

  return (
    <svg
      viewBox={`0 0 ${String(L)} ${String(W)}`}
      width={Math.min(480, L / 2.5)}
      role="img"
      aria-label={`Layout of ${blank.id}`}
      style={{ background: 'var(--blank-bg)', display: 'block' }}
    >
      <rect x={0} y={0} width={L} height={W} fill="none" stroke="var(--ref)" strokeWidth={2} />
      <rect
        x={c}
        y={c}
        width={L - 2 * c}
        height={W - 2 * c}
        fill="none"
        stroke="var(--ref)"
        strokeDasharray="12 8"
        strokeWidth={1.5}
      />
      {blank.parts.map((p) => {
        const w = mm(p.rotated ? p.cutWidth : p.cutLength);
        const h = mm(p.rotated ? p.cutLength : p.cutWidth);
        const x = mm(p.x);
        const y = flipY(mm(p.y), h);
        const sideB = sideBOf(p.partId);
        const classes = [p.narrow ? 'narrow' : '', sideB === undefined ? '' : 'flip'].join(' ').trim();
        const notes = `${p.narrow ? ' (narrow: check tabs)' : ''}${sideB === undefined ? '' : ` (Flip Part: Side B ${sideB})`}`;
        return (
          <g key={p.partId} className={classes || undefined}>
            <title>{`#${String(p.n)} ${nameOf(p.partId)}${notes}`}</title>
            <rect
              x={x}
              y={y}
              width={w}
              height={h}
              fill={sideB === undefined ? 'var(--part-bg)' : 'var(--flip-bg)'}
              stroke={p.narrow ? 'var(--warn)' : 'var(--part)'}
              strokeWidth={p.narrow ? 4 : 2}
              strokeDasharray={p.narrow ? '10 5' : undefined}
            />
            <text
              x={x + w / 2}
              y={y + h / 2}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={Math.max(14, Math.min(48, h * 0.4, w * 0.25))}
              fill="var(--text)"
            >
              {`#${String(p.n)}${p.narrow ? ' !' : ''}`}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
