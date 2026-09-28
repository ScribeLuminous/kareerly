import { useCallback, useEffect, useMemo, useState } from 'react';

/** Returns `value` once it has stopped changing for `delay` ms, for search-as-you-type. */
export function useDebouncedValue<T>(value: T, delay = 350): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/**
 * Tracks which rows are ticked. Only ids still on screen count as selected,
 * so changing a filter or page never acts on rows the admin can no longer see.
 */
export function useRowSelection(ids: string[]) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const selected = useMemo(() => ids.filter((id) => picked.has(id)), [ids, picked]);
  const toggle = useCallback((id: string) => {
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const toggleAll = useCallback((checked: boolean) => setPicked(checked ? new Set(ids) : new Set()), [ids]);
  const clear = useCallback(() => setPicked(new Set()), []);
  return {
    selected,
    isSelected: (id: string) => picked.has(id),
    toggle,
    toggleAll,
    clear,
    allSelected: ids.length > 0 && selected.length === ids.length,
    someSelected: selected.length > 0 && selected.length < ids.length,
  };
}
