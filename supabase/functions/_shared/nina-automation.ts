/** Global single-tenant switch. Read afresh: never cache this before a send. */
export async function getNinaAutomationBlockReason(supabase: any): Promise<string | null> {
  const { data, error } = await supabase
    .from('nina_settings')
    .select('is_active, auto_response_enabled')
    .order('created_at')
    .order('id')
    .limit(1)
    .maybeSingle();

  // A failed lookup must not accidentally permit an automatic reply.
  if (error) throw error;
  if (!data) return 'Nina settings not configured';
  if (!data.is_active || !data.auto_response_enabled) return 'Nina paused globally';
  return null;
}
