
# WhatsApp Coexistência + Pausa Manual da Nina

Objetivo: permitir que o mesmo número do WhatsApp funcione ao mesmo tempo no app WhatsApp Business (celular) e via Cloud API, e quando um atendente responder pelo celular a Nina para de responder naquela conversa até ser reativada manualmente.

## 1. Onboarding: Embedded Signup com Coexistência

Substituir os 3 inputs manuais (Access Token, Phone Number ID, WABA ID) em `StepWhatsApp.tsx` por um botão **"Conectar WhatsApp Business"** que abre o popup oficial da Meta (Facebook Login for Business + WhatsApp Embedded Signup).

- Adicionar SDK do Facebook (`facebook-jssdk`) carregado sob demanda no step.
- Chamar `FB.login` com `config_id` do app Meta e `extras: { setup: { solutionType: "COEXISTENCE" } }` — esse parâmetro é o que ativa o fluxo coexistente (o usuário verá a tela de escanear QR no celular durante o signup).
- Escutar `message` do window para capturar `phone_number_id` e `waba_id` retornados pelo Embedded Signup.
- Nova edge function `whatsapp-embedded-signup` que troca o `code` retornado pelo `access_token` de longa duração usando `App ID` + `App Secret` da Meta (novos secrets: `META_APP_ID`, `META_APP_SECRET`, `META_CONFIG_ID_COEXISTENCE`), assina o webhook automaticamente via Graph API (`POST /{waba_id}/subscribed_apps`) e grava tudo em `nina_settings`.
- Manter os 3 campos manuais como fallback recolhido ("Configuração avançada") para quem já tem token.

## 2. Detecção de resposta humana (message_echoes)

O webhook do WhatsApp já recebe `message_echoes` quando alguém envia pelo app do celular. Hoje `whatsapp-webhook` provavelmente ignora — vamos tratar.

- Em `supabase/functions/whatsapp-webhook/index.ts`:
  - Detectar payloads com `value.messages[].from == phone_number_id` (echo) ou o campo `message_echoes` da subscription.
  - Salvar a mensagem em `messages` com `direction = 'outbound_human'` (novo valor) e `sender = 'human_operator'`.
  - Marcar a conversa correspondente como `ai_paused = true` e gravar `ai_paused_at = now()`, `ai_paused_reason = 'human_reply'`.
- Garantir que a assinatura do webhook inclui o campo `message_echoes` (feito automaticamente no passo 1 via `subscribed_apps`).

## 3. Schema: pausa por conversa

Migration adicionando à tabela `conversations`:
- `ai_paused boolean NOT NULL DEFAULT false`
- `ai_paused_at timestamptz`
- `ai_paused_reason text` (`'human_reply'` | `'manual'`)
- `ai_paused_by uuid` (user que pausou manualmente, nullable)

E um novo valor no enum/campo `direction` de `messages` para `outbound_human` (se hoje é texto livre, só documentar; se é enum, alterar).

## 4. Nina respeita a pausa

Em `supabase/functions/nina-orchestrator/index.ts`, no início do processamento de cada mensagem:
- Buscar `conversations.ai_paused` da conversa.
- Se `true`: pular geração de resposta, marcar a fila como `skipped` com motivo `ai_paused`, e **não** enviar nada pro WhatsApp.
- Log estruturado para aparecer no health-check.

## 5. UI do chat: badge + botão "Reativar IA"

Em `src/components/ChatInterface.tsx`:
- Ler `ai_paused` da conversa ativa (já vem via realtime).
- Quando pausada: mostrar banner no topo do chat — *"Nina pausada — atendimento humano em andamento"* — com botão **"Reativar Nina"**.
- Clicar reativa: `UPDATE conversations SET ai_paused = false, ai_paused_at = null, ai_paused_reason = null WHERE id = ?`.
- Mensagens com `direction = 'outbound_human'` renderizam com estilo diferente das da Nina (ex: badge "Você" em vez de "Nina", cor neutra).

## 6. Secrets necessários

Serão solicitados via `add_secret` depois que o plano for aprovado, com instruções de onde pegar:
- `META_APP_ID` — Meta for Developers → seu app → Configurações → Básico.
- `META_APP_SECRET` — mesma tela (revelar).
- `META_CONFIG_ID_COEXISTENCE` — precisa criar uma "Configuração" no Facebook Login for Business com solução WhatsApp Embedded Signup em modo Coexistência.

## Detalhes técnicos

```text
Fluxo Embedded Signup Coexistência
──────────────────────────────────
[Onboarding UI] --FB.login(config_id, COEXISTENCE)--> [Popup Meta]
                                                              │
                              usuário escaneia QR no celular ─┤
                                                              ▼
[Onboarding UI] <---- code + phone_number_id + waba_id -------┘
        │
        └── POST /functions/whatsapp-embedded-signup { code, phone_number_id, waba_id }
                        │
                        ├─ POST graph.facebook.com/oauth/access_token (code → long-lived token)
                        ├─ POST /{waba_id}/subscribed_apps (assina webhook, inclui message_echoes)
                        └─ UPSERT nina_settings

Fluxo Pausa
───────────
WhatsApp app (celular) ── envia msg ──> Meta ── webhook message_echo ──> whatsapp-webhook
                                                                              │
                                                                              ├─ insert message (direction=outbound_human)
                                                                              └─ UPDATE conversations SET ai_paused=true
nina-orchestrator ── vê ai_paused=true ──> skip
UI ── badge + botão "Reativar" ──> UPDATE ai_paused=false
```

Arquivos afetados:
- `src/components/onboarding/StepWhatsApp.tsx` — botão Embedded Signup + fallback manual recolhido.
- `src/components/ChatInterface.tsx` — banner de pausa + botão reativar + estilo `outbound_human`.
- `supabase/functions/whatsapp-embedded-signup/index.ts` — nova.
- `supabase/functions/whatsapp-webhook/index.ts` — tratar echoes e pausar.
- `supabase/functions/nina-orchestrator/index.ts` — respeitar `ai_paused`.
- Migration: colunas em `conversations` + valor `outbound_human`.

Fora do escopo: coexistência via BSP (só faz sentido se você usar um provider tipo Twilio/360dialog no meio, que não é o caso).
