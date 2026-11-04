import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { client } from './client';
import { ClientError, type Animal, type Appointment, type Contact, type Procedure } from './api-client';
import { ErrorNotice, Loading } from './ui';
import { useDebounced, usePage } from './usePage';

type Values = Record<string, unknown>;
function delta(values: Values, original?: Values) {
  return Object.fromEntries(Object.entries(values).filter(([key, value]) => !original || JSON.stringify(value) !== JSON.stringify(original[key] ?? null)));
}
const text = (form: FormData, key: string) => String(form.get(key) ?? '').trim() || null;
const numeric = (form: FormData, key: string) => text(form, key) === null ? null : Number(form.get(key));

function Editor({ title, close, submit, children, blocked = false }: { title: string; close: () => void; submit: (form: FormData, operation: string) => Promise<void>; children: ReactNode; blocked?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const operation = useRef(crypto.randomUUID());
  const saving = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();
  useEffect(() => { const element = dialog.current; if (element && !element.open) element.showModal(); return () => element?.close(); }, []);
  return <dialog ref={dialog} className="editor-dialog" aria-labelledby={titleId} onCancel={event => { event.preventDefault(); if (!saving.current) close(); }}>
    <form onSubmit={async event => {
      event.preventDefault(); if (saving.current || blocked) return;
      const form = new FormData(event.currentTarget); saving.current = true; setBusy(true); setError(null);
      try { await submit(form, operation.current); close(); }
      catch (error) { setError(error instanceof ClientError && (error.status === 0 || error.status >= 500) ?
        'Não foi possível confirmar o resultado. Tente salvar novamente sem fechar esta edição; a tentativa não duplicará o registro.' : error instanceof Error ? error.message : 'Não foi possível salvar.'); }
      finally { saving.current = false; setBusy(false); }
    }}><header className="editor-heading"><h2 id={titleId}>{title}</h2><button className="button secondary" type="button" disabled={busy} onClick={close}>Fechar</button></header>
      {error && <ErrorNotice message={error} />}<fieldset disabled={busy || blocked} className="editor-fields">{children}</fieldset>
      <footer className="editor-actions"><button type="button" className="button secondary" disabled={busy} onClick={close}>Cancelar</button><button className="button primary" disabled={busy || blocked}>{busy ? 'Salvando…' : 'Salvar'}</button></footer>
    </form></dialog>;
}
function Field({ label, name, initial, type = 'text', required = false, max = 120, step, min, maximum }: {
  label: string; name: string; initial?: string | number | null; type?: string; required?: boolean; max?: number; step?: string; min?: string; maximum?: string;
}) { const id = useId(); return <div className="editor-field"><label htmlFor={id}>{label}{required ? ' *' : ''}</label><input id={id} name={name} type={type} defaultValue={initial ?? ''} required={required} maxLength={max} step={step} min={min} max={maximum} /></div>; }
function Notes({ name = 'notes', label = 'Observações', initial }: { name?: string; label?: string; initial?: string | null }) {
  const id = useId(); return <div className="editor-field full"><label htmlFor={id}>{label}</label><textarea id={id} name={name} maxLength={4000} rows={4} defaultValue={initial ?? ''} /></div>;
}
async function save(resource: string, data: Values, operation: string, version?: number, original?: Values) {
  const patch = delta(data, original);
  if (original && !Object.keys(patch).length) return;
  return client.save(resource, patch, operation, version);
}
export function ContactEditor({ contact, close, saved }: { contact?: Contact; close: () => void; saved: (id?: string) => void }) {
  const original = contact ? { name: contact.name, call_name: contact.call_name, phone_number: contact.phone_number, email: contact.email, notes: contact.notes, tags: contact.tags ?? [] } : undefined;
  return <Editor title={contact ? 'Editar tutor' : 'Novo tutor'} close={close} submit={async (form, operation) => {
    const data = { name: text(form, 'name'), call_name: text(form,'call_name'), phone_number: text(form,'phone_number'), email: text(form,'email'), notes: text(form,'notes'),
      tags: String(form.get('tags') ?? '').split(',').map(t=>t.trim()).filter(Boolean) };
    const result = await save(contact ? 'contacts/'+contact.id : 'contacts',data,operation,contact?.revision,original);
    saved(result?.data.id ?? contact?.id);
  }}><Field label="Nome do tutor" name="name" initial={contact?.name} max={240} required /><Field label="Nome de preferência" name="call_name" initial={contact?.call_name} />
    <Field label="Telefone com DDI e DDD" name="phone_number" initial={contact?.phone_number} type="tel" required={!contact || Boolean(contact.phone_number)} /><Field label="E-mail" name="email" initial={contact?.email} type="email" max={320} />
    <Field label="Etiquetas separadas por vírgula" name="tags" initial={contact?.tags?.join(', ')} max={1200} /><Notes initial={contact?.notes} />
  </Editor>;
}
export function AnimalEditor({ animal, contactId, close, saved }: { animal?: Animal; contactId: string; close: () => void; saved: () => void }) {
  const original = animal ? { name: animal.name, species: animal.species, breed: animal.breed, sex: animal.sex, birth_date: animal.birth_date, notes: animal.notes } : undefined;
  return <Editor title={animal ? 'Editar animal' : 'Novo animal'} close={close} submit={async (form, operation) => {
    const data = Object.fromEntries(['name','species','breed','sex','birth_date','notes'].map(key=>[key,text(form,key)]));
    await save('contacts/'+contactId+'/animals'+(animal ? '/'+animal.id : ''),data,operation,animal?.revision,original); saved();
  }}><Field label="Nome do animal" name="name" initial={animal?.name} required max={240} /><Field label="Espécie" name="species" initial={animal?.species} />
    <Field label="Raça" name="breed" initial={animal?.breed} /><Field label="Sexo" name="sex" initial={animal?.sex} /><Field label="Nascimento" name="birth_date" type="date" initial={animal?.birth_date} /><Notes initial={animal?.notes} />
  </Editor>;
}

type Choice = { id: string; name: string | null; call_name?: string | null; phone_number?: string | null; is_active?: boolean };
const choiceLabel = (row: Choice) => (row.name || row.call_name || 'Sem nome') + (row.phone_number ? ' · '+row.phone_number : '');
function Reference({ kind, label, value, change, parent, required = false }: { kind: 'contacts' | 'animals' | 'procedures'; label: string; value: string; change: (id: string) => void; parent?: string; required?: boolean }) {
  const [search,setSearch] = useState(''); const query = useDebounced(search); const id = useId();
  const [selected,setSelected] = useState<Choice | null>(null); const [selectionError,setSelectionError] = useState(false);
  const loader = useCallback((offset: number, signal: AbortSignal) => kind === 'contacts' ? client.contacts(query,offset,signal) : kind === 'procedures' ? client.procedures(query,offset,signal) : parent ? client.animals(parent,offset,signal,query) : Promise.resolve({data:[],next_offset:null}),[kind,parent,query]);
  const page = usePage<Choice>(loader,kind+':'+parent+':'+query);
  useEffect(() => {
    const controller = new AbortController(); setSelected(null); setSelectionError(false);
    if (value) {
      const pending = kind === 'contacts' ? client.contact(value,controller.signal) : kind === 'procedures' ? client.procedure(value,controller.signal) : client.animal(parent ?? '',value,controller.signal);
      pending.then(row=>{if(!controller.signal.aborted)setSelected(row);}).catch(()=>{if(!controller.signal.aborted)setSelectionError(true);});
    }
    return ()=>controller.abort();
  },[kind,parent,value]);
  const rows = page.rows; const pinned = value && !rows.some(row=>row.id===value);
  return <div className="editor-field full reference"><label htmlFor={id}>{label}{required ? ' *' : ''}</label><input aria-label={'Buscar '+label.toLowerCase()} type="search" value={search} onChange={e=>setSearch(e.target.value)} maxLength={120} placeholder="Digite para buscar" disabled={kind==='animals' && !parent} />
    {page.error && <ErrorNotice message={page.error} retry={page.retry} />}{selectionError && <p role="alert">Não foi possível conferir a seleção atual. Feche e reabra a edição para tentar novamente.</p>}
    <select id={id} value={value} required={required} onChange={e=>change(e.target.value)} disabled={kind==='animals' && !parent}>
      <option value="">{kind==='animals' && !parent ? 'Escolha primeiro um tutor' : 'Selecione'}</option>
      {pinned && <option value={value}>{selected?.id === value ? choiceLabel(selected) : 'Seleção atual'}</option>}
      {rows.map(row=><option key={row.id} value={row.id} disabled={kind==='procedures' && row.is_active===false && row.id!==value}>{choiceLabel(row)}{row.is_active===false ? ' (inativo)' : ''}</option>)}
    </select><div className="reference-pages"><span>{page.loading ? 'Buscando…' : rows.length ? 'Selecione um resultado da busca.' : 'Nenhum resultado.'}</span><button type="button" className="button secondary" aria-label={'Resultados anteriores: '+label} disabled={page.loading || page.offset===0} onClick={page.back}>Anteriores</button><button type="button" className="button secondary" aria-label={'Mais resultados: '+label} disabled={page.loading || page.next===null} onClick={page.advance}>Mais resultados</button></div>
  </div>;
}
export function AppointmentEditor({ appointmentId, close, saved }: { appointmentId?: string; close: () => void; saved: () => void }) {
  const [record,setRecord] = useState<Appointment | null>(null); const [error,setError] = useState<string | null>(null);
  useEffect(()=>{if(!appointmentId)return; const c=new AbortController(); client.appointment(appointmentId,c.signal).then(row=>{if(!c.signal.aborted)setRecord(row);}).catch(e=>{if(!c.signal.aborted)setError(e.message);});return()=>c.abort();},[appointmentId]);
  if (appointmentId && !record) return <Editor title="Editar agendamento" blocked close={close} submit={async()=>{throw new Error('Aguarde o carregamento.');}}>{error ? <ErrorNotice message={error} /> : <Loading />}</Editor>;
  return <AppointmentFields key={record?.id ?? 'new'} record={record ?? undefined} close={close} saved={saved} />;
}
function AppointmentFields({ record, close, saved }: { record?: Appointment; close: () => void; saved: () => void }) {
  const [contact,setContact] = useState(record?.contact_id ?? ''); const [animal,setAnimal] = useState(record?.animal_id ?? ''); const [procedure,setProcedure] = useState(record?.procedure_id ?? '');
  const statuses = { scheduled:'Agendado',confirmed:'Confirmado',completed:'Concluído',cancelled:'Cancelado',canceled:'Cancelado',no_show:'Não compareceu',pending:'Pendente' };
  const statusId = useId();
  const original = record ? { title:record.title,description:record.description,date:record.date,time:record.time.slice(0,5),duration:record.duration,status:record.status,contact_id:record.contact_id,animal_id:record.animal_id,procedure_id:record.procedure_id } : undefined;
  const localToday = ()=> {const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
  return <Editor title={record ? 'Editar agendamento' : 'Novo agendamento'} close={close} submit={async(form,operation)=>{
    const data = {title:text(form,'title'),description:text(form,'description'),date:text(form,'date'),time:text(form,'time'),duration:numeric(form,'duration'),status:text(form,'status'),contact_id:contact||null,animal_id:animal||null,procedure_id:procedure||null};
    await save('appointments'+(record ? '/'+record.id : ''),data,operation,record?.revision,original);saved();
  }}><p className="editor-hint full">As alterações ficam na Nina. A sincronização com VetSoft ainda não está ativa.</p>
    <Field label="Atendimento" name="title" initial={record?.title} required max={240} /><Field label="Data" name="date" initial={record?.date ?? localToday()} type="date" required />
    <Field label="Horário" name="time" initial={record?.time.slice(0,5)} type="time" required /><Field label="Duração em minutos" name="duration" initial={record?.duration ?? 30} type="number" required min="5" maximum="1440" step="1" />
    <div className="editor-field"><label htmlFor={statusId}>Status</label><select id={statusId} name="status" defaultValue={record ? record.status ?? '' : 'scheduled'}>{record && !record.status && <option value="">Sem status</option>}{record?.status && !(record.status in statuses) && <option value={record.status}>{record.status}</option>}{Object.entries(statuses).filter(([key])=>key !== (record?.status==='canceled' ? 'cancelled' : 'canceled')).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></div>
    <Reference kind="contacts" label="Tutor" value={contact} required change={id=>{setContact(id);setAnimal('');}} />
    <Reference kind="animals" label="Animal" value={animal} change={setAnimal} parent={contact} />
    <Reference kind="procedures" label="Procedimento" value={procedure} change={setProcedure} /><Notes name="description" label="Observações do atendimento" initial={record?.description} />
  </Editor>;
}
export function ProcedureEditor({ procedure, close, saved }: { procedure?: Procedure; close: () => void; saved: () => void }) {
  const priceTypeId = useId(); const activeId = useId();
  const [priceType,setPriceType] = useState(procedure?.price_type ?? 'fixed');
  const original = procedure ? { name:procedure.name,description:procedure.description,category:procedure.category,requirements:procedure.requirements,price_type:procedure.price_type,price:procedure.price===null?null:Number(procedure.price),price_min:procedure.price_min===null?null:Number(procedure.price_min),price_max:procedure.price_max===null?null:Number(procedure.price_max),duration_minutes:procedure.duration_minutes,is_active:procedure.is_active } : undefined;
  return <Editor title={procedure ? 'Editar procedimento' : 'Novo procedimento'} close={close} submit={async(form,operation)=>{
    const data = {name:text(form,'name'),description:text(form,'description'),category:text(form,'category'),requirements:text(form,'requirements'),price_type:priceType,...(priceType === 'range' ? {price_min:numeric(form,'price_min'),price_max:numeric(form,'price_max')} : {price:numeric(form,'price')}),duration_minutes:numeric(form,'duration_minutes'),is_active:form.get('is_active')==='on'};
    await save('procedures'+(procedure ? '/'+procedure.id : ''),data,operation,procedure?.revision,original);saved();
  }}><Field label="Nome do procedimento" name="name" initial={procedure?.name} required max={240} /><Field label="Categoria" name="category" initial={procedure?.category} />
    <div className="editor-field"><label htmlFor={priceTypeId}>Forma de preço</label><select id={priceTypeId} name="price_type" value={priceType} onChange={event=>setPriceType(event.target.value)}><option value="fixed">Valor fixo / consultar</option><option value="range">Faixa de valores</option></select></div>
    {priceType === 'fixed' ? <Field label="Valor fixo (R$)" name="price" initial={procedure?.price} type="number" min="0" step="0.01" maximum="100000000" /> : <><Field label="Valor mínimo (R$)" name="price_min" initial={procedure?.price_min} type="number" min="0" step="0.01" maximum="100000000" /><Field label="Valor máximo (R$)" name="price_max" initial={procedure?.price_max} type="number" min="0" step="0.01" maximum="100000000" /></>}
    <Field label="Duração em minutos" name="duration_minutes" initial={procedure?.duration_minutes} type="number" min="5" maximum="1440" step="1" /><label className="editor-check" htmlFor={activeId}><input id={activeId} type="checkbox" name="is_active" defaultChecked={procedure?.is_active ?? true} /> Procedimento ativo</label>
    <Notes name="description" label="Descrição" initial={procedure?.description} /><Notes name="requirements" label="Orientações" initial={procedure?.requirements} />
  </Editor>;
}
