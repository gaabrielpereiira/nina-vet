import React from 'react';
import { X, Loader2, PawPrint, MessageSquare, CalendarDays, Mail, Phone, Tag, FileText, Sparkles } from 'lucide-react';
import { Button } from '../Button';
import { useContactDetails } from '@/hooks/useContactDetails';

interface Props {
  contactId: string;
  onClose: () => void;
  onOpenConversation: (phone: string) => void;
}

const fmtDate = (value?: string | null) => {
  if (!value) return '—';
  const d = new Date(value.length <= 10 ? `${value}T12:00:00` : value);
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR');
};

const fmtDateTime = (value?: string | null) => {
  if (!value) return '—';
  const d = new Date(value);
  return isNaN(d.getTime()) ? '—' : d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
};

const sexLabel = (sex: string | null) => (sex === 'M' ? 'Macho' : sex === 'F' ? 'Fêmea' : null);

const senderLabel = (from: string) => (from === 'user' ? 'Tutor' : from === 'nina' ? 'Nina' : 'Atendente');

const Section: React.FC<{ icon: React.ReactNode; title: string; children: React.ReactNode }> = ({ icon, title, children }) => (
  <div className="border-t border-slate-800 pt-5">
    <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-2 mb-3">
      {icon}
      {title}
    </h4>
    {children}
  </div>
);

const ContactDetailPanel: React.FC<Props> = ({ contactId, onClose, onOpenConversation }) => {
  const { contact, animals, messages, conversationId, appointments, loading, error } = useContactDetails(contactId);

  const displayName = contact?.name || contact?.call_name || contact?.phone_number || 'Contato';

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <aside
        className="w-full max-w-xl h-full bg-slate-900 border-l border-slate-800 shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="p-6 border-b border-slate-800 flex items-start justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0">
            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-cyan-600 to-teal-600 flex items-center justify-center text-white font-bold">
              {displayName.substring(0, 2).toUpperCase()}
            </div>
            <div className="min-w-0">
              <h3 className="text-lg font-bold text-white truncate">{displayName}</h3>
              <p className="text-sm text-slate-400 font-mono">{contact?.phone_number || '—'}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white shrink-0">
            <X className="w-5 h-5" />
          </button>
        </header>

        {loading ? (
          <div className="flex-1 flex items-center justify-center text-slate-400">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Carregando ficha…
          </div>
        ) : error ? (
          <div className="flex-1 flex items-center justify-center p-8 text-center text-sm text-amber-300">{error}</div>
        ) : (
          <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-6">
            {/* Dados */}
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-xs text-slate-500 mb-1 flex items-center gap-1.5"><Mail className="w-3.5 h-3.5" /> E-mail</p>
                <p className="text-slate-200 break-all">{contact?.email || '—'}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1 flex items-center gap-1.5"><Phone className="w-3.5 h-3.5" /> Telefone</p>
                <p className="text-slate-200 font-mono">{contact?.phone_number || '—'}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1">Primeiro contato</p>
                <p className="text-slate-200">{fmtDate(contact?.first_contact_date)}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1">Última atividade</p>
                <p className="text-slate-200">{fmtDate(contact?.last_activity)}</p>
              </div>
            </div>

            {contact?.vetsoft_client_id != null && (
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-cyan-500/10 border border-cyan-500/30 text-xs text-cyan-300">
                <Sparkles className="w-3.5 h-3.5" />
                Importado do VetSoft (código {contact.vetsoft_client_id})
              </div>
            )}

            {!!contact?.tags?.length && (
              <Section icon={<Tag className="w-3.5 h-3.5" />} title="Etiquetas">
                <div className="flex flex-wrap gap-2">
                  {contact.tags!.map((t) => (
                    <span key={t} className="px-2 py-0.5 rounded-md bg-slate-800 text-xs text-slate-300">{t}</span>
                  ))}
                </div>
              </Section>
            )}

            {contact?.notes && (
              <Section icon={<FileText className="w-3.5 h-3.5" />} title="Notas">
                <p className="text-sm text-slate-300 whitespace-pre-wrap">{contact.notes}</p>
              </Section>
            )}

            {/* Pets */}
            <Section icon={<PawPrint className="w-3.5 h-3.5" />} title={`Pets (${animals.length})`}>
              {animals.length === 0 ? (
                <p className="text-sm text-slate-500">Nenhum pet cadastrado para este tutor.</p>
              ) : (
                <div className="space-y-2">
                  {animals.map((a) => (
                    <div key={a.id} className="bg-slate-950 border border-slate-800 rounded-lg p-3">
                      <p className="text-sm font-semibold text-white">{a.name}</p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {[a.species, a.breed, sexLabel(a.sex), a.birth_date ? `nasc. ${fmtDate(a.birth_date)}` : null]
                          .filter(Boolean)
                          .join(' · ') || 'Sem detalhes'}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </Section>

            {/* Conversa */}
            <Section icon={<MessageSquare className="w-3.5 h-3.5" />} title="Histórico de conversa">
              {messages.length === 0 ? (
                <p className="text-sm text-slate-500">Nenhuma mensagem trocada com este contato ainda.</p>
              ) : (
                <div className="space-y-2">
                  {messages.map((m) => (
                    <div key={m.id} className="bg-slate-950 border border-slate-800 rounded-lg p-3">
                      <div className="flex items-center justify-between gap-3 mb-1">
                        <span className="text-xs font-semibold text-cyan-400">{senderLabel(m.from_type)}</span>
                        <span className="text-[10px] text-slate-500">{fmtDateTime(m.created_at)}</span>
                      </div>
                      <p className="text-sm text-slate-300 whitespace-pre-wrap break-words">
                        {m.content || `[${m.type}]`}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </Section>

            {/* Agendamentos */}
            <Section icon={<CalendarDays className="w-3.5 h-3.5" />} title={`Agendamentos (${appointments.length})`}>
              {appointments.length === 0 ? (
                <p className="text-sm text-slate-500">Nenhum agendamento para este tutor.</p>
              ) : (
                <div className="space-y-2">
                  {appointments.map((a) => (
                    <div key={a.id} className="bg-slate-950 border border-slate-800 rounded-lg p-3 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm text-white truncate">{a.title}</p>
                        <p className="text-xs text-slate-400">{a.procedure_name || 'Sem procedimento'}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm text-slate-200">{fmtDate(a.date)}</p>
                        <p className="text-xs text-slate-500">{(a.time || '').slice(0, 5)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Section>
          </div>
        )}

        <footer className="p-6 border-t border-slate-800 flex justify-end gap-3">
          <Button variant="outline" onClick={onClose}>Fechar</Button>
          <Button
            onClick={() => contact?.phone_number && onOpenConversation(contact.phone_number)}
            disabled={!contact?.phone_number}
            className="gap-2"
          >
            <MessageSquare className="w-4 h-4" />
            {conversationId ? 'Abrir conversa' : 'Iniciar conversa'}
          </Button>
        </footer>
      </aside>
    </div>
  );
};

export default ContactDetailPanel;
