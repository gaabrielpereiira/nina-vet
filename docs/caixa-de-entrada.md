# Caixa de entrada do WhatsApp

A equipe encontra a fila em **Conversas**. A lista mostra conversas com vínculo
confirmado no canal, com busca e filtros de responsabilidade. O histórico tem
anexos recebidos, mensagens antigas e confirmações de entrega. Lista e conversa
se atualizam enquanto a aba está visível.

Com as ações liberadas, **Assumir** atribui a conversa à pessoa autenticada.
A equipe pode responder com texto dentro da janela de atendimento. **Devolver à
fila** libera o responsável e mantém o atendimento humano. A propriedade da
conversa vale dentro da Nina. Um CRM externo pode continuar atendendo por fora.

A reserva de envio acontece no banco antes da chamada ao Zernio. A mesma
operação não dispara outro envio, e o retorno ambíguo pede conferência no
histórico. O eco assinado do WhatsApp registra o envio e o status de entrega.

1. Publicar a API e a interface com as duas flags desligadas.
2. Rodar `node server/scripts/prepare-staff-inbox.mjs` e ensaiar a migração em
   uma transação revertida. Com o ensaio validado, gerar o SQL com `--commit`
   e aplicar como `nina_owner`. Esse SQL instala apenas a permissão de leitura.
3. Ativar `WHATSAPP_INBOX_ENABLED=true`, publicar a API e conferir a fila com
   login de equipe. `WHATSAPP_INBOX_WRITES_ENABLED` continua desligada.
4. Após autorização da equipe, aplicar `server/sql/staff-inbox-write-role.sql`
   como proprietário, ativar `WHATSAPP_INBOX_WRITES_ENABLED=true` e publicar a
   API. Validar a atribuição e a devolução antes de enviar uma mensagem real.
5. Para suspender ações, desligar `WHATSAPP_INBOX_WRITES_ENABLED` e publicar
   a API. O retorno usa uma versão que reconhece a migração 0009.
