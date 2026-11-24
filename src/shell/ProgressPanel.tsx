import type { Owner } from '../core/model.ts';
import type { Rollup } from '../core/progress.ts';

interface Props {
  rollup: Rollup;
  owners: Owner[];
}

const of = (n: number, total: number) => `${String(n)} / ${String(total)}`;

/**
 * The Job's roll-ups, computed from the ticks: the Job, each Owner (Cabinets first, then Generated
 * Items), and Cut per Sheet, Board and Blank. A Board or Blank with a Part ticked Cut is shown Locked.
 */
export function ProgressPanel({ rollup, owners }: Props) {
  const ownerById = new Map(owners.map((o) => [o.id, o]));
  const blanksOf = (boardId: string) => rollup.blanks.filter((b) => b.id.startsWith(`${boardId}-`));
  return (
    <section aria-label="Progress">
      <h3>Progress</h3>
      <p className="job-progress">
        Job: {of(rollup.job.done, rollup.job.total)} Done · {of(rollup.job.cut, rollup.job.total)} Cut
      </p>
      <table aria-label="Owner progress">
        <thead>
          <tr>
            <th scope="col">Owner</th>
            <th scope="col">Done</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {rollup.owners.map((o) => {
            const cabinetName = ownerById.get(o.ownerId)?.cabinetName;
            return (
              <tr key={o.ownerId}>
                <td>
                  {o.label}
                  {cabinetName && <small> · {cabinetName}</small>}
                </td>
                <td>{of(o.done, o.total)}</td>
                <td>{o.readyToAssemble ? 'ready to assemble' : ''}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <table aria-label="Cut progress">
        <thead>
          <tr>
            <th scope="col">Sheet, Board or Blank</th>
            <th scope="col">Cut</th>
            <th scope="col">Done</th>
            <th scope="col">Locked</th>
          </tr>
        </thead>
        <tbody>
          {rollup.sheets.map((sheet) => [
            <tr key={sheet.sheetId} className="sheet-row">
              <th scope="row">{sheet.code}</th>
              <td>{of(sheet.cut, sheet.total)}</td>
              <td />
              <td />
            </tr>,
            ...rollup.boards
              .filter((b) => b.sheetId === sheet.sheetId)
              .flatMap((board) => [
                <tr key={board.id}>
                  <th scope="row">Board {board.id}</th>
                  <td>{of(board.cut, board.total)}</td>
                  <td />
                  <td>{board.locked ? 'Locked' : ''}</td>
                </tr>,
                ...blanksOf(board.id).map((blank) => (
                  <tr key={blank.id}>
                    <th scope="row">Blank {blank.id}</th>
                    <td>{of(blank.cut, blank.total)}</td>
                    <td>{of(blank.done, blank.total)}</td>
                    <td>{blank.locked ? 'Locked' : ''}</td>
                  </tr>
                )),
              ]),
          ])}
        </tbody>
      </table>
      <p>
        <small>Locked: at least one of its Parts is ticked Cut.</small>
      </p>
    </section>
  );
}
