import { sheetCode, type Job } from '../core/job.ts';
import type { Part } from '../core/model.ts';
import type { SheetPlan } from '../core/planner/index.ts';
import { boardId, type Progress, type Rollup } from '../core/progress.ts';
import { voidText } from '../core/reimport.ts';
import { mmExact } from '../core/units.ts';
import { BlankLayout } from './BlankLayout.tsx';
import { BoardBreakdown } from './BoardBreakdown.tsx';
import { SheetCodeField } from './fields.tsx';
import { PartDetail } from './PartDetail.tsx';
import { PartList } from './PartList.tsx';
import { now, type JobActions } from './useJobSession.ts';

interface Props {
  job: Job;
  sheet: SheetPlan;
  progress: Progress;
  rolled: Rollup;
  nameOf: (partId: string) => string;
  sideBOf: (partId: string) => string | undefined;
  where: ReadonlyMap<string, string>;
  /** Parts waiting for Regenerate (re-import, Remakes). */
  needsNesting: readonly string[];
  actions: JobActions;
}

/** One Sheet of the planned Job: its code, each Board's Breakdown, each Blank's Layout and the Part list. */
export function SheetSection({ job, sheet, progress, rolled, nameOf, sideBOf, where, needsNesting, actions }: Props) {
  const partById = new Map<string, Part>(job.model.parts.map((p) => [p.id, p]));
  const blankRoll = new Map(rolled.blanks.map((b) => [b.id, b]));
  const boardRoll = new Map(rolled.boards.map((b) => [b.id, b]));
  const model = job.model.sheets.find((s) => s.id === sheet.sheetId);

  return (
    <section>
      <h3>
        {sheet.code} · {model?.name}
      </h3>
      <SheetCodeField
        key={sheetCode(job, sheet.sheetId)}
        code={sheetCode(job, sheet.sheetId)}
        sheetName={model?.name ?? sheet.sheetId}
        onCommit={(code) => {
          actions.sheetCode(sheet.sheetId, code);
        }}
      />
      <h4>Breakdown</h4>
      {sheet.boards.map((board) => {
        const id = boardId(sheet, board);
        const roll = boardRoll.get(id);
        return (
          <div key={board.number}>
            <BoardBreakdown code={sheet.code} board={board} nameOf={nameOf} onDiscard={actions.discard} />
            {board.sawParts.length > 0 && (
              <p>
                <button
                  type="button"
                  disabled={roll?.sawCut === roll?.sawTotal}
                  onClick={() => {
                    actions.progress({ kind: 'breakdownDone', boardId: id, at: now() });
                  }}
                >
                  Breakdown done {sheet.code} Board {board.number}
                </button>{' '}
                <span className="tally">
                  {roll?.sawCut ?? 0} / {roll?.sawTotal ?? 0} Saw Parts Cut
                </span>
              </p>
            )}
          </div>
        );
      })}
      <h4>Layouts</h4>
      {sheet.boards.flatMap((board) =>
        board.blanks.map((blank) => {
          const roll = blankRoll.get(blank.id);
          return (
            <figure key={blank.id}>
              <figcaption>
                <strong>{blank.id}</strong> · {mmExact(blank.length)} × {mmExact(blank.width)} mm ·{' '}
                {blank.from && <>from kept Offcut {blank.from} · </>}
                {roll?.total ?? blank.parts.length} Part(s){' '}
                <button
                  type="button"
                  disabled={roll?.cut === roll?.total}
                  onClick={() => {
                    actions.progress({ kind: 'sideADone', blankId: blank.id, at: now() });
                  }}
                >
                  Side A done {blank.id}
                </button>{' '}
                <span className="tally">
                  {roll?.cut ?? 0} / {roll?.total ?? blank.parts.length} Cut · {roll?.done ?? 0} /{' '}
                  {roll?.total ?? blank.parts.length} Done
                </span>
                {roll?.locked && <span className="locked"> · Locked</span>}
              </figcaption>
              <BlankLayout
                blank={blank}
                clampMargin={blank.clampMargin ?? job.plan.settings.clampMargin}
                nameOf={nameOf}
                sideBOf={sideBOf}
                voidOf={(id) => voidText(job.plan, id)}
              />
              <ol>
                {blank.parts.map((p) => {
                  const part = partById.get(p.partId);
                  const size = `${mmExact(p.cutLength)} × ${mmExact(p.cutWidth)}${p.rotated ? ' (turned)' : ''}`;
                  return (
                    <li key={p.partId} value={p.n}>
                      {part ? (
                        <PartDetail part={part}>
                          <div>
                            {size}
                            {p.narrow && <span className="warn"> · narrow: check tabs</span>}
                          </div>
                        </PartDetail>
                      ) : (
                        <code>{p.partId}</code>
                      )}
                    </li>
                  );
                })}
              </ol>
            </figure>
          );
        }),
      )}
      <PartList
        job={job}
        sheet={sheet}
        progress={progress}
        where={where}
        needsNesting={needsNesting}
        overflow={sheet.overflow ?? []}
        onRemake={actions.askRemake}
        onMode={actions.partMode}
        onStep={actions.step}
      />
    </section>
  );
}
