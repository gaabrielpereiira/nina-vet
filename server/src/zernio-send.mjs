export async function sendZernioText(fetcher, scope, target, message, operationId, log) {
  let status;
  try {
    const response = await fetcher(`https://zernio.com/api/v1/inbox/conversations/${target}/messages`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8000),
      headers: { authorization: `Bearer ${scope.apiKey}`, 'content-type': 'application/json', 'idempotency-key': operationId },
      body: JSON.stringify({ accountId: scope.accountId, message }),
    });
    status = response.status;
    const reader = response.body?.getReader();
    if (!response.ok || !reader) {
      await reader?.cancel();
      return [400,401,403,404,422,429].includes(status) ? { status: 'rejected' } : { status: 'uncertain' };
    }
    const parts = [];
    let length = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        length += value.length;
        if (length > 16384) { await reader.cancel(); return { status: 'uncertain' }; }
        parts.push(Buffer.from(value));
      }
    } finally { reader.releaseLock(); }
    const result = JSON.parse(Buffer.concat(parts).toString('utf8'));
    if (result.success === true && result.data?.conversationId === target &&
      typeof result.data?.messageId === 'string' && /^wamid\.[\w+/=-]{1,500}$/.test(result.data.messageId)) return { status: 'accepted', providerId: result.data.messageId };
  } catch {
    log({ event: 'whatsapp_send_uncertain', http_status: status ?? null });
  }
  return { status: 'uncertain' };
}
