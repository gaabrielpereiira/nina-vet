import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';

export function useIsAdmin() {
  const { user } = useAuth();
  const q = useQuery({
    queryKey: ['is-admin', user?.id],
    enabled: !!user,
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await supabase.from('user_roles').select('role')
        .eq('user_id', user!.id).eq('role', 'admin').maybeSingle();
      return !!data;
    },
  });
  return { isAdmin: !!q.data, loading: !!user && q.isPending };
}
