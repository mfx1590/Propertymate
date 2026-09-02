'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

/** §6.1: "Compare view (up to 4 properties side by side)". */
export const MAX_COMPARE = 4;

const STORAGE_KEY = 'pv.compare';

interface CompareState {
  ids: string[];
  has: (id: string) => boolean;
  toggle: (id: string) => void;
  remove: (id: string) => void;
  clear: () => void;
  full: boolean;
}

const CompareContext = createContext<CompareState | null>(null);

/**
 * The compare shortlist, held per browser rather than per account.
 *
 * Deliberately not server-side: comparing is something a buyer does in one
 * sitting, often before they have signed up at all, and requiring an account
 * to line up four listings would gate the most useful screen on the site
 * behind a form. Favourites remain the durable, cross-device list.
 */
export function CompareProvider({ children }: { children: ReactNode }) {
  const [ids, setIds] = useState<string[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) {
        setIds(parsed.filter((x) => typeof x === 'string').slice(0, MAX_COMPARE));
      }
    } catch {
      /* blocked storage — an empty shortlist is a fine default */
    }
  }, []);

  /**
   * Functional updates throughout. Reading `ids` from the enclosing render
   * would mean several clicks in one tick all computed from the same stale
   * array and overwrote each other — adding three listings quickly kept one.
   */
  const update = useCallback((fn: (prev: string[]) => string[]) => {
    setIds((prev) => {
      const next = fn(prev);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const value = useMemo<CompareState>(
    () => ({
      ids,
      full: ids.length >= MAX_COMPARE,
      has: (id) => ids.includes(id),
      toggle: (id) =>
        update((prev) =>
          prev.includes(id)
            ? prev.filter((x) => x !== id)
            : // Silently ignore the overflow rather than dropping someone
              // else's pick; the button is disabled at the limit anyway.
              prev.length >= MAX_COMPARE
              ? prev
              : [...prev, id],
        ),
      remove: (id) => update((prev) => prev.filter((x) => x !== id)),
      clear: () => update(() => []),
    }),
    [ids, update],
  );

  return <CompareContext.Provider value={value}>{children}</CompareContext.Provider>;
}

export function useCompare(): CompareState {
  return (
    useContext(CompareContext) ?? {
      ids: [],
      full: false,
      has: () => false,
      toggle: () => {},
      remove: () => {},
      clear: () => {},
    }
  );
}
