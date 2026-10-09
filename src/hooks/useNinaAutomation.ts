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
      const { data, error } = await supabase.rpc('get_nina_automation');
      if (error) throw error;
      return data?.[0] ?? null;
    },
  });
  const mutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      if (!query.data?.id) throw new Error('Configure a Nina antes de alterar o atendimento.');
      const { data, error } = await supabase.rpc('set_nina_automation', { p_enabled: enabled });
      if (error) throw error;
      return data?.[0] ?? null;
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
