/* eslint-disable react-refresh/only-export-components -- prototype */
// PROTOTYPE (reskin): three layouts on the same app, switched with ?variant=A|B|C.
// Question: what should the reskinned Cut Optimizer look like under the gcode-viewer theme (design.md)?
// All three share theme.css; they differ only in layout. Throwaway: fold the winner into App.tsx.
import { useEffect, useRef, useState } from 'react';
import type { JobSession } from '../useJobSession.ts';
import { PrototypeSwitcher } from './PrototypeSwitcher.tsx';
import { NAME as A, VariantA } from './VariantA.tsx';
import { NAME as B, VariantB } from './VariantB.tsx';
import { NAME as C, VariantC } from './VariantC.tsx';

const VARIANTS = [
  ['A', A],
  ['B', B],
  ['C', C],
] as const;

/** `vite build --mode prototype`: the build published as a claude.ai artifact (no query string there). */
export const ARTIFACT = import.meta.env.MODE === 'prototype';

export function variantParam(): string | null {
  const q = new URLSearchParams(window.location.search).get('variant');
  if (q) return q;
  const h = window.location.hash.slice(1);
  return ['A', 'B', 'C'].includes(h) ? h : ARTIFACT ? 'A' : null;
}

const SEEDED = 'cut-optimizer.prototype-seeded';

/** In the artifact build, the first visit loads and plans the sample export so every variant has a Job. */
function useSample(session: JobSession) {
  const planning = useRef(false);
  useEffect(() => {
    if (!ARTIFACT) return;
    try {
      if (localStorage.getItem(SEEDED)) return;
      localStorage.setItem(SEEDED, '1');
    } catch {
      /* storage blocked: seed anyway */
    }
    void (async () => {
      const text = await (await fetch('./sample.parts.json')).text();
      planning.current = true;
      await session.actions.loadExport(new File([text], 'synthetic.parts.json', { type: 'application/json' }));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const open = session.state.open;
  useEffect(() => {
    if (planning.current && open && !open.job) {
      planning.current = false;
      session.actions.plan();
    }
  });
}

export function ReskinPrototype({ session }: { session: JobSession }) {
  useSample(session);
  const [variant, setVariant] = useState(() => variantParam() ?? 'A');
  useEffect(() => {
    const on = () => {
      setVariant(variantParam() ?? 'A');
    };
    window.addEventListener('popstate', on);
    window.addEventListener('hashchange', on);
    return () => {
      window.removeEventListener('popstate', on);
      window.removeEventListener('hashchange', on);
    };
  }, []);
  return (
    <>
      {variant === 'B' ? (
        <VariantB session={session} />
      ) : variant === 'C' ? (
        <VariantC session={session} />
      ) : (
        <VariantA session={session} />
      )}
      {(import.meta.env.DEV || ARTIFACT) && <PrototypeSwitcher variants={VARIANTS} current={variant} />}
    </>
  );
}
