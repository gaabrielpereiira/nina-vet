import { useEffect, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { useNativeAuth } from './NativeAuth';
import { client } from './client';
import type { AiTestCase, AiTestResult } from './api-client';
import { ErrorNotice, Loading } from './ui';

export function AiTestsPage() {
  const { session } = useNativeAuth();
  const admin = session?.user.roles.includes('admin');
  const [cases, setCases] = useState<AiTestCase[] | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [selected, setSelected] = useState('agendamento');
  const [result, setResult] = useState<AiTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const pending = useRef(false);
  const active = useRef<AbortController>();
  useEffect(() => {
    if (!admin) return;
    const controller = new AbortController();
    setCases(null); setError(null);
    client.aiTestCases(controller.signal).then(data => {
      if (!controller.signal.aborted) { setCases(data.cases); setEnabled(data.enabled); }
    }).catch(error => {
      if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'Não foi possível carregar os exemplos.');
    });
    return () => { controller.abort(); active.current?.abort(); };
  }, [admin, revision]);
  if (!admin) return <section className="panel"><h1>Acesso restrito</h1><p>Os testes da Nina estão disponíveis para administradores.</p></section>;

  const run = async () => {
    if (!enabled || pending.current) return;
    pending.current = true; setBusy(true); setError(null); setResult(null);
    const controller = new AbortController(); active.current = controller;
    try {
      const response = await client.aiTest(selected, controller.signal);
      if (!controller.signal.aborted) setResult(response);
    } catch (error) {
      if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'Não foi possível testar a Nina.');
    } finally {
      pending.current = false;
      if (!controller.signal.aborted) setBusy(false);
    }
  };
  return <>
    <header className="page-heading"><p className="eyebrow">Preparação do atendimento</p><h1>Testes da Nina</h1>
      <p className="muted">Veja como a Nina responde a exemplos fictícios antes de ativar o atendimento automático.</p></header>
    <section className="panel ai-intro"><Sparkles size={24} aria-hidden="true" /><div><h2>Escolha um exemplo para começar</h2>
      <p>Somente a mensagem do exemplo é enviada ao Google Gemini. Cada teste usa a conta de IA da clínica e pode consumir sua cota. São permitidos até 20 testes por dia na clínica.</p></div></section>
    {error && <ErrorNotice message={error} retry={!cases ? () => setRevision(n => n + 1) : undefined} />}
    {!cases ? !error && <Loading>Carregando exemplos…</Loading> : <>
      {!enabled && <p className="empty-note" role="status">A conexão com a IA está em preparação. Os exemplos já estão disponíveis para conferir.</p>}
      <fieldset className="ai-scenarios" disabled={busy}><legend>Exemplo de atendimento</legend><div className="ai-cases">{cases.map(item =>
        <label className={'panel ai-case' + (selected === item.id ? ' selected' : '')} key={item.id}>
          <span className="ai-case-title"><input type="radio" name="ai-case" value={item.id} checked={selected === item.id} onChange={() => {
            setSelected(item.id); setResult(null); setError(null);
          }} />{item.title}</span>
          <span className="ai-message">“{item.message}”</span><span className="muted ai-expectation">O que observar: {item.expectation}</span>
        </label>)}</div></fieldset>
      <div className="page-actions"><button className="button primary" disabled={!enabled || busy || !cases.length} onClick={run}>
        <Sparkles size={17} aria-hidden="true" />{busy ? 'Nina está respondendo…' : 'Testar este exemplo'}</button></div>
      <div aria-live="polite" aria-atomic="true">{busy && <Loading>Preparando a resposta…</Loading>}{result && <section className="panel ai-result">
        <p className="eyebrow">Resposta da Nina</p><p className="preserve">{result.reply}</p><small className="muted">Respondido em {(result.elapsed_ms / 1000).toFixed(1).replace('.', ',')} s. Resultado de um teste fictício.</small>
      </section>}</div>
    </>}
  </>;
}
