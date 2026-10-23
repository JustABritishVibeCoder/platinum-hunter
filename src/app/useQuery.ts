import { useEffect, useRef, useState } from "react";
import { errorMessage } from "../db/driver";
import { useApp } from "./store";

export interface QueryState<T> {
  data: T | undefined;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

/**
 * Runs an async loader and re-runs it whenever `deps` change or any write bumps the
 * global data version. Keeps the previous data while reloading to avoid flicker.
 */
export function useQuery<T>(loader: () => Promise<T>, deps: unknown[]): QueryState<T> {
  const version = useApp((s) => s.dataVersion);
  const [state, setState] = useState<{ data: T | undefined; error: string | null; loading: boolean }>({
    data: undefined,
    error: null,
    loading: true,
  });
  const [tick, setTick] = useState(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    loaderRef
      .current()
      .then((data) => !cancelled && setState({ data, error: null, loading: false }))
      .catch((e) => !cancelled && setState((s) => ({ data: s.data, error: errorMessage(e), loading: false })));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, tick, ...deps]);

  return { ...state, reload: () => setTick((t) => t + 1) };
}

// One shared clock so every timer on screen shows the same second.
const listeners = new Set<(d: Date) => void>();
let clockId: number | null = null;
function subscribeClock(fn: (d: Date) => void): () => void {
  listeners.add(fn);
  if (clockId === null) {
    clockId = window.setInterval(() => {
      const d = new Date();
      for (const l of listeners) l(d);
    }, 1000);
  }
  return () => {
    listeners.delete(fn);
    if (!listeners.size && clockId !== null) {
      window.clearInterval(clockId);
      clockId = null;
    }
  };
}

/** Re-renders once per second from a shared clock (for live timers). */
export function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => subscribeClock(setNow), []);
  return now;
}
