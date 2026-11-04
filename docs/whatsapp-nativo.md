# WhatsApp na VPS — preparação do recebimento

## Estado em 03/11/2026

A chave restrita `Nina VPS` foi criada e salva pelo usuário no ambiente da
`nina-api`. A API foi republicada a partir de `61d800c` e uma consulta real,
somente de leitura, confirmou a conta WhatsApp conectada, o perfil esperado e
a autenticação no Zernio. O agente não leu o valor da chave.

O recebedor desta branch é uma preparação **ainda não publicada nem ativada**.
A produção continua em `codex/postgres-backend`; os autodeploys estão desligados.
Nenhuma assinatura de webhook foi alterada, nenhum envio foi feito pelo novo
backend e nenhuma permissão da migração 0005 foi aplicada na VPS.

O painel do provedor registra mensagens recebidas e enviadas em 03/11. O usuário
confirmou atendimento pela equipe ou outro CRM. A assinatura `CRM Inbox` deve
ser preservada. Há também uma assinatura ativa apontando à Nina antiga: seu
papel precisa ser conferido antes da virada. A cópia de 22/10 não cobre todo o
histórico atual; sincronizar o intervalo posterior, com deduplicação, antes de
aposentar a origem. Conferimos somente metadados, sem abrir mensagens.

## Contrato do recebedor

`POST /v1/webhooks/zernio` recebe JSON de até 64 KiB. É a única exceção exata à
exigência de Origin nos POSTs da API. O HMAC-SHA256 deve corresponder aos bytes
originais do corpo, comparado em tempo constante pelo header
`X-Zernio-Signature`. Ausência ou assinatura inválida falha antes de acessar o
banco. Compressão não suportada é recusada; CORS e demais POSTs mantêm a origem
exata existente. O recurso vem desligado por padrão e não inicia se habilitado
com configuração incompleta.

O escopo é verificado em `account.accountId` e `account.profileId` assinados.
Aliases e `profiles`, se presentes, precisam concordar. Somente WhatsApp e os
eventos `message.received`, `message.sent`, `message.delivered`, `message.read`
e `message.failed` entram na fila. `webhook.test` e amostras `test:true` recebem
confirmação sem guardar conteúdo; eventos não tratados são ignorados. O worker
futuro deverá validar os campos específicos de cada evento antes de executar
qualquer ação clínica.

O UUID do evento **dentro do corpo assinado** é a chave de deduplicação por conta.
Os headers de tipo/ID não são assinados e não controlam a fila. Uma repetição
idêntica recebe `duplicate`; o mesmo ID com conteúdo diferente recebe 409.
Não há corte de idade pelo timestamp: retries/redeliveries legítimos mantêm a
data original no contrato do provedor. Os recibos devem ser preservados; apagar
recibos durante uma futura política de retenção reabre a possibilidade de replay.

## Persistência, acesso e limites

A migração `0005_zernio_inbox.sql` cria apenas `nina_channels.zernio_inbox`.
O corpo é criptografado com AES-256-GCM e IV aleatório por evento; AAD vincula
conta, evento e linha. Uma subchave de 32 bytes é derivada da raiz já existente
`EMAIL_ENCRYPTION_KEY` por HKDF-SHA256 com salt `nina-channels-v1` e info
`zernio-inbox-payload`. Ela é diferente da chave usada na fila de e-mail e do
segredo de assinatura compartilhado com Zernio. Fazer backup seguro da raiz;
qualquer rotação exige recriptografar as duas filas ou preservá-la para leitura
das entradas antigas. Desligar e-mail não dispensa essa raiz do recebedor.

`zernio-inbox-role.sql` concede à `nina_app` somente INSERT nas colunas de
recepção e SELECT em conta/ID/digest para deduplicação e contagem. Não concede
leitura do ciphertext, UPDATE, DELETE, TRUNCATE ou acesso clínico adicional.
RLS usa o contexto da conta definido somente dentro da transação após HMAC e
validação do escopo. O contexto expira na transação. O dono de manutenção
permanece fora da RLS para backups; a API recusa credenciais de dono/BYPASSRLS.
Esse contexto não é autenticação independente: o processo da API é confiável
para defini-lo, assim como já ocorre com o contexto das sessões clínicas.

Há no máximo 5.000 entradas por conta nesta etapa. Uma trava transacional curta
coordena a verificação de duplicata, capacidade e INSERT entre instâncias.
No máximo duas transações de recebimento rodam ao mesmo tempo por processo;
sob pressão, falta de trava, fila cheia ou falha de persistência a API responde
503 com Retry-After, sem confirmar um evento perdido. A resposta `queued` só é
enviada depois do commit. SQL usa parâmetros e limites de espera. Logs não
incluem corpo, telefone, assinatura, IDs de conta/evento ou segredos.

**Esta fila não processa atendimentos.** Não chama IA, não responde WhatsApp,
não altera contatos/conversas/mensagens e não baixa mídias. Os anexos WhatsApp
apontam para download autenticado com retenção limitada no provedor: guardar o
evento não equivale a guardar os arquivos. Não desligar a origem nem assumir
que a mídia foi migrada com base neste estágio. Ativar uma cópia passiva somente
com prazo acompanhado e plano para processar/esvaziar a fila antes de lotar.

## Publicação coordenada — pendente

1. Revisar o commit da branch `codex/zernio-receiver` e obter aprovação para as
   novas permissões de recepção. Preservar a configuração dos dois aplicativos
   e o commit de produção, com autodeploy desligado.
2. Publicar primeiro apenas a API com `ZERNIO_WEBHOOK_ENABLED=false` (ou ausente).
   O readiness aceita a migração 0005 ausente somente nesse modo; as quatro
   migrações atuais continuam obrigatórias e com checksum exato. Histórico
   desconhecido ou divergente falha. Assim a preparação pode ser publicada
   antes de criar a fila, sem interromper login/edição e sem ampliar permissões.
3. Fazer backup completo validado e aplicar as migrações como dono, pelo runner
   com checksum (não colar apenas o SQL sem registrar o histórico). Aplicar
   `server/sql/zernio-inbox-role.sql` separadamente. Repetir testes sintéticos
   e de privilégios no PostgreSQL 17 da VPS, com rollback dos dados de ensaio.
   Conferir `/readyz`, login, edição clínica e o recebedor recusando chamadas.
   Frontend não muda.
4. O usuário cria um segredo aleatório de assinatura (mínimo 32 caracteres),
   guarda-o com segurança e configura `ZERNIO_WEBHOOK_SECRET` diretamente no
   Dokploy e no formulário do Zernio; nunca pelo chat/Git. Não reutilizar a
   API key nem a raiz de criptografia. Preencher os IDs privados da conta e do
   perfil em `ZERNIO_ACCOUNT_ID` e `ZERNIO_PROFILE_ID`, só no servidor.
5. Com aprovação da recepção passiva, habilitar o flag e criar uma assinatura
   **nova e limitada à conta e perfil corretos**, apontando para
   `https://api.nina.sharkassessoria.tech/v1/webhooks/zernio`. Preservar CRM e
   assinaturas anteriores. Começar pelo teste sintético do próprio provedor;
   não habilitar IA ou envios como parte desta publicação.
6. Só então verificar um evento de ensaio autorizado, duplicação, criptografia,
   contagem e latência. Acompanhar ocupação e falhas. O processamento, o arquivo
   de mídias e a sincronização do histórico recente têm de estar concluídos
   antes da virada definitiva e desativação de qualquer origem.

Rollback funcional: desabilitar/pausar somente a assinatura nova e desligar o
flag mantendo esta versão da API, que aceita quatro ou cinco migrações nesse
modo. A migração é aditiva; não apagar a fila ou desfazer o histórico. Não voltar
diretamente ao commit `61d800c` após aplicar a quinta: seu `/readyz` rejeita
histórico mais novo. Guardar backup e imagem da versão compatível com recepção
desligada. Essa é a base de retorno antes de habilitar qualquer callback.

## Verificação local

`npm test` cobre assinatura/bytes reais, adulteração, limite de corpo com e sem
Content-Length, HTTP real com chunked transfer, JSON inválido, escopo, amostras,
repetições entre instâncias, conflito de ID, criptografia/AAD/adulteração, RLS,
permissões por coluna, falha de persistência/trava, pressão e fila cheia. As
demais rotas continuam na suíte de regressão. A implementação não acrescenta
dependências de produção. O banco local é PGlite; a concorrência entre conexões
e o ambiente PostgreSQL 17 completo precisam da conferência da VPS antes da
ativação. O PostgreSQL local instalado não iniciou por restrição do ambiente.

Referências primárias consultadas em 03/11/2026:
[assinatura, deduplicação, escopo e retries](https://docs.zernio.com/webhooks),
[eventos e retenção das mídias](https://docs.zernio.com/webhooks/inbox),
[HKDF e AES-GCM](https://nodejs.org/api/crypto.html),
[RLS no PostgreSQL 17](https://www.postgresql.org/docs/17/ddl-rowsecurity.html).
