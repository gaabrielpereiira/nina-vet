// Cliente compartilhado da API VetSoft (https://vetsoft.readme.io).
//
// Único módulo _shared do projeto até agora — justificado porque a lógica de cache/refresh
// de token (access token expira em 5min, refresh token em 30 dias) é complexa o bastante pra
// não valer a pena duplicar em cada edge function que precisa falar com o VetSoft
// (nina-orchestrator, vetsoft-connect, vetsoft-save-defaults).
//
// A API do VetSoft é multi-tenant via header X-Tenant, autenticação com email/senha (Laravel
// Sanctum) — não é OAuth com popup. As credenciais (tenant/email/senha) ficam em texto simples
// no nina_settings (vetsoft_login_*), editáveis direto na UI de Configurações — mesmo padrão
// já usado pra elevenlabs_api_key/openai_api_key/calcom_api_key nesse projeto.
//
// ⚠️ Os nomes de campo de resposta de /service-types e /tenant-users não estavam documentados
// de forma completa na doc pública (ficaram truncados) — `pickField` tenta variantes plausíveis
// em vez de travar em um nome errado. Revisar assim que houver acesso real pra confirmar.

const VETSOFT_API = 'https://api.vetsoft.com.br';

function pickField(obj: any, candidates: string[]): any {
  for (const key of candidates) {
    if (obj?.[key] !== undefined && obj?.[key] !== null) return obj[key];
  }
  return undefined;
}

async function getSettingsRow(supabase: any) {
  const { data, error } = await supabase
    .from('nina_settings')
    .select('id, vetsoft_access_token, vetsoft_refresh_token, vetsoft_token_expires_at, vetsoft_login_tenant, vetsoft_login_email, vetsoft_login_password')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('nina_settings não encontrado');
  if (!data.vetsoft_login_tenant || !data.vetsoft_login_email || !data.vetsoft_login_password) {
    throw new Error('Credenciais do VetSoft não configuradas. Preencha tenant, email e senha em Configurações.');
  }
  return data;
}

async function login(tenant: string, email: string, password: string): Promise<{ access_token: string; refresh_token: string; expires_in: number }> {
  const res = await fetch(`${VETSOFT_API}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Tenant': tenant },
    body: JSON.stringify({ email, password }),
  });
  const json = await res.json();
  if (!res.ok || !json?.access_token) {
    throw new Error(`Falha no login VetSoft: ${json?.message || res.status}`);
  }
  return json;
}

async function refresh(tenant: string, refreshToken: string): Promise<{ access_token: string; refresh_token: string; expires_in: number } | null> {
  const res = await fetch(`${VETSOFT_API}/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Tenant': tenant },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  if (!res.ok) return null;
  const json = await res.json();
  if (!json?.access_token) return null;
  return json;
}

async function persistTokens(supabase: any, settingsId: string, tokens: { access_token: string; refresh_token: string; expires_in: number }) {
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
  await supabase
    .from('nina_settings')
    .update({
      vetsoft_access_token: tokens.access_token,
      vetsoft_refresh_token: tokens.refresh_token,
      vetsoft_token_expires_at: expiresAt,
      vetsoft_connected_at: new Date().toISOString(),
      vetsoft_last_error: null,
    })
    .eq('id', settingsId);
}

// Retorna um access token válido, logando ou renovando conforme necessário.
export async function getVetsoftAccessToken(supabase: any): Promise<string> {
  const settings = await getSettingsRow(supabase);

  const expiresAt = settings.vetsoft_token_expires_at ? new Date(settings.vetsoft_token_expires_at).getTime() : 0;
  const safetyMarginMs = 30_000;

  if (settings.vetsoft_access_token && expiresAt - safetyMarginMs > Date.now()) {
    return settings.vetsoft_access_token;
  }

  if (settings.vetsoft_refresh_token) {
    const refreshed = await refresh(settings.vetsoft_login_tenant, settings.vetsoft_refresh_token);
    if (refreshed) {
      await persistTokens(supabase, settings.id, refreshed);
      return refreshed.access_token;
    }
  }

  const tokens = await login(settings.vetsoft_login_tenant, settings.vetsoft_login_email, settings.vetsoft_login_password);
  await persistTokens(supabase, settings.id, tokens);
  return tokens.access_token;
}

// Wrapper de fetch com Authorization + X-Tenant, com 1 retry em 401 forçando novo login.
export async function vetsoftFetch(supabase: any, path: string, init: RequestInit = {}, _retried = false): Promise<Response> {
  const settings = await getSettingsRow(supabase);
  const token = await getVetsoftAccessToken(supabase);

  const res = await fetch(`${VETSOFT_API}${path}`, {
    ...init,
    headers: {
      'Authorization': `Bearer ${token}`,
      'X-Tenant': settings.vetsoft_login_tenant,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });

  if (res.status === 401 && !_retried) {
    // Token pode ter sido revogado/expirado fora do controle do cache local — força novo login.
    const tokens = await login(settings.vetsoft_login_tenant, settings.vetsoft_login_email, settings.vetsoft_login_password);
    await persistTokens(supabase, settings.id, tokens);
    return vetsoftFetch(supabase, path, init, true);
  }

  return res;
}

async function vetsoftJson(supabase: any, path: string, init?: RequestInit): Promise<any> {
  const res = await vetsoftFetch(supabase, path, init);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = json?.message || json?.error || `VetSoft ${res.status}`;
    const err: any = new Error(message);
    err.status = res.status;
    err.details = json;
    throw err;
  }
  return json;
}

// ── Clientes ─────────────────────────────────────────────────────────────

export interface VetsoftClient {
  cod_cliente: number;
  nom_cliente: string;
  [key: string]: any;
}

// Busca cliente pelo telefone (normalizado automaticamente pela API VetSoft).
export async function findClientByPhone(supabase: any, phone: string): Promise<VetsoftClient | null> {
  const digits = phone.replace(/\D/g, '');
  const json = await vetsoftJson(supabase, `/clients?contato=${encodeURIComponent(digits)}&per_page=1`);
  const list = json?.data || json?.clients || (Array.isArray(json) ? json : []);
  return list?.[0] || null;
}

export async function createClient(supabase: any, data: { nom_cliente: string; num_cpf?: string }): Promise<VetsoftClient> {
  const json = await vetsoftJson(supabase, '/clients', {
    method: 'POST',
    body: JSON.stringify({
      tip_pessoa: 'pf',
      is_ativo: true,
      nom_cliente: data.nom_cliente,
      ...(data.num_cpf ? { num_cpf: data.num_cpf } : {}),
    }),
  });
  return json?.data || json;
}

// Registra o telefone do WhatsApp como contato do cliente (endpoint separado — /clients não aceita telefone no corpo).
export async function addClientContact(supabase: any, codCliente: number, phone: string): Promise<void> {
  await vetsoftJson(supabase, `/clients/${codCliente}/contacts`, {
    method: 'POST',
    body: JSON.stringify({
      tip_contato: 'cel',
      val_contato: phone.replace(/\D/g, ''),
      is_mensageiro: 'whatsapp',
    }),
  });
}

// ── Taxonomia de animal (raça obrigatória pra criar animal; espécie/pelagem opcionais) ────

export async function findBreedByName(supabase: any, name: string): Promise<{ cod_raca: number; nom_raca: string } | null> {
  if (!name?.trim()) return null;
  const json = await vetsoftJson(supabase, `/breed?search=${encodeURIComponent(name.trim())}&per_page=1`);
  const list = json?.data || (Array.isArray(json) ? json : []);
  return list?.[0] || null;
}

export async function findSpeciesByName(supabase: any, name: string): Promise<{ cod_especie: number; nom_especie: string } | null> {
  if (!name?.trim()) return null;
  const json = await vetsoftJson(supabase, `/species?search=${encodeURIComponent(name.trim())}&per_page=1`);
  const list = json?.data || (Array.isArray(json) ? json : []);
  return list?.[0] || null;
}

export async function findCoatByName(supabase: any, name: string): Promise<{ cod_pelagem: number; nom_pelagem: string } | null> {
  if (!name?.trim()) return null;
  const json = await vetsoftJson(supabase, `/coat?search=${encodeURIComponent(name.trim())}&per_page=1`);
  const list = json?.data || (Array.isArray(json) ? json : []);
  return list?.[0] || null;
}

// ── Animais ──────────────────────────────────────────────────────────────

export interface VetsoftAnimal {
  cod_animal: number;
  [key: string]: any;
}

export async function createAnimal(supabase: any, data: {
  cod_cliente: number;
  nom_animal: string;
  cod_raca: number;
  cod_pelagem?: number;
  des_sexo?: 'M' | 'F';
  dat_nascimento?: string;
}): Promise<VetsoftAnimal> {
  const json = await vetsoftJson(supabase, '/animals', {
    method: 'POST',
    body: JSON.stringify(data),
  });
  return json?.data || json;
}

// ── Tipos de atendimento / usuários (config fixa da clínica, usada nos dropdowns do Settings) ──

export interface VetsoftOption {
  id: number;
  name: string;
}

export async function listServiceTypes(supabase: any): Promise<VetsoftOption[]> {
  const json = await vetsoftJson(supabase, '/service-types?per_page=100&status=active');
  const list = json?.data || (Array.isArray(json) ? json : []);
  return list.map((item: any) => ({
    id: pickField(item, ['cod_tipo_atendimento', 'cod_tipo_atentimento', 'id']),
    name: pickField(item, ['nom_tipo_atendimento', 'des_tipo_atendimento', 'nome', 'name']),
  })).filter((o: VetsoftOption) => o.id != null);
}

export async function listTenantUsers(supabase: any): Promise<VetsoftOption[]> {
  const json = await vetsoftJson(supabase, '/tenant-users');
  const list = json?.data || (Array.isArray(json) ? json : []);
  return list.map((item: any) => ({
    id: pickField(item, ['cod_usuario', 'id']),
    name: pickField(item, ['nom_usuario', 'nome', 'name', 'email']),
  })).filter((o: VetsoftOption) => o.id != null);
}

// ── Agenda ───────────────────────────────────────────────────────────────

export interface VetsoftAgendaEvent {
  cod_evento: number;
  [key: string]: any;
}

export async function createAgendaEvent(supabase: any, data: {
  cod_cliente: number;
  cod_animal?: number;
  dat_evento: string; // ISO datetime
  dat_termino: string; // ISO datetime
  des_evento?: string;
  cod_tipo_atentimento?: number;
  cod_usuario_responsavel?: number;
}): Promise<VetsoftAgendaEvent> {
  const json = await vetsoftJson(supabase, '/agenda', {
    method: 'POST',
    body: JSON.stringify({
      tip_evento: 'C',
      is_emergencia: false,
      ...data,
    }),
  });
  return json?.data || json;
}

export async function updateAgendaEvent(supabase: any, codEvento: number, data: Record<string, any>): Promise<void> {
  await vetsoftJson(supabase, `/agenda/${codEvento}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function cancelAgendaEvent(supabase: any, codEvento: number, reason: string): Promise<void> {
  await vetsoftJson(supabase, `/agenda/${codEvento}/cancel`, {
    method: 'POST',
    body: JSON.stringify({ des_motivo_cancelamento: reason || 'Cancelado pelo tutor via WhatsApp' }),
  });
}
