import { useEffect, useRef, useState } from 'react';
import { client } from './client';
import type { VetsoftConnectionResult, VetsoftConnectionStatus } from './api-client';
import { ErrorNotice, Loading } from './ui';

export function VetsoftConnectionPanel() {
  const [status, setStatus] = useState<VetsoftConnectionStatus | null>(null);
  const [result, setResult] = useState<VetsoftConnectionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const pending = useRef(false);
  const active = useRef<AbortController>();
  useEffect(() => {
    const controller = new AbortController(); setStatus(null); setError(null);
    client.vetsoftStatus(controller.signal).then(data => { if (!controller.signal.aborted) setStatus(data); })
      .catch(error => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'Não foi possível conferir a conexão.'); });
    return () => { controller.abort(); active.current?.abort(); };
  }, [revision]);
  const check = async () => {
    if (!status?.enabled || pending.current) return;
    pending.current = true; setBusy(true); setResult(null); setError(null);
    const controller = new AbortController(); active.current = controller;
    try { const data = await client.checkVetsoft(controller.signal); if (!controller.signal.aborted) setResult(data); }
    catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'Não foi possível verificar a conexão.'); }
    finally { pending.current = false; if (!controller.signal.aborted) setBusy(false); }
  };
  return <section className="panel agent-panel" aria-labelledby="vetsoft-title">
    <h2 id="vetsoft-title">Conexão com o VetSoft</h2>
    <p>Confira o acesso da Nina ao VetSoft com uma consulta aos tipos de atendimento.</p>
    <p className="muted">A sincronização dos cadastros e da agenda será configurada em uma próxima etapa.</p>
    {error && <ErrorNotice message={error} retry={!status ? () => setRevision(n => n + 1) : undefined} />}
    {!status && !error && <Loading>Conferindo a preparação da conexão…</Loading>}
    {status && <>
      <p>{status.enabled ? 'A verificação está disponível. Ela consulta o VetSoft sem alterar seus registros.' : 'A conexão com o VetSoft ainda não foi ativada.'}</p>
      <button className="button primary" disabled={!status.enabled || busy} onClick={check}>{busy ? 'Verificando conexão…' : 'Verificar conexão'}</button>
    </>}
    <div aria-live="polite" aria-atomic="true">{busy && <Loading>Conferindo o acesso ao VetSoft…</Loading>}{result && <>
      <h3>Acesso verificado</h3><p>Autenticação e consulta aos tipos de atendimento concluídas.</p>
      <p className="muted">Conferido em {new Date(result.checked_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}. Os registros do VetSoft foram preservados.</p>
    </>}</div>
  </section>;
}
