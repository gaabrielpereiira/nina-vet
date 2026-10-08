import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { authorizeAutomationRequest } from '../_shared/automation-auth.ts';
import { getZernioApiKey } from '../_shared/zernio.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const denied = await authorizeAutomationRequest(req, supabase);
    if (denied) return new Response(denied.body, { status: denied.status, headers: corsHeaders });
    const { data: settings, error: settingsError } = await supabase.from('nina_settings')
      .select('zernio_account_id').order('created_at').order('id').limit(1).maybeSingle();
    if (settingsError) throw settingsError;
    const apiKey = await getZernioApiKey(supabase);
    if (!settings?.zernio_account_id || !apiKey) throw new Error('Configure o WhatsApp e a chave Zernio nas configurações de APIs.');
    const url = new URL('https://zernio.com/api/v1/whatsapp/templates');
    url.searchParams.set('accountId', settings.zernio_account_id);
    const response = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Falha ao consultar os templates na Zernio.');
    if (!Array.isArray(payload.templates)) throw new Error('Resposta de templates inválida.');
    const rows = payload.templates.map((template: any) => ({
      meta_template_id: template.id, name: template.name, language: template.language,
      category: template.category || 'UTILITY', status: template.status,
      components: template.components || [], updated_at: new Date().toISOString(),
    }));
    if (rows.length) {
      const { error } = await supabase.from('whatsapp_templates').upsert(rows, { onConflict: 'name,language' });
      if (error) throw error;
    }
    // Templates removed in the provider must not remain selectable as approved.
    const { data: existing, error: existingError } = await supabase.from('whatsapp_templates').select('id, name, language');
    if (existingError) throw existingError;
    const received = new Set(rows.map((r: any) => `${r.name}:${r.language}`));
    const removed = (existing || []).filter((r: any) => !received.has(`${r.name}:${r.language}`)).map((r: any) => r.id);
    if (removed.length) {
      const { error } = await supabase.from('whatsapp_templates').update({ status: 'DISABLED' }).in('id', removed);
      if (error) throw error;
    }
    return new Response(JSON.stringify({ success: true, synced: rows.length }), { headers: corsHeaders });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Falha na sincronização' }), { status: 500, headers: corsHeaders });
  }
});
