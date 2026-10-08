/** Backend workers require the service key; UI operations require a clinic admin. */
export async function authorizeAutomationRequest(req: Request, supabase: any): Promise<Response | null> {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (token && serviceKey && token === serviceKey) return null;
  if (!token) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  const { data: role, error: roleError } = await supabase.from('user_roles')
    .select('role').eq('user_id', data.user.id).eq('role', 'admin').maybeSingle();
  if (roleError || !role) return new Response(JSON.stringify({ error: 'Admin access required' }), { status: 403 });
  return null;
}
