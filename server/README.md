# Nina API — base de migração

Esta pasta contém a primeira parte do backend próprio, sem dependências do
Supabase ou do Lovable. **Ainda não substitui o sistema em produção.**
A interface nativa de consulta já está na VPS e usa esta API. O código legado
permanece fora do ponto de entrada. Arquivos, tempo real e integrações ainda
precisam ser portados; a migração completa continua em andamento.

## Implementado nesta etapa

- Consultas de contatos, animais, procedimentos, agenda e histórico de mensagens
  com sessão nativa, RLS e paginação. A etapa de escrita acrescenta permissões
  por coluna, revisão e recibos de operações; sua ativação é coordenada.
- Migração 0003 e preparador privado da importação das seis tabelas; filas e
  credenciais de integração não são copiadas. Consulte
  [a aplicação coordenada](../docs/migracao-historico.md) antes de implantar.

- Criação e edição clínica, com validação, revisão, idempotência e auditoria.
  Procedimentos exigem administrador. Nenhuma rota exclui registros. Veja
  [a ativação da gravação](../docs/edicao-nativa.md).

- API HTTP em Node.js, porta padrão 3000, com processo sem privilégios no Docker.
- Pool limitado de conexões PostgreSQL, consultas parametrizadas e timeout.
- Migrações próprias transacionais com trava e verificação de checksum.
- Login por e-mail/senha com scrypt e limites de tentativas persistidos no banco.
- Compatibilidade com bcrypt de custo 10 das contas antigas, sem truncar
  senhas acima de 72 bytes; senhas novas e recuperadas continuam em scrypt.
- Sessões opacas revogáveis: somente o hash fica no banco; cookie HttpOnly,
  Secure e restrito ao host em produção. Nenhum token no localStorage.
- Consulta do usuário e das funções atuais a cada autenticação, bloqueando
  sessões de contas desabilitadas ou sem função de acesso.
- Proteção por origem exata em operações POST, incluindo outros subdomínios.
- Encerramento da sessão atual ou de todas as sessões do usuário.
- Credencial de execução com acesso limitado e separada da credencial de DDL.
- Recuperação de senha por Resend, com link de uso único válido por 20 minutos,
  revogação de sessões e fila persistente cujo conteúdo é criptografado.
- Worker com leases, tentativas limitadas e chave de idempotência por mensagem.

Os schemas `nina_auth`, `nina_meta` e `nina_mail` são próprios. Não reutilizam os schemas
`auth`/`storage`, funções ou políticas de acesso da plataforma anterior.
`admin`/`user` preservam a distinção das funções globais; as permissões de
`manager`/`agent` da equipe ainda precisam ser portadas nas rotas de negócio.

## Endpoints existentes

| Método | Caminho | Comportamento |
| --- | --- | --- |
| GET | `/healthz` | Processo HTTP responde; não indica prontidão funcional |
| GET | `/readyz` | Verifica credencial limitada e versão das migrações; 503 se indisponível |
| POST | `/v1/auth/login` | JSON `{ "email": "...", "password": "..." }`, cria cookie |
| GET | `/v1/auth/session` | Usuário/roles/expiração da sessão; 401 sem sessão válida |
| POST | `/v1/auth/logout` | Revoga a sessão atual |
| POST | `/v1/auth/logout-all` | Revoga todas as sessões do próprio usuário |
| POST | `/v1/auth/forgot-password` | JSON com e-mail; resposta genérica 202 e enfileiramento para conta ativa |
| POST | `/v1/auth/reset-password` | JSON com token e nova senha; consumo único e revogação de todas as sessões |

As chamadas do navegador devem incluir `credentials: 'include'`. POSTs precisam
do cabeçalho Origin igual ao `FRONTEND_ORIGIN`; login exige JSON. Não existem
cadastro público, endpoint SQL genérico ou administrador criado automaticamente.
O limite padrão é de 10 tentativas por e-mail e 200 globais por janela de 15
minutos, incluindo tentativas bem-sucedidas. Hashing simultâneo limitado a dois.
Cada conta pode manter até 10 sessões, com duração padrão de oito horas.

## Recuperação e envio de e-mails

O envio fica desligado por padrão (`EMAIL_ENABLED=false`). Antes de ativar,
concluir a migração da tela `/auth/set-password` para a API própria, aplicar as
duas migrações, preparar os grants do papel limitado e validar a entrega com
um destinatário autorizado. A tela nativa já usa a API própria; a entrega real ainda precisa de validação.

Para ativar depois, o processo HTTP precisa de `EMAIL_ENABLED=true`,
`RESEND_API_KEY`, `EMAIL_FROM` e `EMAIL_ENCRYPTION_KEY` (32 bytes aleatórios,
codificados como 64 caracteres hexadecimais). A chave de criptografia é separada
da chave Resend, não deve entrar no Git/chat e precisa de backup seguro.
Não rotacioná-la com mensagens pendentes sem drenar/inutilizar a fila antiga.

O pedido grava somente o hash do token na tabela de recuperação. O link usa
fragmento de URL, fica criptografado com AES-256-GCM na fila e é eliminado da
fila após envio/falha definitiva. A transação grava token e mensagem juntos.
O worker roda no processo da API a cada cinco segundos e não sobrepõe seu
próprio ciclo. Instâncias diferentes usam `FOR UPDATE SKIP LOCKED`, leases e
identificadores de posse; uma instância antiga não pode sobrescrever outra.
As tentativas usam o mesmo corpo e `Idempotency-Key` do Resend. São no máximo
cinco, dentro da validade de 20 minutos, sem repetir após a janela de 24 horas
da idempotência do provedor. Falhas transitórias aguardam backoff/Retry-After;
erros permanentes eliminam o conteúdo da mensagem.

Pedidos de recuperação têm limite de 3 por endereço e 20 globais por 15 minutos.
E-mails desconhecidos/desabilitados recebem a mesma resposta, sem revelar se
a conta existe. O consumo exige token válido e senha de pelo menos 12
caracteres; sucesso invalida todos os links e sessões da conta. Alteração do
e-mail ou do hash anterior invalida links antigos. Um login que verificou a
senha antiga antes da troca também é recusado antes de criar outra sessão.

O papel de execução recebe UPDATE somente da coluna `password_hash` para
esta operação, sem poder alterar identidade, habilitação ou funções da conta.
O agente não leu a chave real salva pelo usuário e não fez envios reais.

## Configuração e validação local

Instalar as dependências da raiz e de `server` pelos respectivos lockfiles.
Os comandos abaixo são executados na raiz do repositório:

```sh
npm ci
npm ci --prefix server
node --test tests/native-api.test.mjs tests/native-email.test.mjs
npm test
npm run typecheck
npm run build
```

Para desenvolvimento, usar variáveis do exemplo em `server/.env.example`,
com `NODE_ENV=development` e origens localhost. O arquivo preenchido fica
ignorado pelo Git. Node 22 permite carregá-lo explicitamente:

```sh
node --env-file=server/.env server/src/index.mjs
```

Os testes de integração usam PostgreSQL embarcado (PGlite), dados sintéticos,
o SQL de migração e o papel limitado real. Não acessam o banco da clínica.
Não substituem a validação do container e da rede interna no Dokploy.

Validação atual: 84 testes passaram, incluindo 21 da base da API e 20 de
recuperação/fila/Resend. Os testes usam um Resend simulado; nenhuma chave real
é carregada e nenhum e-mail real é enviado. Verificações de sintaxe e
`git diff --check` também passaram. Typecheck e build da interface não
concluíram na sessão anterior e continuam pendentes. O PostgreSQL nativo local
não pôde ser inicializado devido à restrição de memória compartilhada do
ambiente, e não há Docker local. O primeiro deploy foi concluído na VPS em
23/10/2026 e a imagem e a conexão via driver/rede passaram na validação inicial:
HTTPS aceito, `/healthz` e `/readyz` com HTTP 200, sessão sem login com HTTP 401
e preflight da origem da interface com HTTP 204. Ainda não há validação de
login com conta real, recuperação de senha ou dos fluxos de negócio.

## Preparação do banco

Em 22/10/2026, as duas migrações iniciais foram aplicadas no banco novo da VPS,
em uma única transação pelo terminal local do container. O SQL foi produzido
dos próprios arquivos de migração, validado com PostgreSQL embarcado e gravou
os mesmos checksums esperados pelo migrador. O usuário depois criou o acesso
de execução `nina_app` e definiu sua senha interativamente. Os flags do papel
e as permissões foram conferidos pelo terminal em consultas somente leitura,
sem ler a senha. O usuário confirmou que salvou a URL de execução na API;
a conexão pela aplicação foi confirmada pelo `/readyz` público em 23/10/2026.
Nenhum dado antigo foi importado. Os passos abaixo
descrevem o procedimento normal; não reaplicar a inicialização nem o script
de criação do papel nesse banco. Alterações futuras usam o migrador Node.

1. Executar `server/scripts/migrate.mjs` em um processo temporário que receba
   `MIGRATION_DATABASE_URL` com a credencial proprietária. As migrações não rodam
   automaticamente no processo HTTP e não importam o backup antigo.
2. Executar `server/sql/runtime-role.sql` como proprietário no banco `nina`.
3. Definir a senha de `nina_app` interativamente com `\password nina_app` no
   psql. Não escrever senha em SQL versionado ou argumentos do terminal.
4. Configurar somente a URL de `nina_app` em `DATABASE_URL` no serviço HTTP;
   não fornecer `MIGRATION_DATABASE_URL` ao serviço permanente.
5. Importar usuários/dados com o processo de conversão ainda a desenvolver.
   Preservar IDs e funções; não inserir todos como administradores.

O processo HTTP recusa iniciar com superusuário, dono do banco/schema,
CREATEDB, CREATEROLE, REPLICATION ou BYPASSRLS. A conexão interna aceita
`DATABASE_SSL=disable`; conexões que exijam TLS usam `verify-full`, sem desativar
a validação do certificado. Não incluir parâmetros de SSL na URL.

## Dokploy — parâmetros do build, após concluir a migração

- Código: este mesmo repositório, na branch de migração revisada.
- Contexto de build: `.`.
- Dockerfile da API: `server/Dockerfile` (o Dockerfile da raiz é da interface).
- Stage: `production`; porta interna 3000.
- Domínio: `api.nina.sharkassessoria.tech`, com HTTPS.
- Variáveis de execução: `server/.env.example`, preenchidas no Dokploy.
- Manter autodeploy desligado durante a preparação.

`/readyz` valida somente esta base do backend, não a conclusão da migração da
clínica. A emissão do certificado e a conectividade da VPS precisam ser testadas
depois da primeira publicação planejada.

## Trabalho restante antes de substituir a produção

- Importação dos usuários e conversão dos demais registros e relacionamentos.
  O backup foi extraído integralmente e quatro contas usam bcrypt de custo 10;
  uma não tem senha. A compatibilidade desses hashes está implementada e
  testada. A importação privada das cinco contas foi simulada, mas ainda não
  aplicada na VPS. Publicar esta atualização da API antes de importar contas.
- Adaptação da tela de recuperação para o backend já implementado, validação
  de entrega real e implementação dos convites.
- Autorização por função da equipe e rotas de negócio, sem consultas SQL livres.
- Chat, contatos, agenda, pipeline, automações, workers, IA, Zernio e Vetsoft.
- Cópia dos arquivos e eventos de tempo real autenticados.
- Adaptação completa do frontend e remoção de SDK/configuração Supabase/Lovable.
- Ensaio da importação, backups restauráveis, validação do container/rede, teste
  dos fluxos reais e ativação coordenada dos webhooks/workers.

Referências: [crypto/scrypt no Node.js](https://nodejs.org/docs/latest-v22.x/api/crypto.html),
[sessões na OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html),
[papéis predefinidos do PostgreSQL](https://www.postgresql.org/docs/17/predefined-roles.html),
[driver Postgres.js](https://github.com/porsager/postgres).
Compatibilidade de senhas: [bcrypt.js](https://github.com/dcodeIO/bcrypt.js).
O verificador executa scrypt e bcrypt em todas as tentativas, usando valores
sintéticos quando necessário, e mantém o limite de dois trabalhos simultâneos.
Somente o custo 10 observado no backup é aceito; outros custos falham fechados.
Envio: [API Resend](https://resend.com/docs/api-reference/emails/send-email),
[idempotência](https://resend.com/docs/dashboard/emails/idempotency-keys) e
[recuperação de senha na OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html).
