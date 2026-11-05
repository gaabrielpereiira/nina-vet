# Configurações da Nina no PostgreSQL nativo

A página administrativa `/nina/configuracoes` recupera as instruções e preferências
operacionais do backup de 04/11. É somente leitura nesta etapa. A API
`GET /v1/agent/settings` exige conta administrativa ativa, rejeita parâmetros e
não recebe nem altera configurações pelo navegador. RLS também restringe a leitura
à identidade administrativa na transação; equipe comum e sessão ausente não leem.

O schema `nina_agent` tem um único registro de configuração. O papel limitado
`nina_app` recebe somente USAGE e SELECT nessa tabela, sem escrita ou criação de
objetos. Não há novo usuário, credencial ou papel de execução. O payload admite
somente 18 campos de negócio. A extração ignora tokens, chaves, senhas, telefones
de teste e credenciais do VetSoft; o validador também rejeita nomes de campos
inesperados e padrões de credenciais dentro do texto. Dados reais ficam fora do
Git e das imagens Docker. O importador registra hashes do snapshot e do payload.

A configuração preserva integralmente o texto original para revisão. O horário
estruturado foi corrigido para 08h–22h, segunda a sábado, conforme confirmação de
Gabriel em 05/11. O valor antigo de 23h é mantido somente como referência histórica.
Domingo permanece apenas com hora marcada pela equipe. A regra central do texto
é encaminhar todos os agendamentos, alterações e cancelamentos para humanos.
Essa regra prevalece sobre a opção legada de agendamento por IA, que também fica
registrada para revisão. A automação da origem estava desligada no snapshot.

A leitura dessa página não aciona o Gemini, agenda, notificações, VetSoft ou
WhatsApp. As capacidades efetivas de responder automaticamente e agir na agenda
são explicitamente falsas. Os ensaios com dados fictícios permanecem separados.
Ainda é necessário validar regras e integrações antes de conectar conversas reais.
O texto antigo inclui gatilhos e notificações ainda em migração; sua preservação
não significa que essas ações já estejam implementadas na VPS.

## Publicação em etapas

1. Validar testes, tipos e build. Publicar primeiro a API com a migração 0007
   opcional no readiness, mantendo compatibilidade com as seis versões anteriores.
2. Fazer backup nativo e conferir leitura integral.
3. Preparar SQL pelo `server/scripts/prepare-agent-settings.mjs`, passando somente
   o JSON privado permitido e o SHA-256 esperado do snapshot. O código não se
   conecta ao banco nem executa o dump original. O destino deve ser `nina`, owner
   `nina_owner`, com os seis checksums esperados e sem schema `nina_agent` existente.
4. Executar o ensaio com ROLLBACK: schema, grants mínimos, payload e leitura pelo
   papel limitado são conferidos dentro da transação. Verificar reversão completa.
5. Executar o mesmo núcleo com COMMIT. O importador bloqueia reaplicação, novas
   identidades não são criadas e tabelas clínicas não são alteradas.
6. Publicar a interface, conferir conteúdo pela conta administrativa e verificar
   novamente readiness, rejeição anônima e fila passiva do WhatsApp.

O importador é uma ferramenta de manutenção. Seus arquivos com dados reais e SQL
ficam em diretório privado, fora do repositório. Backups e origem são preservados.
Para uma nova instalação, `api:migrate` aplica os schemas; o arquivo de grants
`server/sql/agent-settings-role.sql` permanece uma etapa explícita do owner.

A compatibilidade dos operadores de mídia e de ativação do canal foi ajustada
para reconhecer a nova versão conhecida sem aceitar migrações desconhecidas nem
modificar os arquivos de migração anteriores. A ativação histórica do canal ainda
instala apenas a versão 0006 e mantém a configuração 0007 para uma etapa própria.

## Resultado em 05/11/2026

API e interface publicadas no commit
`967cbf34b754ebb3131fe9561eec9940499ad682`, mantendo os autodeploys desligados.
A suíte passou com 224 testes, typecheck e build. O backup nativo anterior à
importação tem 32.049.727 bytes, modo 600 e leitura integral pelo pg_restore
conferida. O ensaio real no PostgreSQL terminou em ROLLBACK, voltando às seis
migrações e sem schema `nina_agent`. O mesmo núcleo terminou depois em COMMIT.
A versão 0007 está aplicada e há um registro de configuração. Não reaplicar o
SQL preparado; o guard rejeita um banco com a nova versão já instalada.

O texto original tem 20.981 bytes e SHA-256
`a4554036b38c3873261300ed753cf0662e914847c36380b47eb0bd5ee0742266`.
Esse digest foi conferido na extração, no PostgreSQL e no campo somente leitura
da interface administrativa real. Os horários e a política humana foram
conferidos na tela. A leitura pelo papel limitado com uma identidade real da
equipe sem administração retornou zero registros; o papel não pode inserir,
alterar, excluir ou criar objetos. A identidade anônima também não leu a linha.
`healthz`/`readyz` retornaram 200 e o endpoint de configuração sem login, 401.

A conferência do canal mostrou recebimento e registro ligados, arquivos privados
disponíveis, zero eventos aguardando/em processamento e um evento que precisa
de conferência (976 processados naquele checkpoint). O evento é `message.sent`,
recebido às 18:32 UTC de 05/11, antes desta publicação, com
`CHANNEL_AMBIGUOUS_CONVERSATION`. O corpo permanece criptografado e não foi lido,
reprocessado ou marcado como concluído; nenhum vínculo foi escolhido por
aproximação. A associação precisa ser diagnosticada com evidência antes de uma
ativação futura. O atendimento da equipe/CRM segue preservado.

As credenciais e a integração nativa com VetSoft, notificações, áudio e contexto
real ainda não foram ativadas por esta entrega. Nenhum dado real foi enviado ao
Gemini e nenhuma mensagem foi enviada ao WhatsApp nesta etapa. O sistema antigo
e os backups continuam preservados.
