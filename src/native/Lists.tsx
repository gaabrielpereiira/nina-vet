import { useCallback, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ContactEditor, AppointmentEditor, ProcedureEditor } from './Editors';
import { useNativeAuth } from './NativeAuth';
import { Search } from 'lucide-react';
import { client } from './client';
import { useDebounced, usePage } from './usePage';
import { dateLabel, ErrorNotice, Loading, PageTitle, Pagination, Status } from './ui';
import type { Appointment, Page, Procedure } from './api-client';

function SearchField({ value, change, label }: { value: string; change: (value: string) => void; label: string }) {
  return <div className="search-field"><Search size={18} aria-hidden="true" /><label className="sr-only" htmlFor="record-search">{label}</label>
    <input id="record-search" type="search" value={value} onChange={e => change(e.target.value)} placeholder={label} maxLength={120} /></div>;
}
export function ContactsPage() {
  const navigate = useNavigate(); const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState(''); const query = useDebounced(search);
  const loader = useCallback((offset: number, signal: AbortSignal) => client.contacts(query, offset, signal), [query]);
  const page = usePage(loader, query);
  return <><PageTitle title="Cadastros" subtitle="Encontre tutores e acompanhe o cuidado de cada animal." />
    <section className="panel"><div className="panel-toolbar"><SearchField value={search} change={setSearch} label="Buscar por nome, e-mail ou telefone" /><button className="button primary" onClick={()=>setCreating(true)}>Novo tutor</button></div>
      {creating && <ContactEditor close={()=>setCreating(false)} saved={id=>{if(id)navigate("/contatos/"+id);}} />}
      {page.loading ? <Loading>Carregando cadastros…</Loading> : page.error ? <ErrorNotice message={page.error} retry={page.retry} /> : page.rows.length === 0 ?
        <div className="empty"><strong>Nenhum cadastro encontrado</strong><span>Tente buscar por outro nome ou telefone.</span></div> :
        <div className="table-scroll"><table><caption className="sr-only">Tutores cadastrados na clínica</caption><thead><tr><th>Tutor</th><th>Telefone</th><th>E-mail</th><th>Última atividade</th></tr></thead>
          <tbody>{page.rows.map(contact => <tr key={contact.id}><td><Link className="record-link" to={'/contatos/' + encodeURIComponent(contact.id)}>{contact.name || contact.call_name || 'Sem nome'}</Link>
            {contact.is_blocked && <span className="badge">Bloqueado</span>}</td><td>{contact.phone_number || '—'}</td><td>{contact.email || '—'}</td><td>{dateLabel(contact.last_activity)}</td></tr>)}</tbody></table></div>}
      <Pagination {...page} count={page.rows.length} />
    </section></>;
}

export function AppointmentRows({ rows, edit }: { rows: Appointment[]; edit?: (id: string) => void }) {
  return <div className="table-scroll"><table><caption className="sr-only">Agendamentos</caption><thead><tr><th>Data e hora</th><th>Atendimento</th><th>Animal / tutor</th><th>Status</th>{edit && <th>Ações</th>}</tr></thead>
    <tbody>{rows.map(item => <tr key={item.id}><td className="nowrap">{dateLabel(item.date)}<small>{item.time.slice(0, 5)}</small></td>
      <td><strong>{item.procedure_name || item.title}</strong>{item.procedure_name && item.title !== item.procedure_name && <small>{item.title}</small>}</td>
      <td>{item.animal_name || '—'}<small>{item.contact_name || '—'}</small></td><td><Status value={item.status} /></td>{edit && <td><button className="button secondary" aria-label={"Editar agendamento "+item.title} onClick={()=>edit(item.id)}>Editar</button></td>}</tr>)}</tbody></table></div>;
}
function today() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
export function AgendaPage() {
  const [editing,setEditing] = useState<string | null>(null); const [success,setSuccess] = useState(false);
  const [range, setRange] = useState({ from: today(), to: today() });
  const [filterError, setFilterError] = useState<string | null>(null);
  const valid = !!range.from && !!range.to && range.from <= range.to;
  const loader = useCallback((offset: number, signal: AbortSignal): Promise<Page<Appointment>> =>
    valid ? client.appointments(range.from, range.to, offset, signal) : Promise.resolve({ data: [], next_offset: null }), [range, valid]);
  const page = usePage(loader, range.from + ':' + range.to);
  return <><PageTitle title="Agenda" subtitle="Consulte os atendimentos e o histórico de agendamentos." />
    <div className="page-actions"><p className="muted">As alterações de agenda ainda não são sincronizadas com VetSoft.</p><button className="button primary" onClick={()=>setEditing('')}>Novo agendamento</button></div>
    {success && <p className="success-notice" role="status">Agendamento salvo. Consulte a data escolhida para encontrá-lo.</p>}
    {editing !== null && <AppointmentEditor appointmentId={editing || undefined} close={()=>setEditing(null)} saved={()=>{page.retry();setSuccess(true);}} />}
    <section className="panel"><form className="date-filters" onSubmit={event => {
      event.preventDefault(); const form = new FormData(event.currentTarget);
      const from = String(form.get('from') || ''), to = String(form.get('to') || '');
      if (!from || !to || from > to) { setFilterError('Escolha um período válido, com a data final após a inicial.'); return; }
      setFilterError(null); setRange({ from, to });
    }}>
      <div><label htmlFor="date-from">De</label><input id="date-from" name="from" type="date" required defaultValue={range.from} /></div>
      <div><label htmlFor="date-to">Até</label><input id="date-to" name="to" type="date" required defaultValue={range.to} /></div>
      <button className="button primary">Consultar período</button></form>
      {filterError && <ErrorNotice message={filterError} />}
      {page.loading ? <Loading /> : page.error ? <ErrorNotice message={page.error} retry={page.retry} /> : !page.rows.length ?
        <div className="empty"><strong>Nenhum agendamento neste período</strong><span>Escolha outro intervalo para consultar o histórico.</span></div> : <AppointmentRows rows={page.rows} edit={setEditing} />}
      <Pagination {...page} count={page.rows.length} />
    </section></>;
}
const currency = (value: string | number | null) => value === null || !Number.isFinite(Number(value)) ? null : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value));
export function ProceduresPage() {
  const auth = useNativeAuth(); const admin = auth.session?.user.roles.includes('admin');
  const [editing,setEditing] = useState<Procedure | null | undefined>(undefined); const [success,setSuccess] = useState(false);
  const [search, setSearch] = useState(''); const query = useDebounced(search);
  const loader = useCallback((offset: number, signal: AbortSignal) => client.procedures(query, offset, signal), [query]);
  const page = usePage(loader, query);
  return <><PageTitle title="Procedimentos" subtitle="Consulte os serviços, valores e orientações da clínica." />
    <section className="panel"><div className="panel-toolbar"><SearchField value={search} change={setSearch} label="Buscar procedimento" />{admin && <button className="button primary" onClick={()=>setEditing(null)}>Novo procedimento</button>}</div>
      {success && <p className="success-notice" role="status">Procedimento salvo.</p>}
      {editing !== undefined && admin && <ProcedureEditor procedure={editing ?? undefined} close={()=>setEditing(undefined)} saved={()=>{page.retry();setSuccess(true);}} />}
      {page.loading ? <Loading /> : page.error ? <ErrorNotice message={page.error} retry={page.retry} /> : !page.rows.length ? <div className="empty">Nenhum procedimento encontrado.</div> :
        <div className="procedure-grid">{page.rows.map(item => <article className="procedure" key={item.id}><div className="row-between"><span className="eyebrow">{item.category || 'Procedimento'}</span>
          <span className={'badge ' + (item.is_active ? 'active' : '')}>{item.is_active ? 'Ativo' : 'Inativo'}</span></div><h2>{item.name}</h2>
          {item.description && <p className="preserve">{item.description}</p>}{item.requirements && <p className="preserve"><strong>Orientações: </strong>{item.requirements}</p>}
          <footer><strong>{item.price_type === 'range' ? (currency(item.price_min) && currency(item.price_max) ? `${currency(item.price_min)} a ${currency(item.price_max)}` : 'Consultar valor') : currency(item.price) || 'Consultar valor'}</strong>
            {item.duration_minutes !== null && <span>{item.duration_minutes} min</span>}</footer>{admin && <button className="button secondary" onClick={()=>setEditing(item)} aria-label={"Editar procedimento "+item.name}>Editar</button>}</article>)}</div>}
      <Pagination {...page} count={page.rows.length} />
    </section></>;
}
