import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, PawPrint } from 'lucide-react';
import { client } from './client';
import { ContactEditor, AnimalEditor, AppointmentEditor } from './Editors';
import type { Animal, Appointment, Contact, Message, Page } from './api-client';
import { AppointmentRows } from './Lists';
import { dateLabel, ErrorNotice, Loading } from './ui';

interface Details { id: string; contact: Contact; animals: Page<Animal>; appointments: Page<Appointment>; messages: Page<Message> }
type Section = 'animals' | 'appointments' | 'messages';
const authors: Record<string, string> = { user: 'Tutor', human: 'Equipe', nina: 'Nina' };
const media: Record<string, string> = { audio: 'Mensagem de áudio', image: 'Imagem', video: 'Vídeo', document: 'Documento' };

export function ContactPage() {
  const { id = '' } = useParams();
  const [editingContact,setEditingContact] = useState(false);
  const [editingAnimal,setEditingAnimal] = useState<Animal | null | undefined>(undefined);
  const [editingAppointment,setEditingAppointment] = useState<string | null>(null);
  const [success,setSuccess] = useState<string | null>(null);
  useEffect(()=>{setEditingContact(false);setEditingAnimal(undefined);setEditingAppointment(null);setSuccess(null);},[id]);
  const saved = (message: string) => {setRevision(n=>n+1);setSuccess(message);};
  const [details, setDetails] = useState<Details | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [pending, setPending] = useState<Section | null>(null);
  const [moreError, setMoreError] = useState<{ section: Section; message: string } | null>(null);
  const request = useRef<AbortController>();
  useEffect(() => {
    const controller = new AbortController(); request.current = controller;
    setDetails(null); setError(null); setMoreError(null); setPending(null);
    Promise.all([client.contact(id, controller.signal), client.animals(id, 0, controller.signal),
      client.contactAppointments(id, 0, controller.signal), client.contactMessages(id, 0, controller.signal)])
      .then(([contact, animals, appointments, messages]) => {
        if (!controller.signal.aborted) setDetails({ id, contact, animals, appointments, messages });
      }).catch(error => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'Não foi possível carregar o cadastro.'); });
    return () => controller.abort();
  }, [id, revision]);
  const current = details?.id === id ? details : null;
  const more = async (section: Section) => {
    const signal = request.current?.signal;
    const offset = current?.[section].next_offset;
    if (!current || offset === null || offset === undefined || !signal || pending) return;
    setPending(section); setMoreError(null);
    try {
      const page = section === 'animals' ? await client.animals(id, offset, signal) : section === 'appointments' ?
        await client.contactAppointments(id, offset, signal) : await client.contactMessages(id, offset, signal);
      if (!signal.aborted) setDetails(previous => {
        if (!previous || previous.id !== id) return previous;
        const existing = previous[section].data;
        const ids = new Set(existing.map(row => row.id));
        return { ...previous, [section]: { data: [...existing, ...page.data.filter(row => !ids.has(row.id))], next_offset: page.next_offset } } as Details;
      });
    } catch (error) { if (!signal.aborted) setMoreError({ section, message: error instanceof Error ? error.message : 'Não foi possível carregar mais registros.' }); }
    finally { if (!signal.aborted) setPending(null); }
  };
  const continuation = (section: Section) => <>
    {moreError?.section === section && <ErrorNotice message={moreError.message} />}
    {current?.[section].next_offset !== null && <button className="button secondary load-more" disabled={pending !== null} onClick={() => more(section)}>{pending === section ? 'Carregando…' : 'Carregar mais'}</button>}
  </>;
  return <><Link className="back-link" to="/contatos"><ArrowLeft size={17} aria-hidden="true" /> Todos os cadastros</Link>
    {success && <p className="success-notice" role="status">{success}</p>}
    {error ? <ErrorNotice message={error} retry={() => setRevision(n => n + 1)} /> : !current ? <Loading>Carregando histórico…</Loading> : <>
      <div className="page-actions"><button className="button secondary" onClick={()=>setEditingContact(true)}>Editar tutor</button><button className="button primary" onClick={()=>setEditingAnimal(null)}>Novo animal</button></div>
      {editingContact && <ContactEditor contact={current.contact} close={()=>setEditingContact(false)} saved={()=>saved("Tutor salvo.")} />}
      {editingAnimal !== undefined && <AnimalEditor animal={editingAnimal ?? undefined} contactId={id} close={()=>setEditingAnimal(undefined)} saved={()=>saved("Animal salvo.")} />}
      {editingAppointment !== null && <AppointmentEditor appointmentId={editingAppointment} close={()=>setEditingAppointment(null)} saved={()=>saved("Agendamento salvo.")} />}
      <header className="contact-header"><div className="avatar">{(current.contact.name || current.contact.call_name || '?').slice(0, 1).toUpperCase()}</div>
        <div><p className="eyebrow">Cadastro do tutor</p><h1>{current.contact.name || current.contact.call_name || 'Sem nome'}</h1><p className="muted">{current.contact.phone_number}{current.contact.email ? ` · ${current.contact.email}` : ''}</p></div></header>
      <div className="detail-grid"><aside className="panel profile"><h2>Informações</h2><dl><dt>Nome de preferência</dt><dd>{current.contact.call_name || '—'}</dd><dt>Primeiro contato</dt><dd>{dateLabel(current.contact.first_contact_date)}</dd><dt>Última atividade</dt><dd>{dateLabel(current.contact.last_activity)}</dd></dl>
        {!!current.contact.tags?.length && <div className="tags">{current.contact.tags.map(tag => <span className="badge" key={tag}>{tag}</span>)}</div>}
        <h3>Observações</h3><p className="preserve muted">{current.contact.notes || 'Nenhuma observação cadastrada.'}</p></aside>
        <div className="detail-sections"><section className="panel detail-section"><header className="section-heading"><PawPrint size={21} aria-hidden="true" /><h2>Animais</h2></header>
          {!current.animals.data.length ? <p className="muted">Nenhum animal vinculado a este tutor.</p> : <div className="animal-grid">{current.animals.data.map(animal => <article className="animal" key={animal.id}>
            <h3>{animal.name}</h3><p className="muted">{[animal.species, animal.breed].filter(Boolean).join(' · ') || 'Espécie não informada'}</p>
            <dl><dt>Sexo</dt><dd>{animal.sex || '—'}</dd><dt>Nascimento</dt><dd>{dateLabel(animal.birth_date)}</dd></dl>
            {animal.notes && <p className="preserve animal-notes">{animal.notes}</p>}<button className="button secondary" aria-label={"Editar animal "+animal.name} onClick={()=>setEditingAnimal(animal)}>Editar</button></article>)}</div>}{continuation('animals')}</section>
          <section className="panel detail-section"><h2>Agendamentos</h2>{current.appointments.data.length ? <AppointmentRows rows={current.appointments.data} edit={setEditingAppointment} /> : <p className="muted">Nenhum agendamento registrado para este tutor.</p>}{continuation('appointments')}</section>
          <section className="panel detail-section"><h2>Histórico de conversas</h2><p className="muted">Mensagens mais recentes primeiro.</p>
            {!current.messages.data.length ? <p className="muted">Nenhuma mensagem registrada.</p> : <ol className="message-list">{current.messages.data.map(message => <li className={'message ' + (message.from_type === 'user' ? 'from-tutor' : '')} key={message.id}>
              <header><strong>{authors[message.from_type] || 'Mensagem'}</strong><time dateTime={message.sent_at}>{dateLabel(message.sent_at, true)}</time></header>
              <p className="preserve">{message.content || media[message.type] || 'Mensagem sem texto'}</p></li>)}</ol>}{continuation('messages')}
          </section></div></div>
    </>}
  </>;
}
