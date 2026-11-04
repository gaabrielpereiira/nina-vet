import { useEffect, useState } from 'react';
import { useNativeAuth } from './NativeAuth';
import { client } from './client';
import type { ChannelStatus } from './api-client';
import { dateLabel, ErrorNotice, Loading } from './ui';

export function WhatsAppPage() {
  const { session } = useNativeAuth();
  const admin = session?.user.roles.includes('admin');
  const [data, setData] = useState<ChannelStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!admin) return;
    const controller = new AbortController(); setData(null); setError(null);
    client.channelStatus(controller.signal).then(result => { if (!controller.signal.aborted) setData(result); })
      .catch(error => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'Não foi possível conferir a conexão.'); });
    return () => controller.abort();
  }, [admin, revision]);
  if (!admin) return <section className="panel"><h1>Acesso restrito</h1><p>A conexão do WhatsApp está disponível para administradores.</p></section>;
  return <><header className="page-heading"><p className="eyebrow">Conexão da clínica</p><h1>WhatsApp</h1>
    <p className="muted">Acompanhe a cópia das conversas para o histórico dos tutores.</p></header>
    {error ? <ErrorNotice message={error} retry={() => setRevision(n => n + 1)} /> : !data ? <Loading>Conferindo a conexão…</Loading> : <section className="panel detail-section">
      <h2>{data.receiving_enabled && data.processing_enabled ? 'Recebimento preparado' : 'Conexão em preparação'}</h2>
      <p>Esta etapa registra as conversas e os arquivos recebidos. O atendimento automático será configurado em outra etapa.</p>
      <dl className="channel-summary"><dt>Recebimento de eventos</dt><dd>{data.receiving_enabled ? 'Ligado' : 'Desligado'}</dd>
        <dt>Registro no histórico</dt><dd>{data.processing_enabled ? 'Ligado' : 'Desligado'}</dd><dt>Arquivos privados</dt><dd>{data.media_enabled ? 'Disponíveis' : 'Em preparação'}</dd>
        {data.status?.scope_matches && <><dt>Aguardando registro</dt><dd>{data.status.pending}</dd><dt>Em processamento</dt><dd>{data.status.processing}</dd>
          <dt>Precisam de conferência</dt><dd>{data.status.needs_review}</dd><dt>Eventos registrados</dt><dd>{data.status.processed}</dd>
          <dt>Último registro</dt><dd>{dateLabel(data.status.last_processed_at)}</dd></>}
      </dl>
      {!!data.status?.needs_review && <p role="status" className="empty-note">Há eventos que precisam de conferência antes de aparecer no histórico. O conteúdo recebido foi preservado.</p>}
      <button className="button secondary" onClick={() => setRevision(n => n + 1)}>Atualizar situação</button>
    </section>}</>;
}
