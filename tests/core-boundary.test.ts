import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

// The core (src/core) must stay free of React and the DOM so it can be
// unit-tested in plain Node and reused by any shell. These tests lint
// in-memory snippets as if they lived at the given path, using the repo's
// real ESLint config.
const eslint = new ESLint();

async function lintAs(filePath: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).map((m) => m.ruleId ?? m.message);
}

describe('core boundary', () => {
  it('rejects a core file that imports React', async () => {
    const rules = await lintAs(
      'src/core/bad.ts',
      "import { useState } from 'react';\nexport const x = useState;\n",
    );
    expect(rules).toContain('no-restricted-imports');
  });

  it('rejects a core file that imports react-dom subpaths', async () => {
    const rules = await lintAs(
      'src/core/bad.ts',
      "import { createRoot } from 'react-dom/client';\nexport const x = createRoot;\n",
    );
    expect(rules).toContain('no-restricted-imports');
  });

  it('rejects a core file that imports from the shell', async () => {
    const rules = await lintAs(
      'src/core/bad.ts',
      "import { App } from '../shell/App.tsx';\nexport const x = App;\n",
    );
    expect(rules).toContain('no-restricted-imports');
  });

  it('rejects a core file that touches window or document', async () => {
    const rules = await lintAs(
      'src/core/bad.ts',
      'export const w = window.innerWidth;\nexport const d = document.title;\n',
    );
    expect(rules.filter((r) => r === 'no-restricted-globals')).toHaveLength(2);
  });

  it('accepts a pure core file', async () => {
    const rules = await lintAs(
      'src/core/good.ts',
      'export function area(w: number, h: number): number {\n  return w * h;\n}\n',
    );
    expect(rules).toEqual([]);
  });

  it('lets the shell use React and window', async () => {
    const rules = await lintAs(
      'src/shell/ok.ts',
      "import { useState } from 'react';\nexport const x = useState;\nexport const w = window.innerWidth;\n",
    );
    expect(rules).toEqual([]);
  });
});
