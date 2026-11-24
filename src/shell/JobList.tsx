import { useState } from 'react';
import type { JobSummary } from '../core/job-store/store.ts';

interface Props {
  jobs: JobSummary[];
  openId: string | null;
  onOpen: (id: string) => void;
  onArchive: (id: string, archived: boolean) => void;
  onDelete: (id: string) => void;
}

/** The saved Jobs, newest first. Archived Jobs are hidden unless asked for. Delete asks once more. */
export function JobList({ jobs, openId, onOpen, onArchive, onDelete }: Props) {
  const [showArchived, setShowArchived] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const shown = jobs.filter((j) => showArchived || !j.archived);

  return (
    <section aria-label="Jobs">
      <h2>Jobs</h2>
      {jobs.length === 0 ? (
        <p>No Jobs yet. Load an export to start one.</p>
      ) : (
        <>
          <label>
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => {
                setShowArchived(e.target.checked);
              }}
            />{' '}
            Show archived Jobs
          </label>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Short id</th>
                <th>Changed</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.map((j) => (
                <tr key={j.id} aria-current={j.id === openId ? 'true' : undefined}>
                  <td>
                    {j.id === openId ? <strong>{j.name}</strong> : j.name}
                    {j.archived && <small> (archived)</small>}
                  </td>
                  <td>
                    <code>{j.shortId}</code>
                  </td>
                  <td>{j.updatedAt.slice(0, 16).replace('T', ' ')}</td>
                  <td>
                    {j.id !== openId && (
                      <button
                        type="button"
                        aria-label={`Open ${j.name}`}
                        onClick={() => {
                          onOpen(j.id);
                        }}
                      >
                        Open
                      </button>
                    )}{' '}
                    <button
                      type="button"
                      aria-label={`${j.archived ? 'Unarchive' : 'Archive'} ${j.name}`}
                      onClick={() => {
                        onArchive(j.id, !j.archived);
                      }}
                    >
                      {j.archived ? 'Unarchive' : 'Archive'}
                    </button>{' '}
                    {confirming === j.id ? (
                      <>
                        <button
                          type="button"
                          aria-label={`Yes, delete ${j.name}`}
                          onClick={() => {
                            setConfirming(null);
                            onDelete(j.id);
                          }}
                        >
                          Yes, delete
                        </button>{' '}
                        <button
                          type="button"
                          onClick={() => {
                            setConfirming(null);
                          }}
                        >
                          Keep
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        aria-label={`Delete ${j.name}`}
                        onClick={() => {
                          setConfirming(j.id);
                        }}
                      >
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
