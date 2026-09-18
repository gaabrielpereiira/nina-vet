// Helper compartilhado para ler a API key da Zernio.
// Prioridade: secret de ambiente (ZERNIO_API_KEY) -> coluna nina_settings.zernio_api_key
// (preenchida na tela Configurações > APIs).

export async function getZernioApiKey(supabase: any): Promise<string | null> {
  const envKey = Deno.env.get('ZERNIO_API_KEY');
  if (envKey) return envKey;

  try {
    const { data } = await supabase
      .from('nina_settings')
      .select('zernio_api_key')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    const key = (data?.zernio_api_key || '').trim();
    return key || null;
  } catch {
    return null;
  }
}
