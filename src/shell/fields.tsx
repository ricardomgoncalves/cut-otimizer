import { useState, type FormEvent } from 'react';

/** A Sheet code input, committed on Enter or when it loses focus. Empty goes back to the derived code. */
export function SheetCodeField(props: { code: string; sheetName: string; onCommit: (code: string) => void }) {
  const [value, setValue] = useState(props.code);
  const commit = () => {
    if (value.trim().toUpperCase() !== props.code) props.onCommit(value);
  };
  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        commit();
      }}
    >
      <label>
        Sheet code for {props.sheetName}{' '}
        <input
          size={8}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
          }}
          onBlur={commit}
        />
      </label>
    </form>
  );
}

/** The open Job's name, committed on Enter or when it loses focus. A blank name keeps the old one. */
export function JobNameField(props: { name: string; onCommit: (name: string) => void }) {
  const [value, setValue] = useState(props.name);
  const commit = () => {
    if (value.trim() === '') setValue(props.name);
    else if (value.trim() !== props.name) props.onCommit(value);
  };
  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        commit();
      }}
    >
      <label>
        Job name{' '}
        <input
          size={40}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
          }}
          onBlur={commit}
        />
      </label>
    </form>
  );
}
