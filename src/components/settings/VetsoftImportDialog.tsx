import React, { useEffect, useMemo, useState } from 'react';
import { X, Loader2, Download, AlertTriangle, Search, RefreshCw } from 'lucide-react';
import { Button } from '../Button';
import { toast } from 'sonner';
import {
  useVetsoftProcedureImport,
  VetsoftCatalogItem,
  VetsoftImportPreview,
  VetsoftItemType,
} from '@/hooks/useVetsoftProcedureImport';

const TYPE_LABEL: Record<VetsoftItemType, string> = {
  service: 'Serviço',
  vaccine: 'Vacina',
  product: 'Produto',
};

type TabKey = 'new' | 'changed' | 'unchanged';

const money = (v: number | null | undefined) =>
  v == null ? '—' : `R$ ${Number(v).toFixed(2)}`;

const itemKey = (i: VetsoftCatalogItem) => `${i.type}:${i.external_id}`;

interface Props {
  onClose: () => void;
  onImported: () => void;
}

const VetsoftImportDialog: React.FC<Props> = ({ onClose, onImported }) => {
  const { fetchPreview, applyItems, loading, applying } = useVetsoftProcedureImport();
  const [preview, setPreview] = useState<VetsoftImportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>('new');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | VetsoftItemType>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const load = async () => {
    setError(null);
    try {
      const data = await fetchPreview();
      setPreview(data);
      // Novos vêm marcados por padrão; alterados o usuário escolhe.
      setSelected(new Set(data.new.map(itemKey)));
      setTab(data.new.length > 0 || data.changed.length === 0 ? 'new' : 'changed');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const listFor = (key: TabKey): VetsoftCatalogItem[] => {
    if (!preview) return [];
    return key === 'new' ? preview.new : key === 'changed' ? preview.changed : preview.unchanged;
  };

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return listFor(tab).filter((i) => {
      if (typeFilter !== 'all' && i.type !== typeFilter) return false;
      if (term && !i.name.toLowerCase().includes(term) && !(i.category || '').toLowerCase().includes(term)) return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview, tab, search, typeFilter]);

  const toggle = (i: VetsoftCatalogItem) => {
    const key = itemKey(i);
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const toggleAllVisible = (checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      visible.forEach((i) => (checked ? next.add(itemKey(i)) : next.delete(itemKey(i))));
      return next;
    });
  };

  const selectedItems = useMemo(() => {
    if (!preview) return [];
    return [...preview.new, ...preview.changed, ...preview.unchanged].filter((i) => selected.has(itemKey(i)));
  }, [preview, selected]);

  const handleApply = async () => {
    if (selectedItems.length === 0) return;
    try {
      const res = await applyItems(selectedItems);
      const parts: string[] = [];
      if (res.created) parts.push(`${res.created} novo(s)`);
      if (res.updated) parts.push(`${res.updated} atualizado(s)`);
      toast.success(`Importação concluída: ${parts.join(' e ') || 'nada a fazer'}`);
      if (res.errors?.length) toast.error(`${res.errors.length} item(ns) com erro. Veja os detalhes no log.`);
      onImported();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao importar');
    }
  };

  const missingSources = preview?.sources.filter((s) => s.error) || [];
  const allVisibleSelected = visible.length > 0 && visible.every((i) => selected.has(itemKey(i)));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className="bg-slate-900 border border-slate-800 rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col">
        <div className="p-6 border-b border-slate-800 flex justify-between items-center">
          <div>
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <Download className="w-5 h-5 text-cyan-400" />
              Importar do VetSoft
            </h3>
            <p className="text-sm text-slate-400 mt-1">
              Escolha o que aplicar. Descrição, requisitos e duração que você escreveu aqui são preservados.
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        {loading ? (
          <div className="p-16 flex items-center justify-center text-slate-400">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Buscando catálogo no VetSoft…
          </div>
        ) : error ? (
          <div className="p-10 text-center space-y-4">
            <AlertTriangle className="w-10 h-10 mx-auto text-amber-400" />
            <p className="text-slate-300 text-sm max-w-lg mx-auto">{error}</p>
            <Button onClick={load} className="gap-2">
              <RefreshCw className="w-4 h-4" /> Tentar novamente
            </Button>
          </div>
        ) : (
          <>
            <div className="px-6 pt-4 space-y-3">
              {missingSources.length > 0 && (
                <div className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
                  Não foi possível ler do VetSoft:{' '}
                  {missingSources.map((s) => TYPE_LABEL[s.type]).join(', ')}. Os demais itens seguem disponíveis abaixo.
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2">
                {(['new', 'changed', 'unchanged'] as TabKey[]).map((key) => (
                  <button
                    key={key}
                    onClick={() => setTab(key)}
                    className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                      tab === key
                        ? 'bg-cyan-500/10 border-cyan-500/40 text-cyan-300'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    {key === 'new' ? 'Novos' : key === 'changed' ? 'Alterados' : 'Iguais'} ({listFor(key).length})
                  </button>
                ))}

                <div className="flex-1" />

                <select
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value as any)}
                  className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                >
                  <option value="all">Todos os tipos</option>
                  <option value="service">Serviços</option>
                  <option value="vaccine">Vacinas</option>
                  <option value="product">Produtos</option>
                </select>

                <div className="relative">
                  <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Buscar…"
                    className="bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500 w-44"
                  />
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar px-6 py-4">
              {visible.length === 0 ? (
                <div className="py-16 text-center text-slate-400 text-sm">Nenhum item nesta aba.</div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase tracking-wider text-slate-500 border-b border-slate-800">
                    <tr>
                      <th className="py-2 w-8">
                        <input
                          type="checkbox"
                          checked={allVisibleSelected}
                          onChange={(e) => toggleAllVisible(e.target.checked)}
                          className="w-4 h-4 accent-cyan-500"
                        />
                      </th>
                      <th className="py-2 font-semibold">Nome</th>
                      <th className="py-2 font-semibold">Tipo</th>
                      <th className="py-2 font-semibold">Categoria</th>
                      <th className="py-2 font-semibold text-right">Preço</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((i) => (
                      <tr key={itemKey(i)} className="border-b border-slate-800/60 last:border-0">
                        <td className="py-2.5">
                          <input
                            type="checkbox"
                            checked={selected.has(itemKey(i))}
                            onChange={() => toggle(i)}
                            className="w-4 h-4 accent-cyan-500"
                          />
                        </td>
                        <td className="py-2.5 text-white">
                          {i.name}
                          {i.current && i.current.name && i.current.name.trim() !== i.name && (
                            <div className="text-xs text-slate-500">antes: {i.current.name}</div>
                          )}
                        </td>
                        <td className="py-2.5 text-slate-400">{TYPE_LABEL[i.type]}</td>
                        <td className="py-2.5 text-slate-300">{i.category || '—'}</td>
                        <td className="py-2.5 text-right font-mono text-slate-300">
                          {i.current && i.current.price !== i.price ? (
                            <span>
                              <span className="text-slate-500 line-through mr-2">{money(i.current.price)}</span>
                              <span className="text-emerald-300">{money(i.price)}</span>
                            </span>
                          ) : (
                            money(i.price)
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="p-6 border-t border-slate-800 flex items-center gap-3">
              <span className="text-sm text-slate-400">
                {selectedItems.length} item(ns) selecionado(s) de {preview?.total ?? 0} no VetSoft
              </span>
              <div className="flex-1" />
              <Button variant="ghost" onClick={onClose} className="border border-slate-700 hover:bg-slate-800">
                Cancelar
              </Button>
              <Button onClick={handleApply} disabled={applying || selectedItems.length === 0} className="gap-2">
                {applying && <Loader2 className="w-4 h-4 animate-spin" />}
                Importar selecionados
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default VetsoftImportDialog;
