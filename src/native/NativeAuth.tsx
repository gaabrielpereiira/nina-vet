import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { NativeSession } from './api-client';
import { client } from './client';

type State = { status: 'checking' | 'unavailable' | 'anonymous' | 'authenticated'; session: NativeSession | null };
interface Auth extends State { refresh: () => void; signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>; forgetSession: () => void }
const Context = createContext<Auth | null>(null);

export function NativeAuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ status: 'checking', session: null });
  const generation = useRef(0);
  const controller = useRef<AbortController>();
  const channel = useRef<BroadcastChannel>();
  const mutation = useRef(false);
  const forgetSession = useCallback(() => {
    generation.current++; controller.current?.abort();
    setState({ status: 'anonymous', session: null });
  }, []);
  const refresh = useCallback(() => {
    if (mutation.current) return;
    const current = ++generation.current;
    controller.current?.abort(); const request = new AbortController(); controller.current = request;
    client.session(request.signal).then(session => {
      if (current === generation.current && !request.signal.aborted) {
        setState({ status: session ? 'authenticated' : 'anonymous', session });
      }
    }).catch(() => {
      if (current === generation.current && !request.signal.aborted) setState({ status: 'unavailable', session: null });
    });
  }, []);
  useEffect(() => {
    refresh(); client.onSessionExpired(forgetSession);
    const focus = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', focus);
    if ('BroadcastChannel' in window) {
      channel.current = new BroadcastChannel('nina-native-session');
      channel.current.onmessage = () => refresh();
    }
    return () => {
      generation.current++; controller.current?.abort(); client.onSessionExpired(undefined);
      document.removeEventListener('visibilitychange', focus); channel.current?.close();
    };
  }, [refresh, forgetSession]);
  useEffect(() => {
    if (!state.session) return;
    const lifetime = Date.parse(state.session.expires_at) - Date.now();
    const timer = window.setTimeout(forgetSession, Math.max(0, Math.min(lifetime, 2147483647)));
    return () => window.clearTimeout(timer);
  }, [state.session, forgetSession]);
  const signIn = async (email: string, password: string) => {
    mutation.current = true;
    const current = ++generation.current; controller.current?.abort();
    try {
      const session = await client.login(email, password);
      if (current === generation.current) {
        setState({ status: 'authenticated', session }); channel.current?.postMessage('changed');
      }
    } finally { mutation.current = false; }
  };
  const signOut = async () => {
    mutation.current = true; generation.current++; controller.current?.abort();
    try { await client.logout(); forgetSession(); channel.current?.postMessage('changed'); }
    finally { mutation.current = false; }
  };
  return <Context.Provider value={{ ...state, refresh, signIn, signOut, forgetSession }}>{children}</Context.Provider>;
}
export function useNativeAuth() {
  const auth = useContext(Context);
  if (!auth) throw new Error('Missing native auth provider');
  return auth;
}
