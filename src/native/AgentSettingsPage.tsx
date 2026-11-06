import { useEffect, useState } from 'react';
import { useNativeAuth } from './NativeAuth';
import { client } from './client';
import type { AgentSettingsResponse } from './api-client';
import { ErrorNotice, Loading } from './ui';
import { VetsoftConnectionPanel } from './VetsoftConnectionPanel';

const weekdays = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

export function AgentSettingsPage() {
  const { session } = useNativeAuth();
  const admin = session?.user.roles.includes('admin');
  const [data, setData] = useState<AgentSettingsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!admin) return;
    const controller = new AbortController(); setData(null); setError(null);
    client.agentSettings(controller.signal).then(value => { if (!controller.signal.aborted) setData(value); })
      .catch(error => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'Não foi possível carregar as configurações.'); });
    return () => controller.abort();
  }, [admin, revision]);
  if (!admin) return <section className="panel empty"><h1>Acesso restrito</h1><p>As configurações da Nina estão disponíveis para administradores.</p></section>;
  const settings = data?.settings;
  return <>
    <header className="page-heading"><p className="eyebrow">Atendimento da clínica</p><h1>Configurações da Nina</h1>
      <p className="muted">Confira as instruções e preferências recuperadas da Clínica Vet+.</p></header>
    {error && <ErrorNotice message={error} retry={() => setRevision(n => n + 1)} />}
    {!data && !error && <Loading>Carregando configurações…</Loading>}
    {data && !settings && <section className="panel empty"><h2>Configurações em preparação</h2><p>A recuperação das instruções da clínica está em andamento.</p></section>}
    <VetsoftConnectionPanel />
    {settings && <>
      <section className="panel agent-panel"><h2>Atendimento com a equipe</h2>
        <p>A Nina continua com as respostas automáticas desligadas. A equipe confirma, altera e cancela os horários dos tutores.</p>
        <dl className="agent-summary">
          <div><dt>Clínica</dt><dd>{settings.company_name}</dd></div>
          <div><dt>Assistente</dt><dd>{settings.assistant_name}</dd></div>
          <div><dt>Atendimento</dt><dd>{settings.business_hours_start} às {settings.business_hours_end}</dd></div>
          <div><dt>Dias da semana</dt><dd>{settings.business_days.map(day => weekdays[day]).join(', ')}</dd></div>
          <div><dt>Fuso horário</dt><dd>{settings.timezone}</dd></div>
          <div><dt>Agendamentos</dt><dd>Somente com a equipe</dd></div>
        </dl>
        <p className="muted">Domingo: somente com hora marcada pela equipe. As instruções completas estão abaixo.</p>
      </section>
      <section className="panel agent-panel"><h2>Conferência da recuperação</h2><ul>{settings.review_notes.map(note => <li key={note}>{note}</li>)}</ul>
        <p className="muted">Esta página permite conferir as configurações recuperadas. A ativação do atendimento será feita em uma etapa própria.</p></section>
      <section className="panel agent-panel"><h2>Instruções de atendimento</h2>
        <p>Texto recuperado do sistema anterior, preservado para revisão.</p>
        <label htmlFor="agent-system-prompt">Instruções da Nina</label>
        <textarea id="agent-system-prompt" className="agent-prompt" readOnly rows={18} value={settings.system_prompt} />
      </section>
    </>}
  </>;
}
