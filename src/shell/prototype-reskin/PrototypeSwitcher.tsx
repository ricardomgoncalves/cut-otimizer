// PROTOTYPE (reskin): floating bar that cycles ?variant=. Dev builds only (App gates it).
import { useEffect } from 'react';

export function PrototypeSwitcher(props: { variants: readonly (readonly [string, string])[]; current: string }) {
  const { variants, current } = props;
  const i = Math.max(
    0,
    variants.findIndex(([k]) => k === current),
  );
  const go = (d: number) => {
    const next = variants[(i + d + variants.length) % variants.length];
    if (!next) return;
    if (import.meta.env.MODE === 'prototype') {
      window.location.hash = next[0]; // artifact frames keep only a plain #name
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.set('variant', next[0]);
    window.history.replaceState(null, '', url);
    window.dispatchEvent(new PopStateEvent('popstate'));
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.closest('input, textarea, select, [contenteditable]') ?? null)) return;
      if (e.key === 'ArrowLeft') go(-1);
      if (e.key === 'ArrowRight') go(1);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  });
  const [key, name] = variants[i] ?? ['?', ''];
  const style = {
    position: 'fixed',
    bottom: 12,
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: 1000,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '4px 6px',
    background: '#000',
    color: '#fff',
    borderRadius: 999,
    boxShadow: '0 4px 16px rgb(0 0 0 / .5)',
    font: '12px system-ui',
  } as const;
  const btn = { background: '#222', color: '#fff', border: 'none', borderRadius: 999, padding: '2px 10px' } as const;
  return (
    <div style={style} data-prototype-switcher>
      <button type="button" style={btn} onClick={() => go(-1)} aria-label="Previous variant">
        ←
      </button>
      <span>
        PROTOTYPE {key} ({name})
      </span>
      <button type="button" style={btn} onClick={() => go(1)} aria-label="Next variant">
        →
      </button>
    </div>
  );
}
