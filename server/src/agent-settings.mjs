import { ApiError } from './errors.mjs';

export const agentSettingKeys = Object.freeze(['company_name', 'assistant_name', 'system_prompt', 'timezone',
  'business_hours_start', 'business_hours_end', 'business_days', 'scheduling_policy', 'response_delay_min',
  'response_delay_max', 'message_breaking_enabled', 'audio_response_requested', 'source_scheduling_flag',
  'source_automation_active', 'source_auto_response_enabled', 'source_model_mode', 'source_business_hours_end', 'review_notes']);
const invalid = () => new Error('INVALID_AGENT_SETTINGS');
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(v);
const time = v => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const secrets = /\b(?:sk-[A-Za-z0-9_-]{12,}|re_[A-Za-z0-9_-]{16,}|AIza[A-Za-z0-9_-]{20,}|Bearer\s+[A-Za-z0-9_.-]{12,})|-----BEGIN[^\n]*PRIVATE KEY|(?:api[_ -]?key|senha|password|access[_ -]?token|refresh[_ -]?token)\s*[:=]\s*\S{8,}/i;

export function validateAgentSettings(data) {
  if (!object(data) || Object.keys(data).length !== agentSettingKeys.length || agentSettingKeys.some(k => !Object.hasOwn(data, k)) ||
      !text(data.company_name, 120) || !text(data.assistant_name, 80) || !text(data.system_prompt, 60000) ||
      data.timezone !== 'America/Sao_Paulo' || !time(data.business_hours_start) || !time(data.business_hours_end) ||
      data.business_hours_start >= data.business_hours_end || !time(data.source_business_hours_end) ||
      !Array.isArray(data.business_days) || data.business_days.length < 1 || data.business_days.length > 7 ||
      new Set(data.business_days).size !== data.business_days.length || data.business_days.some(n => !Number.isInteger(n) || n < 0 || n > 6) ||
      data.scheduling_policy !== 'human_only' || !Number.isInteger(data.response_delay_min) || !Number.isInteger(data.response_delay_max) ||
      data.response_delay_min < 0 || data.response_delay_max > 60000 || data.response_delay_min > data.response_delay_max ||
      ['message_breaking_enabled', 'audio_response_requested', 'source_scheduling_flag', 'source_automation_active', 'source_auto_response_enabled'].some(k => typeof data[k] !== 'boolean') ||
      !text(data.source_model_mode, 30) || !Array.isArray(data.review_notes) || data.review_notes.length > 10 || data.review_notes.some(v => !text(v, 500)) ||
      Buffer.byteLength(JSON.stringify(data)) > 131072 || secrets.test(JSON.stringify(data))) throw invalid();
  // No credential field, live automation flag or arbitrary source metadata is retained.
  return Object.fromEntries(agentSettingKeys.map(k => [k, data[k]]));
}

export function createAgentSettings(db, auth) {
  return async request => {
    const { user } = await auth.authenticate(request);
    if (!user.roles.includes('admin')) throw new ApiError(403, 'FORBIDDEN', 'Acesso restrito à administração.');
    if (new URL(request.url).search) throw new ApiError(400, 'INVALID_QUERY', 'Consulta inválida.');
    try {
      const row = await db.transaction(async tx => {
        await tx.query("SELECT set_config('nina.user_id',$1,true)", [user.id]);
        return (await tx.query('SELECT payload,imported_at,payload_sha256 FROM nina_agent.settings WHERE singleton=true'))[0];
      });
      return { configured: Boolean(row), settings: row ? validateAgentSettings(row.payload) : null,
        imported_at: row?.imported_at ?? null, payload_sha256: row?.payload_sha256 ?? null,
        automatic_replies_enabled: false, appointment_actions_enabled: false };
    } catch (error) {
      // New code can be deployed before its additive schema, without changing intake.
      if (error.code === '42P01') return { configured: false, settings: null, imported_at: null, payload_sha256: null,
        automatic_replies_enabled: false, appointment_actions_enabled: false };
      throw new ApiError(503, 'SETTINGS_UNAVAILABLE', 'As configurações da Nina estão temporariamente indisponíveis.');
    }
  };
}
