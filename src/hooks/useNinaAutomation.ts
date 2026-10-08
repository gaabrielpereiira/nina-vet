import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';

// This installation uses one shared configuration for the whole clinic.
export function useNinaAutomation() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const queryKey = ['nina-automation', user?.id];
  const query = useQuery({
    queryKey,
    enabled: !!user,
    refetchInterval: 5000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('nina_settings')
        .select('id, is_active, auto_response_enabled')
        .order('created_at')
        .order('id')
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const mutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      if (!query.data?.id) throw new Error('Configure a Nina antes de alterar o atendimento.');
      const { data, error } = await supabase
        .from('nina_settings')
        .update({ is_active: enabled, auto_response_enabled: enabled })
        .eq('id', query.data.id)
        .select('id, is_active, auto_response_enabled')
        .single();
      // Requiring the updated row also detects updates denied by RLS.
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => queryClient.setQueryData(queryKey, data),
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  });

  return {
    enabled: !!query.data?.is_active && !!query.data?.auto_response_enabled,
    available: !!query.data && !query.isError,
    loading: query.isPending,
    error: query.isError,
    saving: mutation.isPending,
    setEnabled: mutation.mutateAsync,
  };
}
