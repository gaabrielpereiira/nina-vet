// Helper compartilhado: baixa a mídia recebida (URL autenticada da Zernio) e guarda
// no bucket público `audio-messages`, devolvendo a URL pública para o chat exibir.

import { getZernioApiKey } from './zernio.ts';

export const CHAT_MEDIA_BUCKET = 'audio-messages';

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/webm': 'webm',
  'audio/wav': 'wav',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'application/pdf': 'pdf',
};

export function extensionFor(mime: string | null, fallback = 'bin'): string {
  if (!mime) return fallback;
  const clean = mime.split(';')[0].trim().toLowerCase();
  return EXT_BY_MIME[clean] || clean.split('/')[1] || fallback;
}

export async function downloadZernioMedia(
  supabase: any,
  mediaUrl: string,
): Promise<{ buffer: ArrayBuffer; contentType: string } | null> {
  const apiKey = await getZernioApiKey(supabase);
  if (!apiKey) {
    console.error('[media] API Key da Zernio não configurada — mídia não baixada');
    return null;
  }

  try {
    const res = await fetch(mediaUrl, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!res.ok) {
      console.error('[media] Falha ao baixar mídia:', res.status, await res.text());
      return null;
    }
    const contentType = res.headers.get('content-type') || 'application/octet-stream';
    return { buffer: await res.arrayBuffer(), contentType };
  } catch (error) {
    console.error('[media] Erro ao baixar mídia:', error);
    return null;
  }
}

export async function uploadChatMedia(
  supabase: any,
  buffer: ArrayBuffer,
  opts: { conversationId: string; messageId: string; contentType: string; fileName?: string | null },
): Promise<string | null> {
  const ext = extensionFor(opts.contentType);
  const safeName = opts.fileName
    ? opts.fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-60)
    : `${opts.messageId}.${ext}`;
  const path = `inbound/${opts.conversationId}/${opts.messageId}-${safeName}`;

  const { error } = await supabase.storage
    .from(CHAT_MEDIA_BUCKET)
    .upload(path, new Uint8Array(buffer), {
      contentType: opts.contentType,
      upsert: true,
    });

  if (error) {
    console.error('[media] Erro ao salvar mídia no storage:', error);
    return null;
  }

  const { data } = supabase.storage.from(CHAT_MEDIA_BUCKET).getPublicUrl(path);
  return data?.publicUrl || null;
}

/**
 * Baixa a mídia da Zernio, salva no storage e atualiza a mensagem com a URL pública.
 * Retorna o buffer baixado (para reaproveitar em transcrição, por exemplo).
 */
export async function persistIncomingMedia(
  supabase: any,
  args: {
    mediaUrl: string;
    conversationId: string;
    messageId: string;
    fileName?: string | null;
  },
): Promise<{ buffer: ArrayBuffer; contentType: string; publicUrl: string | null } | null> {
  const downloaded = await downloadZernioMedia(supabase, args.mediaUrl);
  if (!downloaded) return null;

  const publicUrl = await uploadChatMedia(supabase, downloaded.buffer, {
    conversationId: args.conversationId,
    messageId: args.messageId,
    contentType: downloaded.contentType,
    fileName: args.fileName,
  });

  if (publicUrl) {
    const { error } = await supabase
      .from('messages')
      .update({ media_url: publicUrl, media_type: downloaded.contentType })
      .eq('id', args.messageId);
    if (error) console.error('[media] Erro ao atualizar mensagem com media_url:', error);
  }

  return { ...downloaded, publicUrl };
}
