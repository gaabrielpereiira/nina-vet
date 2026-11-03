import { useEffect, useState } from 'react';
import type { Page } from './api-client';

export function useDebounced(value: string) {
  const [result, setResult] = useState(value);
  useEffect(() => { const timer = setTimeout(() => setResult(value), 300); return () => clearTimeout(timer); }, [value]);
  return result;
}

export function usePage<T>(loader: (offset: number, signal: AbortSignal) => Promise<Page<T>>, identity: string) {
  const [position, setPosition] = useState({ identity, offset: 0 });
  const offset = position.identity === identity ? position.offset : 0;
  const [reload, setReload] = useState(0);
  const [state, setState] = useState<{ identity: string; offset: number; rows: T[]; next: number | null; error: string | null; loading: boolean }>(
    { identity, offset, rows: [], next: null, error: null, loading: true });
  useEffect(() => {
    setPosition(previous => previous.identity === identity ? previous : { identity, offset: 0 });
  }, [identity]);
  useEffect(() => {
    const controller = new AbortController();
    setState({ identity, offset, rows: [], next: null, error: null, loading: true });
    loader(offset, controller.signal).then(page => {
      if (!controller.signal.aborted) setState({ identity, offset, rows: page.data, next: page.next_offset, error: null, loading: false });
    }).catch(error => {
      if (!controller.signal.aborted) setState({ identity, offset, rows: [], next: null, error: error instanceof Error ? error.message : 'Não foi possível carregar.', loading: false });
    });
    return () => controller.abort();
  }, [loader, identity, offset, reload]);
  const current = state.identity === identity && state.offset === offset;
  return { rows: current ? state.rows : [], next: current ? state.next : null,
    loading: !current || state.loading, error: current ? state.error : null, offset,
    advance: () => { if (current && state.next !== null) setPosition({ identity, offset: state.next }); },
    back: () => setPosition({ identity, offset: Math.max(0, offset - 50) }), retry: () => setReload(n => n + 1) };
}
