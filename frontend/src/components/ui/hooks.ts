import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

/** True while the media query matches. Always false outside the browser. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, [query]);
  return matches;
}

/** Desktop layout (sidebar + split views) starts at Tailwind's `lg`. */
export const DESKTOP_QUERY = '(min-width: 1024px)';

/** Closes a popover on Escape or on a pointer press outside `ref`. */
export function useDismiss(ref: RefObject<HTMLElement | null>, open: boolean, onClose: () => void) {
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) closeRef.current();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeRef.current();
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('touchstart', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('touchstart', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, ref]);
}

/** Moves focus between sibling controls with the arrow, Home and End keys. */
export function rovingKeyDown<T extends string>(event: React.KeyboardEvent, values: readonly T[], current: T, select: (value: T) => void, idFor: (value: T) => string) {
  const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'];
  if (!keys.includes(event.key) || values.length === 0) return;
  event.preventDefault();
  const index = Math.max(0, values.indexOf(current));
  const nextIndex = event.key === 'Home'
    ? 0
    : event.key === 'End'
      ? values.length - 1
      : (index + (event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1) + values.length) % values.length;
  const next = values[nextIndex];
  select(next);
  window.setTimeout(() => document.getElementById(idFor(next))?.focus(), 0);
}
