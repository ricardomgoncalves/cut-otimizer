import type { ReactNode } from 'react';
import type { Part } from '../core/model.ts';

/**
 * A Part shown by its name (`<Owner label> · <Part name>`), opening to its detail panel.
 * The raw export `name` appears only here, in small grey text.
 */
export function PartDetail({ part, children }: { part: Part; children?: ReactNode }) {
  return (
    <details className="part-detail">
      <summary>{part.displayName}</summary>
      <small className="raw-name">{part.name}</small> <small className="raw-name part-id">{part.id}</small>
      {children}
    </details>
  );
}
