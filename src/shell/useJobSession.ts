// The open Job and everything done to it: one hook that owns the page's Job state, saves every change to
// the Job store straight away, and turns the person's actions into core calls. Views only read `state` and
// call `actions`; the domain rules stay in core.
import { useEffect, useState } from 'react';
import { sideBFileName, toDxfFiles } from '../core/dxf/index.ts';
import { importExport, type ImportIssue } from '../core/import/index.ts';
import { addBoards, generateJob, regenerate, remake, setOffcutDiscarded, setPartMode, setSheetCode, type Job } from '../core/job.ts';
import {
  createJobDocument,
  dismissSpare,
  fromJobFile,
  jobFileName,
  openJobDocument,
  renameJob,
  setArchived,
  shortIdFor,
  toJobFile,
  withChoices,
  withJob,
  withProgress,
  type JobDocument,
} from '../core/job-store/document.ts';
import { openFileDecision, type JobSummary } from '../core/job-store/store.ts';
import type { Model } from '../core/model.ts';
import type { PartMode, SideBFile } from '../core/planner/index.ts';
import { apply, wouldUnlock, type Progress, type ProgressEvent, type Step } from '../core/progress.ts';
import { applyReimport, diff, revertReimport, type Diff, type DiffEntry, type Unpair } from '../core/reimport.ts';
import type { Settings } from '../core/settings.ts';
import { downloadBytes, safeFileName, zipFiles } from './download.ts';
import { createDexieJobStore } from './job-store-dexie.ts';
import { loadSettings, saveSettings } from './settings-store.ts';

/** Every Job lives in IndexedDB; every change to the open Job is saved straight away. */
const store = createDexieJobStore();

/**
 * The Job open in the page: its stored document, the model Import rebuilt from its raw export, and
 * the planned Job (null while the maker reviews the import summary).
 */
export interface OpenJob {
  doc: JobDocument;
  model: Model;
  job: Job | null;
}

/** An updated export loaded into the open Job, under review in the diff screen. */
export interface PendingReimport {
  fileName: string;
  rawExport: string;
  model: Model;
  unpaired: Unpair[];
  /** New ids of Changed (cut) Parts already cut that the maker fixes by hand instead of remaking. */
  fixByHand: string[];
}

export interface JobSessionState {
  open: OpenJob | null;
  jobs: JobSummary[];
  /** Import issues of the open Job's export (or of a file that failed to load). */
  issues: ImportIssue[];
  loadError: string | null;
  storeError: string | null;
  /** The global Machine settings. */
  settings: Settings;
  /** A refused edit (Sheet code, Saw / CNC, Remake, Discard). */
  codeError: string | null;
  /** An untick waiting for confirmation because it would unlock these Board and Blank ids. */
  pendingUntick: { partId: string; step: Step; unlocks: string[] } | null;
  /** A Remake waiting for confirmation. */
  pendingRemake: string | null;
  reimport: PendingReimport | null;
  /** The diff under review, recomputed from the open Job and the maker's choices. */
  reviewDiff: Diff | null;
  /** A .job.json whose saved copy is older, waiting for "Replace". */
  pendingReplace: { doc: JobDocument; question: string } | null;
}

/** localStorage key of the Job to reopen after a reload. */
const OPEN_JOB_KEY = 'cut-optimizer.open-job';

function rememberOpenJob(id: string | null) {
  try {
    if (id === null) localStorage.removeItem(OPEN_JOB_KEY);
    else localStorage.setItem(OPEN_JOB_KEY, id);
  } catch {
    // Reopening the last Job on reload is a convenience only.
  }
}

function lastOpenJob(): string | null {
  try {
    return localStorage.getItem(OPEN_JOB_KEY);
  } catch {
    return null;
  }
}

/** The current time, ISO 8601: tick times and update times. */
export const now = () => new Date().toISOString();
const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** The diff under review: the open Job's ticks decide Remake or Spare; the maker's unpairs and Fix by hand choices. */
function reviewDiffOf(open: OpenJob, reimport: PendingReimport): Diff {
  return diff({ model: open.model, plan: open.doc.plan, progress: open.doc.progress }, reimport.model, {
    unpaired: reimport.unpaired,
    fixByHand: reimport.fixByHand,
  });
}

export function useJobSession() {
  const [open, setOpen] = useState<OpenJob | null>(null);
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [issues, setIssues] = useState<ImportIssue[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [storeError, setStoreError] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [pendingUntick, setPendingUntick] = useState<JobSessionState['pendingUntick']>(null);
  const [pendingRemake, setPendingRemake] = useState<string | null>(null);
  const [reimport, setReimport] = useState<PendingReimport | null>(null);
  const [pendingReplace, setPendingReplace] = useState<JobSessionState['pendingReplace']>(null);

  useEffect(() => {
    let current = true;
    void (async () => {
      try {
        const list = await store.list();
        if (!current) return;
        setJobs(list);
        const last = lastOpenJob();
        const doc = last === null ? undefined : await store.get(last);
        if (!current || !doc) return;
        const opened = openJobDocument(doc);
        if ('error' in opened) {
          setLoadError(opened.error);
          return;
        }
        setOpen({ doc, model: opened.model, job: opened.job });
        setIssues(opened.issues);
      } catch (err) {
        if (current) setStoreError(`The saved Jobs could not be read: ${errorText(err)}`);
      }
    })();
    return () => {
      current = false;
    };
  }, []);

  async function refreshJobs() {
    setJobs(await store.list());
  }

  /** Makes `doc` the open Job and saves it. */
  function save(doc: JobDocument, model: Model, job: Job | null) {
    setOpen({ doc, model, job });
    rememberOpenJob(doc.id);
    store
      .put(doc)
      .then(() => {
        setStoreError(null);
        return refreshJobs();
      })
      .catch((err: unknown) => {
        setStoreError(`This Job could not be saved in the browser: ${errorText(err)}. Download it to keep it.`);
      });
  }

  function resetMessages() {
    setPendingUntick(null);
    setPendingReplace(null);
    setReimport(null);
    setIssues([]);
    setLoadError(null);
    setCodeError(null);
  }

  /** Saves a document whose raw export changed, rebuilding its model and issues. */
  function reopen(doc: JobDocument) {
    const opened = openJobDocument(doc);
    if ('error' in opened) {
      setLoadError(opened.error);
      return;
    }
    setPendingUntick(null);
    setIssues(opened.issues);
    save(doc, opened.model, opened.job);
  }

  /** Opens a Job document: shows it, and saves it when it came from a file. */
  function openDocument(doc: JobDocument, persist: boolean) {
    const opened = openJobDocument(doc);
    if ('error' in opened) {
      setLoadError(opened.error);
      return;
    }
    setIssues(opened.issues);
    if (persist) save(doc, opened.model, opened.job);
    else {
      setOpen({ doc, model: opened.model, job: opened.job });
      rememberOpenJob(doc.id);
    }
  }

  async function openStored(id: string) {
    resetMessages();
    try {
      const doc = await store.get(id);
      if (doc) openDocument(doc, false);
    } catch (err) {
      setLoadError(errorText(err));
    }
  }

  /** Re-plans the open Job (result of a core call) and saves it: a re-plan ends a stale Plan and Revert. */
  function saveReplanned(job: Job) {
    if (!open) return;
    save(withJob(open.doc, job, now()), open.model, job);
  }

  /** A core edit that may be refused: shows the refusal, else saves. */
  function edited<T>(result: T | { error: string }, then: (value: T) => void) {
    if (typeof result === 'object' && result !== null && 'error' in result) {
      setCodeError(result.error);
      return;
    }
    setCodeError(null);
    then(result as T);
  }

  function progressEvent(event: ProgressEvent) {
    if (!open?.job) return;
    const progress = apply(open.job, open.doc.progress, event);
    if (progress !== open.doc.progress) save(withProgress(open.doc, progress, now()), open.model, open.job);
  }

  const actions = {
    /** Loads a Parts Export as a new, unplanned Job. */
    async loadExport(file: File) {
      setOpen(null);
      resetMessages();
      const text = await file.text();
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch (err) {
        setLoadError(`${file.name} is not JSON: ${errorText(err)}`);
        return;
      }
      const result = importExport(json);
      setIssues(result.issues);
      if (!result.model) {
        setLoadError(`${file.name} is not a valid Parts Export v1. Nothing was loaded.`);
        return;
      }
      const id = crypto.randomUUID();
      const shortId = shortIdFor(
        id,
        jobs.map((j) => j.shortId),
      );
      const doc = createJobDocument({ id, shortId, rawExport: text, fileName: file.name, model: result.model, settings, now: now() });
      save(doc, result.model, null);
    },

    /** Opens a .job.json. Never loses work and never rewrites a short id (core `openFileDecision`). */
    async openFile(file: File) {
      resetMessages();
      const read = fromJobFile(await file.text());
      if ('error' in read) {
        setLoadError(`${file.name}: ${read.error}`);
        return;
      }
      const decision = openFileDecision(read.doc, jobs);
      if (decision.kind === 'new') openDocument(read.doc, true);
      else if (decision.kind === 'same') await openStored(read.doc.id);
      else if (decision.kind === 'replace') setPendingReplace({ doc: read.doc, question: decision.question });
      else setLoadError(`${file.name}: ${decision.reason}`);
    },
    confirmReplace() {
      if (pendingReplace) openDocument(pendingReplace.doc, true);
      setPendingReplace(null);
    },
    cancelReplace() {
      setPendingReplace(null);
    },

    openStored,

    async archive(id: string, archived: boolean) {
      try {
        if (open?.doc.id === id) {
          save(setArchived(open.doc, archived, now()), open.model, open.job);
          return;
        }
        const doc = await store.get(id);
        if (!doc) return;
        await store.put(setArchived(doc, archived, now()));
        await refreshJobs();
      } catch (err) {
        setStoreError(errorText(err));
      }
    },

    async remove(id: string) {
      try {
        await store.delete(id);
        if (open?.doc.id === id) {
          setOpen(null);
          resetMessages();
          rememberOpenJob(null);
        }
        await refreshJobs();
      } catch (err) {
        setStoreError(errorText(err));
      }
    },

    rename(name: string) {
      if (!open) return;
      const doc = renameJob(open.doc, name, now());
      if (doc !== open.doc) save(doc, open.model, open.job);
    },

    saveSettings(next: Settings): boolean {
      setSettings(next);
      return saveSettings(next);
    },

    plan() {
      if (!open) return;
      saveReplanned(generateJob(open.model, settings, open.doc.sheetCodes, open.doc.sawCncOverrides));
    },

    regenerate() {
      if (!open?.job) return;
      saveReplanned(regenerate(open.job, settings, open.doc.progress));
    },

    /** The person agreed to more Boards for a Sheet whose Parts fit nowhere else. */
    addBoards(sheetId: string) {
      if (!open?.job) return;
      saveReplanned(addBoards(open.job, [sheetId], open.doc.progress));
    },

    /** Records a Sheet code; the next Regenerate applies it. */
    sheetCode(sheetId: string, code: string) {
      if (!open?.job) return;
      edited(setSheetCode(open.job, sheetId, code, open.doc.progress), ({ job }) => {
        save(withChoices(open.doc, job, now()), open.model, job);
      });
    },

    /** Records a Saw / CNC choice; the next Regenerate applies it. */
    partMode(partId: string, mode: PartMode) {
      if (!open?.job) return;
      edited(setPartMode(open.job, partId, mode, open.doc.progress), ({ job }) => {
        save(withChoices(open.doc, job, now()), open.model, job);
      });
    },

    askRemake(partId: string | null) {
      setPendingRemake(partId);
    },
    /** Marks a ruined Part Remake (after confirmation): ticks cleared, greyed on its old Blank, nested at regenerate. */
    remake(partId: string) {
      setPendingRemake(null);
      if (!open?.job) return;
      edited(remake(open.job, open.doc.progress, partId), (result) => {
        // Not a re-plan: only marks in the stored Plan change, so a pending re-import stays revertable.
        const at = now();
        save(withProgress({ ...open.doc, plan: result.job.plan, updatedAt: at }, result.progress, at), open.model, result.job);
      });
    },

    discard(offcutId: string, discarded: boolean) {
      if (!open?.job) return;
      edited(setOffcutDiscarded(open.job, offcutId, discarded), ({ job }) => {
        save({ ...open.doc, plan: job.plan, updatedAt: now() }, open.model, job);
      });
    },

    /** A tick, untick or bulk tick. */
    progress: progressEvent,

    /** Ticks or unticks one Step. Unticking asks first when it would unlock a Board or Blank. */
    step(partId: string, step: Step, ticked: boolean) {
      if (!open?.job) return;
      setPendingUntick(null);
      if (ticked) {
        progressEvent({ kind: 'tick', partId, step, at: now() });
        return;
      }
      const unlocks = wouldUnlock(open.job, open.doc.progress, partId, step);
      if (unlocks.length > 0) setPendingUntick({ partId, step, unlocks });
      else progressEvent({ kind: 'untick', partId, step });
    },
    confirmUntick() {
      if (pendingUntick) progressEvent({ kind: 'untick', partId: pendingUntick.partId, step: pendingUntick.step });
      setPendingUntick(null);
    },
    cancelUntick() {
      setPendingUntick(null);
    },

    /** Scan mode ticked something. */
    scanned(progress: Progress) {
      if (open?.job) save(withProgress(open.doc, progress, now()), open.model, open.job);
    },

    /** Loads an updated export into the open Job and shows the diff screen. Nothing changes until Apply. */
    async reimportFile(file: File) {
      if (!open) return;
      setReimport(null);
      setLoadError(null);
      const text = await file.text();
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch (err) {
        setLoadError(`${file.name} is not JSON: ${errorText(err)}`);
        return;
      }
      const result = importExport(json);
      if (!result.model) {
        setIssues(result.issues);
        setLoadError(`${file.name} is not a valid Parts Export v1. The Job is unchanged.`);
        return;
      }
      setReimport({ fileName: file.name, rawExport: text, model: result.model, unpaired: [], fixByHand: [] });
    },
    unpair(entry: DiffEntry) {
      if (!reimport || entry.oldId === undefined || entry.newId === undefined) return;
      setReimport({ ...reimport, unpaired: [...reimport.unpaired, { oldId: entry.oldId, newId: entry.newId }] });
    },
    fixByHand(entry: DiffEntry, fix: boolean) {
      const id = entry.newId;
      if (!reimport || id === undefined) return;
      const others = reimport.fixByHand.filter((x) => x !== id);
      setReimport({ ...reimport, fixByHand: fix ? [...others, id] : others });
    },
    /** Applies the reviewed re-import, all or nothing, and reopens the Job from its new document. */
    applyReimport() {
      if (!open || !reimport) return;
      const doc = applyReimport(open.doc, open.model, reimport, reviewDiffOf(open, reimport), now());
      setReimport(null);
      reopen(doc);
    },
    cancelReimport() {
      setReimport(null);
    },
    revertReimport() {
      if (!open) return;
      const doc = revertReimport(open.doc);
      if (doc) reopen(doc);
    },

    dismissSpare(partId: string) {
      if (!open) return;
      save(dismissSpare(open.doc, partId, now()), open.model, open.job);
    },

    downloadDxfs() {
      if (!open?.job) return;
      const zip = zipFiles(toDxfFiles(open.job.plan, open.doc.shortId));
      downloadBytes(zip, `${safeFileName(open.model.projectName)}.dxf.zip`, 'application/zip');
    },
    downloadSideB(file: SideBFile) {
      if (!open?.job) return;
      const name = sideBFileName(open.doc.shortId, file);
      const text = toDxfFiles(open.job.plan, open.doc.shortId).get(name);
      if (text !== undefined) downloadBytes(new TextEncoder().encode(text), name, 'application/dxf');
    },
    downloadJob() {
      if (!open) return;
      const bytes = new TextEncoder().encode(toJobFile(open.doc));
      downloadBytes(bytes, safeFileName(jobFileName(open.doc)), 'application/json');
    },
  };

  const state: JobSessionState = {
    open,
    jobs,
    issues,
    loadError,
    storeError,
    settings,
    codeError,
    pendingUntick,
    pendingRemake,
    reimport,
    reviewDiff: open && reimport ? reviewDiffOf(open, reimport) : null,
    pendingReplace,
  };
  return { state, actions };
}

export type JobSession = ReturnType<typeof useJobSession>;
export type JobActions = JobSession['actions'];
