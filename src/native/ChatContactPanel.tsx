import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, PawPrint, X } from 'lucide-react';
import { client } from './client';
import type { Animal, Appointment, Contact } from './api-client';
import { phoneLabel } from './chat-logic';
import { Avatar, errorText } from './ChatThread';
import { dateLabel, ErrorNotice, Loading, Status } from './ui';

function age(value: string | null) {
  if (!value) return null;
  const birth = new Date(value.slice(0, 10) + 'T12:00:00'), now = new Date();
  const months = (now.getFullYear() - birth.getFullYear()) * 12 + now.getMonth() - birth.getMonth() - (now.getDate() < birth.getDate() ? 1 : 0);
  if (!Number.isFinite(months) || months < 0) return null;
  return months < 12 ? `${months} ${months === 1 ? 'mês' : 'meses'}` : `${Math.floor(months / 12)} ${months < 24 ? 'ano' : 'anos'}`;
}

export function ChatContactPanel({ contactId, close }: { contactId: string; close: () => void }) {
  const [data, setData] = useState<{ contact: Contact; animals: Animal[]; appointments: Appointment[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setData(null); setError(null);
    Promise.all([client.contact(contactId, controller.signal), client.animals(contactId, 0, controller.signal), client.contactAppointments(contactId, 0, controller.signal)])
      .then(([contact, animals, appointments]) => { if (!controller.signal.aborted) setData({ contact, animals: animals.data, appointments: appointments.data }); })
      .catch(error => { if (!controller.signal.aborted) setError(errorText(error)); });
    return () => controller.abort();
  }, [contactId, revision]);
  const name = data?.contact.name || data?.contact.call_name || phoneLabel(data?.contact.phone_number) || 'Contato do WhatsApp';
  return <aside className="chat-panel" aria-label="Dados do tutor">
    <header className="chat-panel-head"><strong>Dados do tutor</strong><button type="button" className="chat-icon" onClick={close} aria-label="Fechar dados do tutor"><X size={20} aria-hidden="true" /></button></header>
    <div className="chat-panel-body">
      {error ? <ErrorNotice message={error} retry={() => setRevision(n => n + 1)} /> : !data ? <Loading>Carregando cadastro…</Loading> : <>
        <div className="chat-panel-person"><Avatar name={name} large /><h2>{name}</h2>
          <p>{phoneLabel(data.contact.phone_number) !== name && (phoneLabel(data.contact.phone_number) || 'Sem telefone')}{data.contact.email && <><br />{data.contact.email}</>}</p>
          <Link className="button secondary" to={`/contatos/${contactId}`}>Abrir cadastro completo</Link></div>
        {data.contact.notes && <section><h3>Observações</h3><p className="preserve">{data.contact.notes}</p></section>}
        <section><h3><PawPrint size={16} aria-hidden="true" /> Animais</h3>
          {data.animals.length ? <ul className="chat-panel-list">{data.animals.map(animal => <li key={animal.id}><strong>{animal.name}</strong>
            <span>{[animal.species, animal.breed, animal.sex, age(animal.birth_date)].filter(Boolean).join(' · ') || 'Sem detalhes'}</span></li>)}</ul> : <p className="muted">Nenhum animal cadastrado.</p>}</section>
        <section><h3><CalendarDays size={16} aria-hidden="true" /> Agendamentos</h3>
          {data.appointments.length ? <ul className="chat-panel-list">{data.appointments.slice(0, 5).map(item => <li key={item.id}><strong>{item.title}</strong>
            <span>{dateLabel(item.date)} às {item.time.slice(0, 5)}{item.animal_name ? ' · ' + item.animal_name : ''}</span><Status value={item.status} /></li>)}</ul> : <p className="muted">Nenhum agendamento.</p>}</section>
      </>}
    </div>
  </aside>;
}
