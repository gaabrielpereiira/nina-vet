import React, { useEffect, useMemo, useState } from 'react';
import { X, Loader2, Download, AlertTriangle, Search, RefreshCw, PawPrint } from 'lucide-react';
import { Button } from '../Button';
import { toast } from 'sonner';
import {
  useVetsoftClientImport,
  VetsoftTutor,
  VetsoftClientImportPreview,
} from '@/hooks/useVetsoftClientImport';

type TabKey = 'new' | 'changed' | 'unchanged';

const tutorKey = (t: VetsoftTutor) => `${t.external_id}`;

interface Props {
  onClose: () => void;
  onImported: () => void;
}

const VetsoftClientsImportDialog: React.FC<Props> = ({ onClose, onImported }) => {
  const { fetchPreview, applyTutors, loading, applying } = useVetsoftClientImport();
  const [preview, setPreview] = useState<VetsoftClientImportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>('new');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const load = async () => {
    setError(null);
    try {
      const data = await fetchPreview();
      setPreview(data);
      setSelected(new Set(data.new.map(tutorKey)));
      setTab(data.new.length > 0 || data.changed.length === 0 ? 'new' : 'changed');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const listFor = (key: TabKey): VetsoftTutor[] => {
    if (!preview) return [];
    return key === 'new' ? preview.new : key === 'changed' ? preview.changed : preview.unchanged;
  };

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return listFor(tab).filter((t) => {
      if (!term) return true;
      return (
        t.name.toLowerCase().includes(term) ||
        (t.phone || '').includes(term) ||
        (t.email || '').toLowerCase().includes(term) ||
        (t.pets || []).some((p) => p.name.toLowerCase().includes(term))
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview, tab, search]);

  const toggle = (t: VetsoftTutor) => {
    const key = tutorKey(t);
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const toggleAllVisible = (checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      visible.forEach((t) => (checked ? next.add(tutorKey(t)) : next.delete(tutorKey(t))));
      return next;
    });
  };

  const selectedTutors = useMemo(() => {
    if (!preview) return [];
    return [...preview.new, ...preview.changed, ...preview.unchanged].filter((t) => selected.has(tutorKey(t)));
  }, [preview, selected]);

  const handleApply = async () => {
    if (selectedTutors.length === 0) return;
    try {
      const res = await applyTutors(selectedTutors);
      const parts: string[] = [];
      if (res.created) parts.push(`${res.created} tutor(es) novo(s)`);
      if (res.updated) parts.push(`${res.updated} atualizado(s)`);
      if (res.pets_created) parts.push(`${res.pets_created} pet(s)`);
      toast.success(`Importação concluída: ${parts.join(', ') || 'nada a fazer'}`);
      if (res.errors?.length) toast.error(res.errors[0]);
      onImported();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao importar');
    }
  };

  const allVisibleSelected = visible.length > 0 && visible.every((t) => selected.has(tutorKey(t)));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className="bg-slate-900 border border-slate-800 rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col">
        <div className="p-6 border-b border-slate-800 flex justify-between items-center">
          <div>
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <Download className="w-5 h-5 text-cyan-400" />
              Importar tutores do VetSoft
            </h3>
            <p className="text-sm text-slate-400 mt-1">
              Escolha quem trazer. Os pets de cada tutor vêm junto e nada é excluído aqui.
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        {loading ? (
          <div className="p-16 flex items-center justify-center text-slate-400">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Buscando tutores e pets no VetSoft…
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
              {(preview?.without_phone || preview?.pets_error) && (
                <div className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 space-y-1">
                  {!!preview?.without_phone && (
                    <p>{preview.without_phone} tutor(es) do VetSoft estão sem telefone e não podem ser importados.</p>
                  )}
                  {preview?.pets_error && <p className="text-amber-200/80">Pets não pudaram ser lidos: {preview.pets_error}</p>}
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
                <div className="py-16 text-center text-slate-400 text-sm">Nenhum tutor nesta aba.</div>
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
                      <th className="py-2 font-semibold">Tutor</th>
                      <th className="py-2 font-semibold">Telefone</th>
                      <th className="py-2 font-semibold">E-mail</th>
                      <th className="py-2 font-semibold">Pets</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((t) => (
                      <tr key={tutorKey(t)} className="border-b border-slate-800/60 last:border-0 align-top">
                        <td className="py-2.5">
                          <input
                            type="checkbox"
                            checked={selected.has(tutorKey(t))}
                            onChange={() => toggle(t)}
                            className="w-4 h-4 accent-cyan-500"
                          />
                        </td>
                        <td className="py-2.5 text-white">
                          {t.name}
                          {t.current?.name && t.current.name.trim() !== t.name && (
                            <div className="text-xs text-slate-500">antes: {t.current.name}</div>
                          )}
                        </td>
                        <td className="py-2.5 font-mono text-slate-300">{t.phone || '—'}</td>
                        <td className="py-2.5 text-slate-400">{t.email || '—'}</td>
                        <td className="py-2.5 text-slate-300">
                          {(t.pets || []).length === 0 ? (
                            <span className="text-slate-600">—</span>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {t.pets.map((p) => (
                                <span
                                  key={p.external_id}
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-800 text-xs text-slate-300"
                                >
                                  <PawPrint className="w-3 h-3 text-cyan-400" />
                                  {p.name}
                                </span>
                              ))}
                            </div>
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
                {selectedTutors.length} tutor(es) selecionado(s) de {preview?.total ?? 0} no VetSoft
              </span>
              <div className="flex-1" />
              <Button variant="ghost" onClick={onClose} className="border border-slate-700 hover:bg-slate-800">
                Cancelar
              </Button>
              <Button onClick={handleApply} disabled={applying || selectedTutors.length === 0} className="gap-2">
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

export default VetsoftClientsImportDialog;
