import { useCallback, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { FunctionsHttpError } from '@supabase/supabase-js';

export type VetsoftItemType = 'service' | 'vaccine' | 'product';

export interface VetsoftCatalogItem {
  external_id: number;
  type: VetsoftItemType;
  name: string;
  category: string | null;
  price: number | null;
  existing_id?: string;
  current?: {
    name: string | null;
    category: string | null;
    price: number | null;
    price_type: string | null;
  };
}

export interface VetsoftCatalogSource {
  type: VetsoftItemType;
  path: string | null;
  count: number;
  error?: string;
}

export interface VetsoftImportPreview {
  sources: VetsoftCatalogSource[];
  total: number;
  new: VetsoftCatalogItem[];
  changed: VetsoftCatalogItem[];
  unchanged: VetsoftCatalogItem[];
}

async function invoke(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('vetsoft-import-procedures', { body });
  if (error) {
    let message = error.message;
    if (error instanceof FunctionsHttpError) {
      try {
        const payload = await error.context.json();
        if (payload?.error) message = payload.error;
      } catch {
        // mantém a mensagem original
      }
    }
    throw new Error(message);
  }
  if ((data as any)?.error) throw new Error((data as any).error);
  return data as any;
}

export function useVetsoftProcedureImport() {
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);

  const fetchPreview = useCallback(async (): Promise<VetsoftImportPreview> => {
    setLoading(true);
    try {
      const data = await invoke({ mode: 'preview' });
      return {
        sources: data.sources || [],
        total: data.total || 0,
        new: data.new || [],
        changed: data.changed || [],
        unchanged: data.unchanged || [],
      };
    } finally {
      setLoading(false);
    }
  }, []);

  const applyItems = useCallback(async (items: VetsoftCatalogItem[]) => {
    setApplying(true);
    try {
      const payload = items.map((i) => ({
        external_id: i.external_id,
        type: i.type,
        name: i.name,
        category: i.category,
        price: i.price,
      }));
      return await invoke({ mode: 'apply', items: payload }) as {
        created: number;
        updated: number;
        errors: string[];
      };
    } finally {
      setApplying(false);
    }
  }, []);

  return { fetchPreview, applyItems, loading, applying };
}
