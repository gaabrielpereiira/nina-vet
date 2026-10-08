import { authorizeAutomationRequest } from "../_shared/automation-auth.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );
    const denied = await authorizeAutomationRequest(req, supabase);
    if (denied) return new Response(denied.body, { status: denied.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    const { data, error } = await supabase.rpc('cleanup_webhook_data');
    if (error) throw error;
    const summary = Array.isArray(data) ? data[0] : data;
    console.log('[webhook-cleanup]', summary);
    return new Response(JSON.stringify({ success: true, ...summary }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('[webhook-cleanup] error:', e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'Unknown' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
