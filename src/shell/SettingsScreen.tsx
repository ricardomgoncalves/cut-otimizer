import { useState, type FormEvent } from 'react';
import { SETTING_LABELS } from './setting-labels.ts';
import type { Sheet } from '../core/model.ts';
import { fromMm, mmExact } from '../core/units.ts';
import {
  DEFAULT_SETTINGS,
  OP_KINDS,
  validateSettings,
  type OpKind,
  type Settings,
  type SettingsError,
} from '../core/settings.ts';

const LENGTH_FIELDS = [
  'bedLength',
  'bedWidth',
  'clampMargin',
  'bitDiameter',
  'sawKerf',
  'edgeTrim',
  'minCncWidth',
  'minOffcutSize',
] as const;
type LengthField = (typeof LENGTH_FIELDS)[number];

interface Draft {
  lengths: Record<LengthField, string>;
  /** Sheet id -> mm text; empty = no override. */
  trimBySheet: Record<string, string>;
  manualBottomOpKinds: OpKind[];
  fenceHeightNote: string;
}


function toDraft(s: Settings): Draft {
  return {
    lengths: Object.fromEntries(LENGTH_FIELDS.map((f) => [f, mmExact(s[f])])) as Record<LengthField, string>,
    trimBySheet: Object.fromEntries(Object.entries(s.edgeTrimBySheet).map(([id, um]) => [id, mmExact(um)])),
    manualBottomOpKinds: s.manualBottomOpKinds,
    fenceHeightNote: s.fenceHeightNote,
  };
}

/** mm text -> whole µm, or null when it isn't a length of 0 or more. */
function parseMm(text: string): number | null {
  if (text.trim() === '') return null;
  const mm = Number(text);
  return Number.isFinite(mm) && mm >= 0 ? fromMm(mm) : null;
}

function fromDraft(d: Draft): { settings: Settings; errors: string[] } {
  const errors: string[] = [];
  const settings: Settings = { ...DEFAULT_SETTINGS, edgeTrimBySheet: {} };
  for (const f of LENGTH_FIELDS) {
    const um = parseMm(d.lengths[f]);
    if (um === null) errors.push(`${SETTING_LABELS[f]} must be a length in mm, 0 or more.`);
    else settings[f] = um;
  }
  for (const [id, text] of Object.entries(d.trimBySheet)) {
    if (text.trim() === '') continue;
    const um = parseMm(text);
    if (um === null) errors.push(`Edge trim for Sheet ${id} must be a length in mm, 0 or more.`);
    else settings.edgeTrimBySheet[id] = um;
  }
  settings.manualBottomOpKinds = OP_KINDS.filter((k) => d.manualBottomOpKinds.includes(k));
  settings.fenceHeightNote = d.fenceHeightNote;
  if (errors.length === 0) errors.push(...validateSettings(settings).map((e: SettingsError) => e.message));
  return { settings, errors };
}

interface Props {
  settings: Settings;
  /** The open Job's Sheets, offered for per-Sheet edge trim. */
  sheets: Sheet[];
  onSave: (settings: Settings) => boolean;
}

/** The global Machine settings, edited as a draft and saved as a whole. Lengths are shown in mm. */
export function SettingsScreen({ settings, sheets, onSave }: Props) {
  const [draft, setDraft] = useState(() => toDraft(settings));
  const [errors, setErrors] = useState<string[]>([]);
  const [saved, setSaved] = useState<string | null>(null);

  const edit = (change: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...change }));
    setSaved(null);
  };

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const result = fromDraft(draft);
    setErrors(result.errors);
    if (result.errors.length > 0) {
      setSaved(null);
      return;
    }
    setSaved(
      onSave(result.settings)
        ? 'Settings saved.'
        : 'Settings saved for this page only: the browser would not store them.',
    );
  }

  // Sheets of the open Job first, then other Sheets that already have an override.
  const sheetNames = new Map(sheets.map((s) => [s.id, s.name]));
  const trimSheetIds = [
    ...sheets.map((s) => s.id),
    ...Object.keys(draft.trimBySheet).filter((id) => !sheetNames.has(id)),
  ];

  return (
    <form onSubmit={onSubmit} className="settings">
      <h2>Machine settings</h2>
      <p>
        Global to this browser. A Job keeps the settings it was generated with until you regenerate it.
      </p>

      <fieldset>
        <legend>CNC and saw</legend>
        {LENGTH_FIELDS.map((f) => (
          <p key={f}>
            <label>
              {SETTING_LABELS[f]} (mm){' '}
              <input
                type="number"
                min="0"
                step="any"
                value={draft.lengths[f]}
                onChange={(e) => {
                  edit({ lengths: { ...draft.lengths, [f]: e.target.value } });
                }}
              />
            </label>
          </p>
        ))}
      </fieldset>

      {trimSheetIds.length > 0 && (
        <fieldset>
          <legend>Edge trim per Sheet (empty: use the edge trim above)</legend>
          {trimSheetIds.map((id) => (
            <p key={id}>
              <label>
                Edge trim for {sheetNames.get(id) ?? `Sheet ${id}`} (mm){' '}
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={draft.trimBySheet[id] ?? ''}
                  onChange={(e) => {
                    edit({ trimBySheet: { ...draft.trimBySheet, [id]: e.target.value } });
                  }}
                />
              </label>
            </p>
          ))}
        </fieldset>
      )}

      <fieldset>
        <legend>
          <code>bottom</code> op kinds always done by hand
        </legend>
        {OP_KINDS.map((kind) => (
          <label key={kind}>
            <input
              type="checkbox"
              checked={draft.manualBottomOpKinds.includes(kind)}
              onChange={(e) => {
                const others = draft.manualBottomOpKinds.filter((k) => k !== kind);
                edit({ manualBottomOpKinds: e.target.checked ? [...others, kind] : others });
              }}
            />
            {kind}{' '}
          </label>
        ))}
      </fieldset>

      <p>
        <label>
          Fence height note
          <br />
          <textarea
            rows={2}
            cols={50}
            value={draft.fenceHeightNote}
            onChange={(e) => {
              edit({ fenceHeightNote: e.target.value });
            }}
          />
        </label>
      </p>

      {errors.length > 0 && (
        <ul role="alert" className="error">
          {errors.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}
      {saved && <p role="status">{saved}</p>}

      <p>
        <button type="submit">Save settings</button>{' '}
        <button
          type="button"
          onClick={() => {
            edit(toDraft(DEFAULT_SETTINGS));
          }}
        >
          Back to defaults
        </button>
      </p>
    </form>
  );
}
