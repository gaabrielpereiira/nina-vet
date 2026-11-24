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

## Chat (migração 0010)

A tela **Conversas** funciona como um WhatsApp da equipe: lista à esquerda,
conversa ao centro e dados do tutor à direita. A lista atualiza a cada 4 s e a
conversa aberta a cada 3 s, enquanto a aba está visível.

- **Não lidas:** a posição de leitura é de cada pessoa. Uma resposta da clínica
  zera o contador para todos. Mensagens com mais de 7 dias não contam. O número
  no menu soma conversas próprias e sem responsável.
- **Assumir ao responder:** enviar numa conversa sem responsável a atribui a quem
  enviou. Conversas de outra pessoa ficam só para leitura.
- **Histórico imediato:** a resposta aceita entra no histórico junto com a
  confirmação do envio. O eco assinado encontra o mesmo ID e não duplica.
- **Fila de envio:** uma mensagem por vez em cada conversa. Queda de conexão
  repete a mesma operação, que o servidor nunca envia duas vezes. Envio sem
  confirmação não oferece reenvio. A fila e os rascunhos resistem à troca de
  página, mas não a recarregar ou fechar a aba.
- **Processador:** esvazia a fila sem pausa entre eventos e descansa 2 s vazio.

O envio é só de texto (até 4.000 caracteres), dentro da janela do WhatsApp.
Segundo a documentação do provedor, há limite de cerca de 10 mensagens por
minuto para o mesmo contato; o excesso aparece como recusado.

### Publicação

O `HEALTHCHECK` da API usa `/readyz`. A falta da 0010 ou de permissões desliga só
o chat (some ou fica em modo de consulta); login, cadastros e agenda continuam.
A API **anterior** a esta etapa recusa a 0010 no `/readyz`, por isso a ordem importa.

1. Fazer backup e conferir em `nina-db`, somente leitura:
   `SELECT version FROM nina_meta.schema_migrations ORDER BY version;`
   O chat exige as nove primeiras. Se a 0009 faltar, seguir antes o roteiro acima.
2. Publicar a **API**, depois a **interface**. Conferir `/readyz`, login, cadastros
   e agenda. O chat aparece como "em preparação".
3. `prepare-chat.mjs` gera o ensaio (termina em ROLLBACK). Validado, gerar com
   `--commit` e aplicar como `nina_owner`. Com `WHATSAPP_INBOX_ENABLED=true`, a
   leitura aparece sem reiniciar a API. Manter `WHATSAPP_INBOX_WRITES_ENABLED=false`.
4. Conferir a leitura com a equipe e comparar algumas conversas com o celular.
5. **Antes de liberar o envio:** colocar a Nina antiga em "Somente humanos" e
   combinar com a equipe que só um sistema responde. O webhook antigo ignora
   mensagens enviadas por API, portanto não pausa a automação quando alguém
   responde por aqui e não mostra essas respostas no CRM antigo.
6. `prepare-chat.mjs --write` (ensaio e depois `--commit`), ligar
   `WHATSAPP_INBOX_WRITES_ENABLED=true` e publicar a API. Começar por **uma**
   conversa com um número da própria clínica e conferir no aparelho.

Para fechar o envio na hora: desligar `WHATSAPP_INBOX_WRITES_ENABLED` e publicar a
API, ou aplicar `prepare-chat.mjs --revoke --commit`, que vale sem publicar.
Para tirar o chat do ar: `WHATSAPP_INBOX_ENABLED=false`, sem mexer no banco.

Só para voltar ao código anterior, nesta ordem: desligar
`WHATSAPP_INBOX_WRITES_ENABLED` (a versão antiga falha no `/readyz` se o envio foi
bloqueado por `--revoke`), aplicar `--rollback --commit` e então publicar a versão
antiga. O retorno apaga apenas as posições de leitura; mensagens e envios ficam.

### Ambiente local

`bash server/scripts/dev-local/reset.sh` recria banco, usuários e conversas
fictícias. `server/scripts/dev-local/api.mjs` roda a API com o WhatsApp simulado,
sem rede externa. Para um tutor fictício escrever:
`node --env-file=server/.env server/scripts/dev-local/tutor.mjs mariana "Oi"`.
Textos com `#falha`, `#incerto` e `#lento` simulam problemas de envio; mensagens
terminadas em `?` recebem resposta.
