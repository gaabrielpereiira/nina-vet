import React, { useState } from 'react';
import { Plus, Pencil, Trash2, X, Stethoscope, Loader2 } from 'lucide-react';
import { Button } from '../Button';
import { useProcedures, Procedure, ProcedureInput } from '@/hooks/useProcedures';
import { useCompanySettings } from '@/hooks/useCompanySettings';

const CATEGORIES = ['Consulta', 'Cirurgia', 'Vacina', 'Exame', 'Internação', 'Estética', 'Emergência', 'Outros'];

const emptyForm: ProcedureInput = {
  name: '',
  description: '',
  category: 'Consulta',
  requirements: '',
  price_type: 'fixed',
  price: null,
  price_min: null,
  price_max: null,
  duration_minutes: 30,
  is_active: true,
};

const formatPrice = (p: Procedure) => {
  if (p.price_type === 'range') {
    const min = p.price_min ?? 0;
    const max = p.price_max ?? 0;
    return `R$ ${min.toFixed(2)} – R$ ${max.toFixed(2)}`;
  }
  return p.price != null ? `R$ ${p.price.toFixed(2)}` : '—';
};

const ProceduresSettings: React.FC = () => {
  const { isAdmin } = useCompanySettings();
  const { procedures, loading, createProcedure, updateProcedure, deleteProcedure, toggleActive } = useProcedures();
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Procedure | null>(null);
  const [form, setForm] = useState<ProcedureInput>(emptyForm);
  const [saving, setSaving] = useState(false);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setShowModal(true);
  };

  const openEdit = (p: Procedure) => {
    setEditing(p);
    setForm({
      name: p.name,
      description: p.description ?? '',
      category: p.category ?? 'Consulta',
      requirements: p.requirements ?? '',
      price_type: p.price_type,
      price: p.price,
      price_min: p.price_min,
      price_max: p.price_max,
      duration_minutes: p.duration_minutes,
      is_active: p.is_active,
    });
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload: ProcedureInput = {
        ...form,
        description: form.description || null,
        category: form.category || null,
        requirements: form.requirements || null,
        price: form.price_type === 'fixed' ? form.price : null,
        price_min: form.price_type === 'range' ? form.price_min : null,
        price_max: form.price_type === 'range' ? form.price_max : null,
      };
      if (editing) {
        await updateProcedure(editing.id, payload);
      } else {
        await createProcedure(payload);
      }
      setShowModal(false);
    } catch {
      // toast handled in hook
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (p: Procedure) => {
    if (!confirm(`Excluir "${p.name}"?`)) return;
    await deleteProcedure(p.id);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-white flex items-center gap-2">
            <Stethoscope className="w-5 h-5 text-cyan-400" />
            Procedimentos
          </h3>
          <p className="text-sm text-slate-400 mt-1">
            Cadastre os serviços da clínica. A Nina usará essa lista para responder sobre valores, categorias e requisitos.
          </p>
        </div>
        {isAdmin && (
          <Button onClick={openCreate} className="gap-2">
            <Plus className="w-4 h-4" />
            Novo procedimento
          </Button>
        )}
      </div>

      <div className="bg-slate-900/40 border border-slate-800 rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-12 flex items-center justify-center text-slate-400">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Carregando…
          </div>
        ) : procedures.length === 0 ? (
          <div className="p-12 text-center text-slate-400">
            <Stethoscope className="w-10 h-10 mx-auto mb-3 text-slate-600" />
            <p className="font-medium text-slate-300">Nenhum procedimento cadastrado</p>
            <p className="text-sm mt-1">Clique em "Novo procedimento" para começar.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-900/60 border-b border-slate-800">
              <tr className="text-left text-xs uppercase tracking-wider text-slate-500">
                <th className="px-4 py-3 font-semibold">Nome</th>
                <th className="px-4 py-3 font-semibold">Categoria</th>
                <th className="px-4 py-3 font-semibold">Preço</th>
                <th className="px-4 py-3 font-semibold">Duração</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {procedures.map((p) => (
                <tr key={p.id} className="border-b border-slate-800/60 last:border-0 hover:bg-slate-800/20">
                  <td className="px-4 py-3">
                    <div className="font-medium text-white">{p.name}</div>
                    {p.description && (
                      <div className="text-xs text-slate-500 line-clamp-1 mt-0.5">{p.description}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-300">{p.category || '—'}</td>
                  <td className="px-4 py-3 text-slate-300 font-mono">{formatPrice(p)}</td>
                  <td className="px-4 py-3 text-slate-300">{p.duration_minutes ? `${p.duration_minutes} min` : '—'}</td>
                  <td className="px-4 py-3">
                    {isAdmin ? (
                      <button
                        onClick={() => toggleActive(p.id, !p.is_active)}
                        className={`text-xs px-2 py-1 rounded-full font-medium border ${
                          p.is_active
                            ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                            : 'bg-slate-700/40 text-slate-400 border-slate-600'
                        }`}
                      >
                        {p.is_active ? 'Ativo' : 'Inativo'}
                      </button>
                    ) : (
                      <span className={`text-xs px-2 py-1 rounded-full font-medium border ${
                        p.is_active
                          ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                          : 'bg-slate-700/40 text-slate-400 border-slate-600'
                      }`}>
                        {p.is_active ? 'Ativo' : 'Inativo'}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      {isAdmin && (
                        <>
                          <button
                            onClick={() => openEdit(p)}
                            className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded"
                            title="Editar"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(p)}
                            className="p-2 text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded"
                            title="Excluir"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto custom-scrollbar">
            <div className="p-6 border-b border-slate-800 flex justify-between items-center sticky top-0 bg-slate-900 z-10">
              <h3 className="text-lg font-bold text-white">
                {editing ? 'Editar procedimento' : 'Novo procedimento'}
              </h3>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase text-slate-500 tracking-wider">Nome *</label>
                <input
                  required
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-sm text-white focus:ring-1 focus:ring-cyan-500 outline-none"
                  placeholder="Ex: Castração de gato macho"
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold uppercase text-slate-500 tracking-wider">Descrição</label>
                <textarea
                  value={form.description ?? ''}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  rows={3}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-sm text-white focus:ring-1 focus:ring-cyan-500 outline-none resize-none"
                  placeholder="O que inclui o procedimento…"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase text-slate-500 tracking-wider">Categoria</label>
                  <select
                    value={form.category ?? ''}
                    onChange={(e) => setForm({ ...form, category: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2.5 text-sm text-white focus:ring-1 focus:ring-cyan-500 outline-none"
                  >
                    {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase text-slate-500 tracking-wider">Duração (min)</label>
                  <input
                    type="number"
                    min={0}
                    value={form.duration_minutes ?? ''}
                    onChange={(e) => setForm({ ...form, duration_minutes: e.target.value ? parseInt(e.target.value) : null })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-sm text-white focus:ring-1 focus:ring-cyan-500 outline-none"
                    placeholder="30"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold uppercase text-slate-500 tracking-wider">Requisitos / pré-requisitos</label>
                <textarea
                  value={form.requirements ?? ''}
                  onChange={(e) => setForm({ ...form, requirements: e.target.value })}
                  rows={2}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-sm text-white focus:ring-1 focus:ring-cyan-500 outline-none resize-none"
                  placeholder="Ex: Jejum de 12h, idade mínima 6 meses…"
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold uppercase text-slate-500 tracking-wider">Tipo de preço</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, price_type: 'fixed' })}
                    className={`px-3 py-2 rounded-lg text-sm border transition-colors ${
                      form.price_type === 'fixed'
                        ? 'bg-cyan-500/10 border-cyan-500/40 text-cyan-300'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    Valor fixo
                  </button>
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, price_type: 'range' })}
                    className={`px-3 py-2 rounded-lg text-sm border transition-colors ${
                      form.price_type === 'range'
                        ? 'bg-cyan-500/10 border-cyan-500/40 text-cyan-300'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    Faixa (mín–máx)
                  </button>
                </div>
              </div>

              {form.price_type === 'fixed' ? (
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase text-slate-500 tracking-wider">Preço (R$)</label>
                  <input
                    type="number"
                    step="0.01"
                    min={0}
                    value={form.price ?? ''}
                    onChange={(e) => setForm({ ...form, price: e.target.value ? parseFloat(e.target.value) : null })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-sm text-white focus:ring-1 focus:ring-cyan-500 outline-none"
                    placeholder="0,00"
                  />
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase text-slate-500 tracking-wider">Mínimo (R$)</label>
                    <input
                      type="number"
                      step="0.01"
                      min={0}
                      value={form.price_min ?? ''}
                      onChange={(e) => setForm({ ...form, price_min: e.target.value ? parseFloat(e.target.value) : null })}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-sm text-white focus:ring-1 focus:ring-cyan-500 outline-none"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase text-slate-500 tracking-wider">Máximo (R$)</label>
                    <input
                      type="number"
                      step="0.01"
                      min={0}
                      value={form.price_max ?? ''}
                      onChange={(e) => setForm({ ...form, price_max: e.target.value ? parseFloat(e.target.value) : null })}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-sm text-white focus:ring-1 focus:ring-cyan-500 outline-none"
                    />
                  </div>
                </div>
              )}

              <label className="flex items-center gap-2 pt-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                  className="w-4 h-4 accent-cyan-500"
                />
                <span className="text-sm text-slate-300">Ativo (disponível para a Nina e agendamentos)</span>
              </label>

              <div className="pt-4 flex gap-3">
                <Button type="button" variant="ghost" onClick={() => setShowModal(false)} className="flex-1 border border-slate-700 hover:bg-slate-800">
                  Cancelar
                </Button>
                <Button type="submit" disabled={saving} className="flex-1 gap-2">
                  {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                  {editing ? 'Salvar' : 'Criar'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProceduresSettings;
