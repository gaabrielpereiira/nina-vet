// Edge function: importa tutores (clientes) e seus pets do VetSoft para `contacts` / `animals`.
//
// Modos:
//  - preview: lê tutores + pets do VetSoft e compara com os contatos já existentes
//             (por vetsoft_client_id ou telefone), devolvendo new/changed/unchanged
//  - apply:   grava apenas os tutores marcados (em lote) e os pets vinculados a eles.
//             Nada é excluído; notas e tags escritas à mão são preservadas.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getVetsoftAccessToken, listTutors, listPets, VetsoftPet } from "../_shared/vetsoft.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface IncomingTutor {
  external_id: number;
  name: string;
  phone: string | null;
  email: string | null;
  pets?: VetsoftPet[];
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
    const userId = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const mode = body?.mode === 'apply' ? 'apply' : body?.mode === 'pets' ? 'pets' : 'preview';

    if (mode === 'apply') {
      const tutors: IncomingTutor[] = Array.isArray(body?.tutors) ? body.tutors : [];
      if (tutors.length === 0) return json({ error: 'Nenhum tutor selecionado' }, 400);
      return json(await applyTutors(supabase, tutors, userId));
    }

    if (mode === 'pets') {
      try {
        await getVetsoftAccessToken(supabase);
      } catch (loginErr: any) {
        return json({ error: loginErr?.message || 'Falha ao conectar com o VetSoft' }, 400);
      }
      try {
        return json(await syncPetsOnly(supabase));
      } catch (e: any) {
        return json({ error: e?.message || 'Falha ao importar os pets do VetSoft' }, 400);
      }
    }


    try {
      await getVetsoftAccessToken(supabase);
    } catch (loginErr: any) {
      return json({ error: loginErr?.message || 'Falha ao conectar com o VetSoft' }, 400);
    }

    let tutors;
    try {
      tutors = (await listTutors(supabase)).tutors;
    } catch (e: any) {
      return json({ error: e?.message || 'Falha ao ler os tutores do VetSoft' }, 400);
    }


    let pets: VetsoftPet[] = [];
    let petsError: string | null = null;
    try {
      pets = (await listPets(supabase)).pets;
    } catch (e: any) {
      petsError = e?.message || String(e);
      console.warn('[vetsoft-import-clients] falha ao listar pets:', petsError);
    }

    const petsByClient = new Map<number, VetsoftPet[]>();
    for (const p of pets) {
      if (p.client_external_id == null) continue;
      const arr = petsByClient.get(p.client_external_id) || [];
      arr.push(p);
      petsByClient.set(p.client_external_id, arr);
    }

    const { data: existing, error: exErr } = await supabase
      .from('contacts')
      .select('id, name, phone_number, email, vetsoft_client_id');
    if (exErr) throw exErr;

    const byExternal = new Map<number, any>();
    const byPhone = new Map<string, any>();
    for (const c of existing || []) {
      if (c.vetsoft_client_id != null) byExternal.set(Number(c.vetsoft_client_id), c);
      if (c.phone_number) byPhone.set(String(c.phone_number).replace(/\D/g, ''), c);
    }

    const newItems: any[] = [];
    const changedItems: any[] = [];
    const unchangedItems: any[] = [];
    const withoutPhone: any[] = [];

    const seen = new Set<number>();
    for (const t of tutors) {
      if (seen.has(t.external_id)) continue;
      seen.add(t.external_id);

      const item = { ...t, pets: petsByClient.get(t.external_id) || [] };

      // `contacts.phone_number` é obrigatório: tutor sem telefone não pode ser importado.
      if (!t.phone) {
        withoutPhone.push(item);
        continue;
      }

      const match = byExternal.get(t.external_id) || byPhone.get(t.phone);
      if (!match) {
        newItems.push(item);
        continue;
      }

      const nameDiff = (match.name || '').trim() !== t.name;
      const emailDiff = (match.email || null) !== (t.email || null);
      const linkDiff = match.vetsoft_client_id == null;

      const enriched = {
        ...item,
        existing_id: match.id,
        current: { name: match.name, phone: match.phone_number, email: match.email },
      };
      if (nameDiff || emailDiff || linkDiff) changedItems.push(enriched);
      else unchangedItems.push(enriched);
    }

    return json({
      ok: true,
      total: seen.size,
      pets_total: pets.length,
      pets_error: petsError,
      without_phone: withoutPhone.length,
      new: newItems,
      changed: changedItems,
      unchanged: unchangedItems,
    });
  } catch (e) {
    console.error('[vetsoft-import-clients] error:', e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

const chunk = <T,>(arr: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

// Gravação em lote (item por item estoura o tempo limite com centenas de tutores).
async function applyTutors(supabase: any, tutors: IncomingTutor[], userId: string) {
  const now = new Date().toISOString();
  const errors: string[] = [];

  const { data: existing, error: exErr } = await supabase
    .from('contacts')
    .select('id, phone_number, vetsoft_client_id');
  if (exErr) throw exErr;

  const byExternal = new Map<number, string>();
  const byPhone = new Map<string, string>();
  for (const c of existing || []) {
    if (c.vetsoft_client_id != null) byExternal.set(Number(c.vetsoft_client_id), c.id);
    if (c.phone_number) byPhone.set(String(c.phone_number).replace(/\D/g, ''), c.id);
  }

  const toInsert: any[] = [];
  const toUpdate: any[] = [];
  const usedIds = new Set<string>();
  const petsByExternal = new Map<number, VetsoftPet[]>();

  for (const t of tutors) {
    if (!t?.name || t?.external_id == null || !t?.phone) continue;
    petsByExternal.set(t.external_id, Array.isArray(t.pets) ? t.pets : []);

    const phone = String(t.phone).replace(/\D/g, '');
    const base = {
      name: t.name,
      email: t.email || null,
      vetsoft_client_id: t.external_id,
      vetsoft_synced_at: now,
      vetsoft_sync_error: null,
    };

    const targetId = byExternal.get(t.external_id) ?? byPhone.get(phone) ?? null;
    if (targetId && !usedIds.has(targetId)) {
      usedIds.add(targetId);
      toUpdate.push({ id: targetId, ...base });
    } else if (!targetId) {
      toInsert.push({ ...base, phone_number: phone, whatsapp_id: phone, user_id: userId });
    }
  }

  let created = 0;
  let updated = 0;
  const contactIdByExternal = new Map<number, string>(byExternal);

  for (const batch of chunk(toInsert, 100)) {
    const { data, error } = await supabase.from('contacts').insert(batch).select('id, vetsoft_client_id');
    if (error) {
      errors.push(error.message);
      continue;
    }
    created += data?.length || 0;
    for (const row of data || []) {
      if (row.vetsoft_client_id != null) contactIdByExternal.set(Number(row.vetsoft_client_id), row.id);
    }
  }

  for (const batch of chunk(toUpdate, 100)) {
    const { error } = await supabase.from('contacts').upsert(batch, { onConflict: 'id' });
    if (error) errors.push(error.message);
    else updated += batch.length;
  }
  for (const row of toUpdate) {
    const external = row.vetsoft_client_id;
    if (external != null) contactIdByExternal.set(Number(external), row.id);
  }

  // ── Pets ────────────────────────────────────────────────────────────────
  const petsFlat: any[] = [];
  for (const [external, pets] of petsByExternal) {
    const contactId = contactIdByExternal.get(external);
    if (!contactId) continue;
    for (const p of pets) {
      if (!p?.name || p?.external_id == null) continue;
      petsFlat.push({
        contact_id: contactId,
        name: p.name,
        species: p.species || null,
        breed: p.breed || null,
        sex: p.sex || null,
        birth_date: p.birth_date || null,
        vetsoft_animal_id: p.external_id,
        vetsoft_synced_at: now,
      });
    }
  }

  let petsCreated = 0;
  if (petsFlat.length > 0) {
    const { data: existingPets, error: petErr } = await supabase
      .from('animals')
      .select('id, vetsoft_animal_id')
      .not('vetsoft_animal_id', 'is', null);
    if (petErr) errors.push(petErr.message);

    const knownPets = new Set((existingPets || []).map((p: any) => Number(p.vetsoft_animal_id)));
    const petsToInsert = petsFlat.filter((p) => !knownPets.has(Number(p.vetsoft_animal_id)));

    for (const batch of chunk(petsToInsert, 100)) {
      const { error } = await supabase.from('animals').insert(batch);
      if (error) errors.push(error.message);
      else petsCreated += batch.length;
    }
  }

  return { ok: true, created, updated, pets_created: petsCreated, errors };
}

function json(data: unknown, status = 200) {

// Importa apenas os pets do VetSoft, vinculando-os aos tutores já existentes no sistema.
async function syncPetsOnly(supabase: any) {
  const now = new Date().toISOString();
  const errors: string[] = [];

  const { pets } = await listPets(supabase);

  const { data: contacts, error: cErr } = await supabase
    .from('contacts')
    .select('id, vetsoft_client_id')
    .not('vetsoft_client_id', 'is', null);
  if (cErr) throw cErr;

  const contactIdByExternal = new Map<number, string>();
  for (const c of contacts || []) contactIdByExternal.set(Number(c.vetsoft_client_id), c.id);

  const { data: existingPets, error: pErr } = await supabase
    .from('animals')
    .select('id, vetsoft_animal_id')
    .not('vetsoft_animal_id', 'is', null);
  if (pErr) throw pErr;

  const petIdByExternal = new Map<number, string>();
  for (const p of existingPets || []) petIdByExternal.set(Number(p.vetsoft_animal_id), p.id);

  const toInsert: any[] = [];
  const toUpdate: any[] = [];
  let withoutTutor = 0;

  for (const p of pets) {
    if (!p?.name || p?.external_id == null || p.client_external_id == null) continue;
    const contactId = contactIdByExternal.get(Number(p.client_external_id));
    if (!contactId) {
      withoutTutor++;
      continue;
    }
    const base = {
      contact_id: contactId,
      name: p.name,
      species: p.species || null,
      breed: p.breed || null,
      sex: p.sex || null,
      birth_date: p.birth_date || null,
      vetsoft_animal_id: p.external_id,
      vetsoft_synced_at: now,
      vetsoft_sync_error: null,
    };
    const known = petIdByExternal.get(Number(p.external_id));
    if (known) toUpdate.push({ id: known, ...base });
    else toInsert.push(base);
  }

  let created = 0;
  let updated = 0;

  for (const batch of chunk(toInsert, 200)) {
    const { error } = await supabase.from('animals').insert(batch);
    if (error) errors.push(error.message);
    else created += batch.length;
  }
  for (const batch of chunk(toUpdate, 200)) {
    const { error } = await supabase.from('animals').upsert(batch, { onConflict: 'id' });
    if (error) errors.push(error.message);
    else updated += batch.length;
  }

  return { ok: true, pets_total: pets.length, created, updated, without_tutor: withoutTutor, errors };
}


  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
