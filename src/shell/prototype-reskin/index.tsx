/* eslint-disable react-refresh/only-export-components -- prototype */
// PROTOTYPE (reskin): three layouts on the same app, switched with ?variant=A|B|C.
// Question: what should the reskinned Cut Optimizer look like under the gcode-viewer theme (design.md)?
// All three share theme.css; they differ only in layout. Throwaway: fold the winner into App.tsx.
import { useEffect, useState } from 'react';
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

export function variantParam(): string | null {
  return new URLSearchParams(window.location.search).get('variant');
}

export function ReskinPrototype({ session }: { session: JobSession }) {
  const [variant, setVariant] = useState(() => variantParam() ?? 'A');
  useEffect(() => {
    const on = () => {
      setVariant(variantParam() ?? 'A');
    };
    window.addEventListener('popstate', on);
    return () => {
      window.removeEventListener('popstate', on);
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
      {import.meta.env.DEV && <PrototypeSwitcher variants={VARIANTS} current={variant} />}
    </>
  );
}
