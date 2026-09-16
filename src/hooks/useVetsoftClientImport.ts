import { useCallback, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { FunctionsHttpError } from '@supabase/supabase-js';

export interface VetsoftPet {
  external_id: number;
  client_external_id: number | null;
  name: string;
  species: string | null;
  breed: string | null;
  sex: string | null;
  birth_date: string | null;
}

export interface VetsoftTutor {
  external_id: number;
  name: string;
  phone: string | null;
  email: string | null;
  pets: VetsoftPet[];
  existing_id?: string;
  current?: {
    name: string | null;
    phone: string | null;
    email: string | null;
  };
}

export interface VetsoftClientImportPreview {
  total: number;
  pets_total: number;
  pets_error: string | null;
  without_phone: number;
  new: VetsoftTutor[];
  changed: VetsoftTutor[];
  unchanged: VetsoftTutor[];
}

async function invoke(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('vetsoft-import-clients', { body });
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

export function useVetsoftClientImport() {
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);

  const fetchPreview = useCallback(async (): Promise<VetsoftClientImportPreview> => {
    setLoading(true);
    try {
      const data = await invoke({ mode: 'preview' });
      return {
        total: data.total || 0,
        pets_total: data.pets_total || 0,
        pets_error: data.pets_error || null,
        without_phone: data.without_phone || 0,
        new: data.new || [],
        changed: data.changed || [],
        unchanged: data.unchanged || [],
      };
    } finally {
      setLoading(false);
    }
  }, []);

  const applyTutors = useCallback(async (tutors: VetsoftTutor[]) => {
    setApplying(true);
    try {
      const payload = tutors.map((t) => ({
        external_id: t.external_id,
        name: t.name,
        phone: t.phone,
        email: t.email,
        pets: t.pets || [],
      }));
      return await invoke({ mode: 'apply', tutors: payload }) as {
        created: number;
        updated: number;
        pets_created: number;
        errors: string[];
      };
    } finally {
      setApplying(false);
    }
  }, []);

  const importPets = useCallback(async () => {
    setApplying(true);
    try {
      return await invoke({ mode: 'pets' }) as {
        pets_total: number;
        created: number;
        updated: number;
        without_tutor: number;
        errors: string[];
      };
    } finally {
      setApplying(false);
    }
  }, []);

  return { fetchPreview, applyTutors, importPets, loading, applying };
}

