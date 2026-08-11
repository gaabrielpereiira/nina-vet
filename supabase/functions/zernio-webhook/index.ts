// Edge function: recebe os webhooks da Zernio (substitui o antigo whatsapp-webhook,
// que recebia direto da Meta). A Meta agora fala com a Zernio; a Zernio nos avisa aqui.
//
// Eventos tratados:
//   - account.connected / account.disconnected -> persiste status da conexão em nina_settings
//   - message.received                          -> mesma pipeline de sempre (contacts/conversations/
//                                                    messages/message_grouping_queue -> message-grouper)
//   - message.sent (source=whatsapp_business_app) -> equivalente ao antigo "message_echoes":
//                                                    operador respondeu pelo app do celular
//                                                    (Coexistência) -> salva como humano e pausa a Nina
//
// Segurança: valida X-Zernio-Signature (HMAC-SHA256 do corpo bruto) com ZERNIO_WEBHOOK_SECRET.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

declare const EdgeRuntime: {
  waitUntil(promise: Promise<any>): void;
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-zernio-signature, x-zernio-event-id',
};

const GROUPING_DELAY_MS = 10000; // 10 segundos, igual ao pipeline antigo

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const rawBody = await req.text();

    const secret = Deno.env.get('ZERNIO_WEBHOOK_SECRET');
    if (secret) {
      const signature = req.headers.get('x-zernio-signature');
      const valid = await verifySignature(rawBody, signature, secret);
      if (!valid) {
        console.error('[zernio-webhook] Assinatura inválida');
        return new Response('Invalid signature', { status: 400, headers: corsHeaders });
      }
    }

    const payload = JSON.parse(rawBody);
    const event: string = payload.event;
    console.log('[zernio-webhook] Evento recebido:', event, payload.id);

    switch (event) {
      case 'account.connected':
        await handleAccountConnected(supabase, payload);
        break;
      case 'account.disconnected':
        await handleAccountDisconnected(supabase, payload);
        break;
      case 'message.received':
        await handleMessageReceived(supabase, supabaseUrl, supabaseServiceKey, payload);
        break;
      case 'message.sent':
        await handleMessageSent(supabase, payload);
        break;
      default:
        console.log('[zernio-webhook] Evento ignorado:', event);
    }

    return json({ status: 'processed' });
  } catch (error) {
    console.error('[zernio-webhook] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function verifySignature(rawBody: string, signature: string | null, secret: string): Promise<boolean> {
  if (!signature) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sigBuffer = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  const computed = Array.from(new Uint8Array(sigBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return timingSafeEqual(computed, signature);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

async function handleAccountConnected(supabase: any, payload: any) {
  const account = payload.account;
  if (!account || account.platform !== 'whatsapp') return;

  const { data: settings } = await supabase
    .from('nina_settings')
    .select('id')
    .eq('zernio_profile_id', account.profileId)
    .maybeSingle();

  if (!settings) {
    console.warn('[zernio-webhook] account.connected para profile desconhecido:', account.profileId);
    return;
  }

  await supabase
    .from('nina_settings')
    .update({
      zernio_account_id: account.accountId,
      zernio_display_phone_number: account.username || null,
      zernio_display_name: account.displayName || null,
      zernio_connected_at: new Date().toISOString(),
      zernio_disconnected_at: null,
      zernio_disconnect_reason: null,
    })
    .eq('id', settings.id);

  console.log('[zernio-webhook] Conta WhatsApp conectada:', account.accountId);
}

async function handleAccountDisconnected(supabase: any, payload: any) {
  const account = payload.account;
  if (!account || account.platform !== 'whatsapp') return;

  const { data: settings } = await supabase
    .from('nina_settings')
    .select('id')
    .eq('zernio_account_id', account.accountId)
    .maybeSingle();

  if (!settings) return;

  await supabase
    .from('nina_settings')
    .update({
      zernio_disconnected_at: new Date().toISOString(),
      zernio_disconnect_reason: account.reason || account.disconnectionType || 'desconhecido',
    })
    .eq('id', settings.id);

  console.log('[zernio-webhook] Conta WhatsApp desconectada:', account.accountId, account.reason);
}

async function handleMessageReceived(supabase: any, supabaseUrl: string, supabaseServiceKey: string, payload: any) {
  const message = payload.message;
  const conversationCtx = payload.conversation;
  const accountCtx = payload.account;
  if (!message || message.platform !== 'whatsapp') return;
  if (message.direction !== 'incoming') return;

  const phoneNumber = normalizePhone(message.sender?.phoneNumber) || message.sender?.id;
  if (!phoneNumber) {
    console.warn('[zernio-webhook] message.received sem telefone do remetente, ignorando');
    return;
  }

  // 1. Contato
  let { data: contact } = await supabase
    .from('contacts')
    .select('*')
    .eq('phone_number', phoneNumber)
    .maybeSingle();

  if (!contact) {
    const { data: newContact, error: contactError } = await supabase
      .from('contacts')
      .insert({
        phone_number: phoneNumber,
        whatsapp_id: phoneNumber,
        name: message.sender?.name || null,
        call_name: message.sender?.name?.split(' ')[0] || null,
        user_id: null,
      })
      .select()
      .single();

    if (contactError) {
      console.error('[zernio-webhook] Erro ao criar contato:', contactError);
      return;
    }
    contact = newContact;
  } else {
    const updates: any = { last_activity: new Date().toISOString() };
    if (message.sender?.name && !contact.name) {
      updates.name = message.sender.name;
      updates.call_name = message.sender.name.split(' ')[0];
    }
    await supabase.from('contacts').update(updates).eq('id', contact.id);
  }

  // 2. Conversa
  let { data: conversation } = await supabase
    .from('conversations')
    .select('*')
    .eq('contact_id', contact.id)
    .eq('is_active', true)
    .maybeSingle();

  if (!conversation) {
    const { data: newConversation, error: convError } = await supabase
      .from('conversations')
      .insert({
        contact_id: contact.id,
        status: 'nina',
        is_active: true,
        user_id: null,
        zernio_conversation_id: conversationCtx?.id || message.conversationId || null,
      })
      .select()
      .single();

    if (convError) {
      console.error('[zernio-webhook] Erro ao criar conversa:', convError);
      return;
    }
    conversation = newConversation;
  } else if (!conversation.zernio_conversation_id && (conversationCtx?.id || message.conversationId)) {
    await supabase
      .from('conversations')
      .update({ zernio_conversation_id: conversationCtx?.id || message.conversationId })
      .eq('id', conversation.id);
  }

  // 3. Conteúdo / tipo
  const attachment = message.attachments?.[0];
  const { content, type, mediaType } = mapContent(message.text, attachment);

  // 4. Mensagem (cria imediatamente, igual ao pipeline antigo)
  const { data: dbMessage, error: msgError } = await supabase
    .from('messages')
    .insert({
      conversation_id: conversation.id,
      whatsapp_message_id: message.platformMessageId,
      content,
      type,
      from_type: 'user',
      status: 'sent',
      media_type: mediaType,
      sent_at: message.sentAt || new Date().toISOString(),
      metadata: {
        original_type: attachment?.type || 'text',
        media_url: attachment?.url || null,
      },
    })
    .select()
    .single();

  if (msgError) {
    if (msgError.code === '23505') {
      console.log('[zernio-webhook] Mensagem duplicada ignorada:', message.platformMessageId);
      return;
    }
    console.error('[zernio-webhook] Erro ao criar mensagem:', msgError);
    return;
  }

  await supabase
    .from('conversations')
    .update({ last_message_at: new Date().toISOString() })
    .eq('id', conversation.id);

  // 5. Fila de agrupamento — mantém o mesmo formato "estilo Meta" que o message-grouper já entende
  const zernioAccountId = accountCtx?.accountId || accountCtx?.id;
  const processAfter = new Date(Date.now() + GROUPING_DELAY_MS).toISOString();
  const unixSeconds = message.sentAt ? String(Math.floor(new Date(message.sentAt).getTime() / 1000)) : String(Math.floor(Date.now() / 1000));

  const syntheticMessage: Record<string, any> = {
    id: message.platformMessageId,
    from: phoneNumber,
    timestamp: unixSeconds,
    type,
  };
  if (type === 'text') syntheticMessage.text = { body: message.text || '' };
  if (type === 'image') syntheticMessage.image = { caption: message.text || undefined, id: attachment?.url };
  if (type === 'audio') syntheticMessage.audio = { id: attachment?.url };
  if (type === 'video') syntheticMessage.video = { caption: message.text || undefined, id: attachment?.url };
  if (type === 'document') syntheticMessage.document = { filename: attachment?.payload?.filename || 'documento', id: attachment?.url };

  await supabase
    .from('message_grouping_queue')
    .update({ process_after: processAfter })
    .eq('processed', false)
    .eq('phone_number_id', zernioAccountId)
    .filter('message_data->>from', 'eq', phoneNumber);

  const { error: queueError } = await supabase
    .from('message_grouping_queue')
    .insert({
      whatsapp_message_id: message.platformMessageId,
      phone_number_id: zernioAccountId,
      message_id: dbMessage.id,
      message_data: syntheticMessage,
      contacts_data: { wa_id: phoneNumber, profile: { name: message.sender?.name || null } },
      process_after: processAfter,
    });

  if (queueError && queueError.code !== '23505') {
    console.error('[zernio-webhook] Erro ao enfileirar:', queueError);
  }

  EdgeRuntime.waitUntil(
    fetch(`${supabaseUrl}/functions/v1/message-grouper`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseServiceKey}`,
      },
      body: JSON.stringify({ triggered_by: 'zernio-webhook' }),
    }).catch((err) => console.error('[zernio-webhook] Erro ao disparar message-grouper:', err)),
  );
}

// Mensagem enviada pelo app do WhatsApp Business no celular (Coexistência).
// Equivalente ao antigo `message_echoes` do webhook direto da Meta.
async function handleMessageSent(supabase: any, payload: any) {
  const message = payload.message;
  const conversationCtx = payload.conversation;
  if (!message || message.platform !== 'whatsapp') return;
  if (message.source !== 'whatsapp_business_app') return; // ignora envios feitos pela própria Nina/API

  const clientPhone = normalizePhone(conversationCtx?.participantId) || conversationCtx?.participantId;
  if (!clientPhone) {
    console.warn('[zernio-webhook] message.sent (coexistência) sem telefone do cliente, ignorando');
    return;
  }

  const { data: contact } = await supabase
    .from('contacts')
    .select('id')
    .eq('phone_number', clientPhone)
    .maybeSingle();
  if (!contact) {
    console.warn('[zernio-webhook] Echo para contato desconhecido:', clientPhone);
    return;
  }

  const { data: conversation } = await supabase
    .from('conversations')
    .select('id')
    .eq('contact_id', contact.id)
    .eq('is_active', true)
    .maybeSingle();
  if (!conversation) return;

  const attachment = message.attachments?.[0];
  const { content, type } = mapContent(message.text, attachment, true);

  const { error: echoMsgErr } = await supabase.from('messages').insert({
    conversation_id: conversation.id,
    whatsapp_message_id: message.platformMessageId,
    content,
    type,
    from_type: 'human',
    status: 'sent',
    sent_at: message.sentAt || new Date().toISOString(),
    metadata: { source: 'whatsapp_app_echo' },
  });
  if (echoMsgErr && echoMsgErr.code !== '23505') {
    console.error('[zernio-webhook] Erro ao salvar echo:', echoMsgErr);
  }

  await supabase
    .from('conversations')
    .update({
      ai_paused: true,
      ai_paused_at: new Date().toISOString(),
      ai_paused_reason: 'human_reply',
      status: 'human',
      last_message_at: new Date().toISOString(),
    })
    .eq('id', conversation.id);

  console.log('[zernio-webhook] Nina pausada (resposta pelo app) na conversa:', conversation.id);
}

function mapContent(text: string | null | undefined, attachment: any, isEcho = false) {
  if (!attachment) {
    return { content: text || '', type: 'text', mediaType: null };
  }
  const labels: Record<string, string> = isEcho
    ? { image: '[imagem enviada]', audio: '[áudio enviado]', video: '[vídeo enviado]', file: '[documento enviado]', sticker: '[figurinha enviada]' }
    : { image: '[imagem recebida]', audio: '[áudio - processando transcrição...]', video: '[vídeo recebido]', file: '[documento recebido]', sticker: '[figurinha recebida]' };

  const type = attachment.type === 'file' ? 'document' : attachment.type;
  const content = attachment.type === 'image' ? (text || labels.image) : (text || labels[attachment.type] || `[${attachment.type}]`);
  const mediaType = ['image', 'audio', 'video', 'document'].includes(type) ? type : null;
  return { content, type, mediaType };
}

function normalizePhone(phoneNumber: string | null | undefined): string | null {
  if (!phoneNumber) return null;
  return phoneNumber.startsWith('+') ? phoneNumber.slice(1) : phoneNumber;
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
