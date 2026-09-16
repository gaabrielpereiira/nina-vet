import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface ContactAnimal {
  id: string;
  name: string;
  species: string | null;
  breed: string | null;
  sex: string | null;
  birth_date: string | null;
}

export interface ContactMessage {
  id: string;
  content: string | null;
  type: string;
  from_type: string;
  created_at: string;
}

export interface ContactAppointment {
  id: string;
  title: string;
  date: string;
  time: string;
  status: string | null;
  procedure_name: string | null;
}

export interface ContactDetails {
  contact: {
    id: string;
    name: string | null;
    call_name: string | null;
    phone_number: string;
    email: string | null;
    tags: string[] | null;
    notes: string | null;
    vetsoft_client_id: number | null;
    first_contact_date: string;
    last_activity: string;
  } | null;
  animals: ContactAnimal[];
  messages: ContactMessage[];
  conversationId: string | null;
  appointments: ContactAppointment[];
}

const EMPTY: ContactDetails = {
  contact: null,
  animals: [],
  messages: [],
  conversationId: null,
  appointments: [],
};

export function useContactDetails(contactId: string | null) {
  const [details, setDetails] = useState<ContactDetails>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const [contactRes, animalsRes, convRes, apptRes] = await Promise.all([
        supabase
          .from('contacts')
          .select('id, name, call_name, phone_number, email, tags, notes, vetsoft_client_id, first_contact_date, last_activity')
          .eq('id', id)
          .maybeSingle(),
        supabase
          .from('animals')
          .select('id, name, species, breed, sex, birth_date')
          .eq('contact_id', id)
          .order('created_at', { ascending: true }),
        supabase
          .from('conversations')
          .select('id')
          .eq('contact_id', id)
          .order('last_message_at', { ascending: false })
          .limit(1),
        supabase
          .from('appointments')
          .select('id, title, date, time, status, procedure:procedures(name)')
          .eq('contact_id', id)
          .order('date', { ascending: false })
          .limit(20),
      ]);

      if (contactRes.error) throw contactRes.error;

      const conversationId = convRes.data?.[0]?.id ?? null;
      let messages: ContactMessage[] = [];
      if (conversationId) {
        const { data: msgs } = await supabase
          .from('messages')
          .select('id, content, type, from_type, created_at')
          .eq('conversation_id', conversationId)
          .order('created_at', { ascending: false })
          .limit(30);
        messages = (msgs || []).slice().reverse() as ContactMessage[];
      }

      setDetails({
        contact: (contactRes.data as any) ?? null,
        animals: (animalsRes.data as any) || [],
        conversationId,
        messages,
        appointments: ((apptRes.data as any[]) || []).map((a) => ({
          id: a.id,
          title: a.title,
          date: a.date,
          time: a.time,
          status: a.status,
          procedure_name: a.procedure?.name ?? null,
        })),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setDetails(EMPTY);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!contactId) {
      setDetails(EMPTY);
      return;
    }
    load(contactId);
  }, [contactId, load]);

  return { ...details, loading, error, reload: () => contactId && load(contactId) };
}
