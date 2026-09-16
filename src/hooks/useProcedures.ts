import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface Procedure {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  requirements: string | null;
  price_type: 'fixed' | 'range';
  price: number | null;
  price_min: number | null;
  price_max: number | null;
  duration_minutes: number | null;
  is_active: boolean;
  vetsoft_item_id?: number | null;
  vetsoft_item_type?: string | null;
  vetsoft_synced_at?: string | null;
  source?: string | null;
  created_at: string;
  updated_at: string;
}

export type ProcedureInput = Omit<
  Procedure,
  'id' | 'created_at' | 'updated_at' | 'vetsoft_item_id' | 'vetsoft_item_type' | 'vetsoft_synced_at' | 'source'
>;


export function useProcedures(activeOnly = false) {
  const [procedures, setProcedures] = useState<Procedure[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchProcedures = useCallback(async () => {
    setLoading(true);
    try {
      let query = supabase.from('procedures' as any).select('*').order('name');
      if (activeOnly) query = query.eq('is_active', true);
      const { data, error } = await query;
      if (error) throw error;
      setProcedures((data || []) as unknown as Procedure[]);
    } catch (err) {
      console.error('[useProcedures] fetch error:', err);
      toast.error('Erro ao carregar procedimentos');
    } finally {
      setLoading(false);
    }
  }, [activeOnly]);

  useEffect(() => {
    fetchProcedures();
    const channel = supabase
      .channel('procedures-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'procedures' },
        () => fetchProcedures()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchProcedures]);

  const createProcedure = async (input: ProcedureInput) => {
    const { error } = await supabase.from('procedures' as any).insert(input as any);
    if (error) {
      toast.error('Erro ao criar procedimento');
      throw error;
    }
    toast.success('Procedimento criado');
  };

  const updateProcedure = async (id: string, updates: Partial<ProcedureInput>) => {
    const { error } = await supabase.from('procedures' as any).update(updates as any).eq('id', id);
    if (error) {
      toast.error('Erro ao atualizar procedimento');
      throw error;
    }
    toast.success('Procedimento atualizado');
  };

  const deleteProcedure = async (id: string) => {
    const { error } = await supabase.from('procedures' as any).delete().eq('id', id);
    if (error) {
      toast.error('Erro ao excluir procedimento');
      throw error;
    }
    toast.success('Procedimento excluído');
  };

  const toggleActive = async (id: string, is_active: boolean) => {
    await updateProcedure(id, { is_active });
  };

  return { procedures, loading, createProcedure, updateProcedure, deleteProcedure, toggleActive, refetch: fetchProcedures };
}
