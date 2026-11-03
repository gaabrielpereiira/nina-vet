import { Loader2, PawPrint } from 'lucide-react';
import type { ReactNode } from 'react';

export function Brand() {
  return <div className="brand"><span className="brand-icon"><PawPrint size={23} aria-hidden="true" /></span><div><strong>Nina</strong><span>Clínica Vet+</span></div></div>;
}
export function Loading({ children = 'Carregando…' }: { children?: ReactNode }) {
  return <div className="empty" role="status"><Loader2 className="spin" size={25} aria-hidden="true" /><span>{children}</span></div>;
}
export function ErrorNotice({ message, retry }: { message: string; retry?: () => void }) {
  return <div className="notice" role="alert"><p>{message}</p>{retry && <button className="button secondary" onClick={retry}>Tentar novamente</button>}</div>;
}
export function Pagination({ offset, count, next, loading, back, advance }: {
  offset: number; count: number; next: number | null; loading: boolean; back: () => void; advance: () => void;
}) {
  return <div className="pagination"><span aria-live="polite">{count ? `Exibindo ${offset + 1}–${offset + count}` : 'Nenhum registro nesta página'}</span>
    <div><button className="button secondary" onClick={back} disabled={loading || offset === 0}>Anterior</button>
      <button className="button secondary" onClick={advance} disabled={loading || next === null}>Próxima</button></div></div>;
}
export function dateLabel(value: string | null | undefined, withTime = false) {
  if (!value) return '—';
  const date = new Date(value.length === 10 ? value + 'T12:00:00' : value);
  if (Number.isNaN(date.getTime())) return '—';
  return withTime ? date.toLocaleString('pt-BR') : date.toLocaleDateString('pt-BR');
}
const statusLabels: Record<string, string> = { scheduled: 'Agendado', confirmed: 'Confirmado', completed: 'Concluído',
  cancelled: 'Cancelado', canceled: 'Cancelado', no_show: 'Não compareceu', pending: 'Pendente' };
export function Status({ value }: { value: string | null }) {
  return <span className="badge">{value ? statusLabels[value] ?? value : 'Sem status'}</span>;
}
export function PageTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return <header className="page-title"><p className="eyebrow">Nina · Vet+</p><h1>{title}</h1><p>{subtitle}</p></header>;
}
