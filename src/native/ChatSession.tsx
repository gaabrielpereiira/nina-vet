import { createContext, useContext, useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import { client } from './client';
import { createOutbox, type OutboxItem } from './chat-logic';

export const inboxChanged = () => window.dispatchEvent(new Event('nina:inbox-changed'));
interface ChatSession { sender: ReturnType<typeof createOutbox>; outbox: Record<string, OutboxItem[]>; drafts: MutableRefObject<Map<string, string>> }
const Context = createContext<ChatSession | null>(null);

// Vive junto da sessão, não da tela: trocar de página não perde mensagens na
// fila nem rascunhos. Outra identidade remonta tudo e nada é gravado no navegador.
export function ChatSessionProvider({ children }: { children: ReactNode }) {
  const [outbox, setOutbox] = useState<Record<string, OutboxItem[]>>({});
  const drafts = useRef(new Map<string, string>());
  const [sender] = useState(() => createOutbox({
    reply: (conversation, operationId, text) => client.replyInbox(conversation, operationId, text, new AbortController().signal),
    wait: milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
    changed: (conversation, items) => setOutbox(previous => ({ ...previous, [conversation]: items })),
    accepted: inboxChanged,
    newId: () => crypto.randomUUID(),
  }));
  useEffect(() => {
    sender.start();
    const warn = (event: BeforeUnloadEvent) => { if (sender.pending()) event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => { sender.stop(); window.removeEventListener('beforeunload', warn); };
  }, [sender]);
  const value = useMemo(() => ({ sender, outbox, drafts }), [sender, outbox]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useChatSession() {
  const session = useContext(Context);
  if (!session) throw new Error('Missing chat session');
  return session;
}
