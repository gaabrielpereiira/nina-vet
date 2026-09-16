// Edge function: importa o catálogo do VetSoft (serviços, vacinas e produtos com preço)
// para a tabela `procedures`.
//
// Dois modos:
//  - preview: lê o catálogo e compara com o que já existe, devolvendo new/changed/unchanged
//  - apply:   grava apenas os itens marcados pelo usuário, preservando o que foi escrito à mão
//             (description, requirements, duration_minutes, is_active)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getVetsoftAccessToken, listCatalog } from "../_shared/vetsoft.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface IncomingItem {
  external_id: number;
  type: 'service' | 'vaccine' | 'product';
  name: string;
  category: string | null;
  price: number | null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Autenticação necessária' }, 401);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: userData, error: userErr } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', ''),
    );
    if (userErr || !userData?.user) return json({ error: 'Token inválido' }, 401);

    const body = await req.json().catch(() => ({}));
    const mode = body?.mode === 'apply' ? 'apply' : 'preview';

    if (mode === 'apply') {
      const items: IncomingItem[] = Array.isArray(body?.items) ? body.items : [];
      if (items.length === 0) return json({ error: 'Nenhum item selecionado' }, 400);
      return json(await applyItems(supabase, items));
    }

    try {
      await getVetsoftAccessToken(supabase);
    } catch (loginErr: any) {
      return json({ error: loginErr?.message || 'Falha ao conectar com o VetSoft' }, 400);
    }

    const { items, sources } = await listCatalog(supabase);

    const { data: existing, error: exErr } = await supabase
      .from('procedures')
      .select('id, name, category, price, price_type, vetsoft_item_id, vetsoft_item_type');
    if (exErr) throw exErr;

    const byExternal = new Map<string, any>();
    const byName = new Map<string, any>();
    for (const p of existing || []) {
      if (p.vetsoft_item_id != null && p.vetsoft_item_type) {
        byExternal.set(`${p.vetsoft_item_type}:${p.vetsoft_item_id}`, p);
      }
      if (p.name) byName.set(p.name.trim().toLowerCase(), p);
    }

    const newItems: any[] = [];
    const changedItems: any[] = [];
    const unchangedItems: any[] = [];

    // Dedup por (tipo, id) — o VetSoft pode repetir itens entre páginas.
    const seen = new Set<string>();
    for (const item of items) {
      const key = `${item.type}:${item.external_id}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const match = byExternal.get(key) || byName.get(item.name.trim().toLowerCase());
      if (!match) {
        newItems.push(item);
        continue;
      }

      const currentPrice = match.price_type === 'fixed' ? (match.price != null ? Number(match.price) : null) : null;
      const priceDiff = (item.price ?? null) !== currentPrice;
      const nameDiff = (match.name || '').trim() !== item.name;
      const categoryDiff = (match.category || null) !== (item.category || null);

      if (priceDiff || nameDiff || categoryDiff) {
        changedItems.push({
          ...item,
          existing_id: match.id,
          current: { name: match.name, category: match.category, price: currentPrice, price_type: match.price_type },
        });
      } else {
        unchangedItems.push({ ...item, existing_id: match.id });
      }
    }

    return json({
      ok: true,
      sources,
      total: seen.size,
      new: newItems,
      changed: changedItems,
      unchanged: unchangedItems,
    });
  } catch (e) {
    console.error('[vetsoft-import-procedures] error:', e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

const TYPE_TO_CATEGORY: Record<string, string> = {
  service: 'Outros',
  vaccine: 'Vacina',
  product: 'Outros',
};

async function applyItems(supabase: any, items: IncomingItem[]) {
  const now = new Date().toISOString();
  let created = 0;
  let updated = 0;
  const errors: string[] = [];

  for (const item of items) {
    if (!item?.name || item?.external_id == null || !item?.type) continue;

    const base = {
      name: item.name,
      category: item.category || TYPE_TO_CATEGORY[item.type] || 'Outros',
      price_type: 'fixed',
      price: item.price ?? null,
      price_min: null,
      price_max: null,
      vetsoft_item_id: item.external_id,
      vetsoft_item_type: item.type,
      vetsoft_synced_at: now,
      source: 'vetsoft',
    };

    // Localiza o registro existente por (tipo, id) do VetSoft ou, no primeiro import, pelo nome.
    const { data: byExt } = await supabase
      .from('procedures')
      .select('id')
      .eq('vetsoft_item_type', item.type)
      .eq('vetsoft_item_id', item.external_id)
      .maybeSingle();

    let targetId: string | null = byExt?.id ?? null;
    if (!targetId) {
      const { data: byName } = await supabase
        .from('procedures')
        .select('id')
        .ilike('name', item.name)
        .is('vetsoft_item_id', null)
        .limit(1)
        .maybeSingle();
      targetId = byName?.id ?? null;
    }

    if (targetId) {
      const { error } = await supabase.from('procedures').update(base).eq('id', targetId);
      if (error) errors.push(`${item.name}: ${error.message}`);
      else updated++;
    } else {
      const { error } = await supabase.from('procedures').insert({
        ...base,
        description: null,
        requirements: null,
        duration_minutes: null,
        is_active: true,
      });
      if (error) errors.push(`${item.name}: ${error.message}`);
      else created++;
    }
  }

  return { ok: true, created, updated, errors };
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
