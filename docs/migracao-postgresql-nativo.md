# Nina com PostgreSQL e backend próprio

Decisão do usuário em 22/10/2026: eliminar o Supabase do código e executar
PostgreSQL comum na VPS, com backend próprio. Não instalar o template Supabase.

## Situação real

Atualização de 03/11/2026: as cinco contas e 125.174 registros foram importados
na VPS. API e interface nativa de consulta estão publicadas nos dois domínios;
o titular confirmou o login com a conta anterior. O bundle publicado usa a API
própria, sem runtime Supabase/Lovable. Criação/edição clínica está implementada
e testada, com ativação coordenada do banco/API ainda pendente. Veja
[a edição nativa](edicao-nativa.md) e [a interface](frontend-nativo.md).

As anotações abaixo registram etapas anteriores e decisões da migração. Para
o estado executável atual, usar o README e o procedimento específico da etapa.

- A branch `codex/postgres-backend` separa este trabalho do código em produção.
- A interface e as funções antigas ainda usam o SDK e os serviços do Supabase.
  A remoção completa **não** está implementada. A base da API própria está
  implementada localmente em `server/`, sem dependências Supabase/Lovable.
- Foram identificadas 32 funções de backend, além dos arquivos compartilhados,
  e acessos diretos no frontend a dados, autenticação, arquivos e tempo real.
- Nenhum serviço Supabase foi criado pelo agente no Dokploy.
- O serviço `nina-db` foi criado e iniciado no Dokploy. Em 22/10/2026,
  os logs confirmaram PostgreSQL 17.11 pronto para conexões; a importação
  dos dados da Nina ainda não foi realizada.
- Banco `nina`, usuário proprietário `nina_owner`, host interno
  `nina-vet-mais-ninadb-foiarh`, porta interna `5432`. A porta externa estava
  vazia na conferência anterior ao deploy. Senhas não são registradas aqui.
- Em 22/10/2026, o acesso local com `psql` no terminal de `nina-db` confirmou
  banco `nina`, papel `nina_owner` e PostgreSQL 17.11 em x86_64. O banco estava
  vazio: nenhum schema próprio, papel `nina_app` ou tabela pública existia.
  Foram então aplicadas as duas migrações iniciais em transação única, com
  trava e registro dos mesmos checksums usados pelo migrador Node. Houve
  `COMMIT`; a estrutura de autenticação/e-mail foi criada sem importar contas.
- A Application `nina-api` foi criada no Dokploy (ID
  `cGVE1eOPHWTETcz1IbxAr`, app `nina-vet-mais-ninaapi-klo6hq`). Autodeploy
  desligado. O usuário iniciou o primeiro deploy em 23/10/2026, concluído como
  Done para o commit `491ccdaa70c42390b03cf957ec3535dcdfcdcffb`. A fonte e o build estão salvos no
  serviço: Git público, branch `codex/postgres-backend`, Build Path `/`,
  Dockerfile `server/Dockerfile`, contexto `.`, stage `production`.
  A branch de migração é separada de `main`. O primeiro deploy manual validou
  a base da API; não substitui o sistema em produção.
- O domínio `api.nina.sharkassessoria.tech` está salvo, com caminho `/`, porta
  interna `3000`, HTTPS e Let's Encrypt. Conferido na lista de Domains. A emissão
  efetiva do certificado e a resposta HTTP foram verificadas em 23/10/2026:
  `/healthz` e `/readyz` retornaram HTTP 200 com validação TLS normal.
  A sessão sem login retornou 401 e o preflight da origem da interface,
  204 com origem exata e cookies permitidos. Nenhum dado de paciente foi lido.
- Foram adicionados 41 testes de integração para o backend próprio (21 da base
  e 20 de recuperação/e-mail). A suíte completa passou com 84 testes, usando dados sintéticos e PostgreSQL embarcado
  (PGlite). Isso não comprova a migração completa nem a rede/container da VPS.
- A última alteração na configuração da API também passou nos testes próprios.
  As verificações de sintaxe dos módulos passaram. As tentativas de typecheck e
  build da interface nesta etapa não concluíram e foram interrompidas, inclusive
  após tentar outro runtime Node. Essa validação continua pendente antes de
  publicar; não foram feitas alterações nos componentes da interface.
- O backup exportado e os registros DNS existentes permanecem disponíveis.
- Foi extraído o DDL do backup (349.977 bytes; 34 tabelas em `public`, 27 em
  `auth` e 8 em `storage`) em arquivo privado fora do Git. Em 23/10/2026,
  também foi extraído todo o conteúdo de dados: 37.866.398 bytes, 84 tabelas
  e 134.350 registros. Foi compilado um leitor PostgreSQL 18.6 com zstd a partir
  da distribuição oficial, sem alterar a instalação do sistema. O checksum do
  backup original foi reconferido e todos os blocos COPY tiveram a quantidade
  de campos validada. O SQL e os relatórios privados permanecem fora do Git,
  com arquivos 600 e diretório 700. Isso ainda não restaura dados na VPS.

## Contas externas — atualização do usuário

O usuário informou inicialmente que não possuía contas próprias de IA/e-mail.
Depois confirmou a criação da conta Resend; o painel da organização
`sharkassessoria` foi acessado. Depois, o usuário confirmou que criou a chave
no Google AI Studio e salvou `GEMINI_API_KEY` no Environment de `nina-api`.
O valor não foi lido pelo agente; a validade, as permissões e a disponibilidade
da API ainda não foram testadas. Nenhuma cobrança foi ativada pelo agente.

Foram escolhidos Resend para e-mails transacionais, começando pelo plano Free,
e acesso direto ao Gemini para IA, pois o código existente já usa modelos Gemini
através do gateway Lovable. A chave salva não conecta automaticamente o código:
a integração direta ainda precisa ser implementada. O modelo final e os limites
de gastos ainda precisam ser definidos antes da produção.
OpenAI é uma alternativa, mas não foi escolhida pelo usuário.

O domínio `nina.sharkassessoria.tech` foi adicionado ao Resend, região São Paulo
(`sa-east-1`), ID `1bc1c011-c752-4292-9285-1b81dc1558b2`.
Os três registros obrigatórios gerados foram salvos pelo usuário na Hostinger
e conferidos na lista de DNS:

| Tipo | Nome relativo em sharkassessoria.tech | Valor | TTL |
| --- | --- | --- | --- |
| TXT | `resend._domainkey.nina` | Chave pública DKIM copiada do Resend e conferida no formulário | 3600 |
| CNAME | `rsend.nina` | `rsend-sae1.forge.rmta.net` | 3600 |
| CNAME | `send.nina` | `send.forge.rmta.net` | 3600 |

Foi iniciada a verificação no Resend com **I've already added the records**.
O usuário informou que o domínio passou a **Verified**; esse status foi
confirmado na lista de Domains do Resend. O DMARC opcional exibido no onboarding não foi adicionado; os
registros A existentes não foram editados.
Remetente sugerido: `acesso@nina.sharkassessoria.tech`.
Nenhuma chave Resend foi criada ou lida pelo agente, e nenhum e-mail foi enviado.
Antes de ativar recuperação de senha, conferir/desligar tracking de links
nesse domínio. O painel Configuration apresenta tracking a configurar,
sem subdomínio de tracking cadastrado; nenhuma opção foi alterada.
O domínio preexistente `auth.sharkassessoria.com.br` não foi modificado.
Depois da verificação, colocar a chave de envio somente no servidor.
O formulário de chave `Nina Vet - VPS` está novamente preenchido, agora com
**Sending access** e domínio exclusivo **nina.sharkassessoria.tech**.
O usuário confirmou que criou e guardou a chave. O segredo não foi lido pelo
agente. A chave Onboarding existente não foi reutilizada/modificada.

Em `nina-api → Environment`, as variáveis existentes `NODE_ENV` e `PORT`
foram preservadas e foram acrescentados os campos de configuração. O usuário
confirmou que substituiu o marcador pela chave real e salvou no Dokploy:

```dotenv
RESEND_API_KEY=COLE_A_CHAVE_AQUI
EMAIL_FROM="Nina Vet <acesso@nina.sharkassessoria.tech>"
```

O trecho acima é apenas um exemplo sem segredo; a chave real não foi lida
pelo agente, gravada em arquivos locais ou enviada pelo chat.
A integração de envio foi implementada localmente, com fila criptografada,
retries/idempotência, link de recuperação de uso único e revogação de sessões.
Os testes usam provedor simulado. Nenhum deploy ou envio real foi realizado.
Antes de ativar, ainda adaptar a tela de recuperação e validar a entrega. `EMAIL_ENABLED`
permanece falso por padrão no código. O usuário confirmou depois que salvou
no Dokploy `API_ORIGIN`, `FRONTEND_ORIGIN`, `DATABASE_SSL=disable`,
`DATABASE_POOL_SIZE=5` e `EMAIL_ENABLED=false`. Depois confirmou que gerou e
salvou também `EMAIL_ENCRYPTION_KEY` no mesmo serviço.

O usuário gerou `EMAIL_ENCRYPTION_KEY` no próprio Terminal, seguindo a instrução
`/usr/bin/openssl rand -hex 32`, e confirmou que salvou o valor somente no
Environment de `nina-api`. O agente não gerou nem leu a chave; o formato e o
valor não foram conferidos de forma independente.
Manter `EMAIL_ENABLED=false` até concluir a tela e validar a entrega.

Foi removida de `vite.config.ts` a substituição de `process.env.API_KEY` e
`process.env.GEMINI_API_KEY` pelo valor de `GEMINI_API_KEY` durante o build.
Nenhum consumidor dessas substituições foi encontrado no código TS/JS.
A chave da IA pertence exclusivamente ao servidor; essa alteração evita
que a configuração antiga a disponibilize ao código do navegador.
Após essa alteração, `git diff --check` passou. A tentativa de build com Node
24 não apresentou saída/progresso e foi interrompida; a validação do build
continua pendente e nenhuma publicação foi realizada.
O plano Free consultado oferece 3.000 e-mails/mês e limite de 100 por dia.
Fonte: https://resend.com/pricing (consultada em 22/10/2026).

## Arquitetura de destino

| Componente | Destino |
| --- | --- |
| Interface React/Vite | Serviço existente `nina-web`, domínio `nina.sharkassessoria.tech` |
| API própria em Node.js | Serviço `nina-api`, porta interna planejada `3000`, domínio `api.nina.sharkassessoria.tech` |
| Banco | PostgreSQL 17, serviço `nina-db`, acessível pela rede interna |
| Login e permissões | Implementação no backend, com sessões revogáveis e cookies HttpOnly |
| Arquivos de mídia | Volume persistente ou armazenamento S3, com acesso controlado pela API |
| Tempo real | Conexões autenticadas de eventos entre interface e API |
| Tarefas de atendimento e integração | Processadores próprios, com proteção contra execução duplicada |

Credenciais de banco e provedores ficam no servidor. O navegador acessará apenas
a API; não haverá chave Supabase pública nem conexão direta com PostgreSQL.
O usuário proprietário do banco será usado para administração/migração; a API
deverá ter um usuário de execução separado, com privilégios limitados.

## Banco no Dokploy — etapa realizada

No projeto **Nina - Vet mais**, ambiente **production**:

1. Abrir **Create Service → Database**.
2. Selecionar **PostgreSQL**.
3. Preencher Name `nina-db`, Database Name `nina`, Database User `nina_owner`.
4. Usar a imagem `postgres:17-bookworm`.
5. Usar **Generate password** e guardar a senha em um gerenciador de senhas.
6. Clicar **Create**. Conferir a configuração antes do primeiro **Deploy**.
7. Executar **Deploy → Confirm** e conferir em **Logs** a mensagem
   `database system is ready to accept connections` (confirmado).

## Etapa atual: código e migração dos dados

A **Application** `nina-api` já está criada no mesmo projeto e ambiente.
O domínio já foi salvo. A primeira publicação isolada da base da API pode
validar container, credencial de execução, rede interna e HTTPS. Ela não
substitui a Nina em produção: não publicar a interface nova nem ativar envios,
webhooks ou atendimento antes da migração dos dados e integrações. Manter
autodeploy desligado e `EMAIL_ENABLED=false` nessa validação.

### Base já implementada localmente

- Servidor Node.js na porta 3000, pool PostgreSQL limitado, endpoints de saúde
  e verificação da versão das migrações.
- Migrações transacionais próprias e papel `nina_app` com privilégios limitados.
- Login, sessões em cookie HttpOnly/Secure, expiração e revogação; limitação
  de tentativas no banco e proteção de origem nos POSTs.
- Dockerfile separado para a API (`server/Dockerfile`), sem credenciais
  administrativas fornecidas ao processo HTTP.
- Recuperação de senha e integração Resend no backend, com fila persistente
  criptografada, leases, tentativas limitadas e proteção contra reutilização
  de links. A tela correspondente ainda precisa ser adaptada.

As duas migrações iniciais **foram aplicadas na VPS**. O usuário executou o
arquivo `/tmp/nina-runtime-role.sql`, que criou `nina_app`, concedeu os grants
de execução e pediu a senha interativamente com `\password nina_app`.
A conclusão foi confirmada no terminal: login habilitado, sem superusuário,
CREATEDB, CREATEROLE, REPLICATION ou BYPASSRLS. Consultas em transação somente
leitura com `SET LOCAL ROLE nina_app` também validaram o acesso às tabelas e
as restrições de alteração de identidade, habilitação e funções da equipe.
A senha não foi lida pelo agente. O usuário confirmou que salvou a URL de
`nina_app` em `DATABASE_URL` na API; o valor não foi lido pelo agente e a
conexão por senha/rede a partir da aplicação foi confirmada pelo `/readyz`
público em 23/10/2026. Isso não valida o login dos usuários antigos da Nina.
Não executar o script de criação do papel novamente.
Os testes criam contas sintéticas; nenhum usuário real foi convertido.
A recuperação de senha do backend está implementada, mas sua tela e a entrega
real ainda precisam de validação. Convites, rotas de negócio e permissões da
equipe continuam pendentes. O verificador aceita o formato novo scrypt e foi
adaptado para o bcrypt de custo 10 presente nas quatro contas com senha da
origem. Uma quinta conta não tem senha cadastrada. O plano privado das cinco
contas e sete atribuições de função preserva os IDs e permissões da origem;
passou em simulação local, inclusive proteção contra reexecução e teste de
aspas/injeção em nomes. Não copia sessões ou tokens anteriores. A origem não
tem MFA, WebAuthn ou SSO cadastrados, e todas as identidades são de e-mail.
A importação na VPS ainda não foi aplicada e depende da publicação do novo
verificador e da confirmação do usuário para habilitar essas contas.
Detalhes de desenvolvimento e execução em `server/README.md`.

Não importar o backup completo diretamente no banco novo. Ele contém schemas,
políticas, gatilhos, funções e usuários vinculados à arquitetura anterior.
A extração e a transformação para a estrutura própria são parte da migração.

## Trabalho de desenvolvimento necessário

1. Criar a API e as migrações próprias, com autenticação, recuperação de senha,
   convites, sessões revogáveis e autorização por função da equipe.
2. Criar a camada de dados e portar as regras de negócio. Não expor uma API SQL
   genérica nem confiar no navegador para determinar permissões.
3. Extrair e converter os registros do backup para o novo modelo, preservando
   IDs e relacionamentos. Inspecionar os hashes dos usuários antes de decidir
   se as senhas podem ser mantidas; oferecer recuperação quando necessário.
4. Portar atendimento da Nina, Zernio/WhatsApp, Vetsoft, automações, filas,
   agendamentos e e-mails. Substituir também os gateways do Lovable.
5. Migrar mídias, os caminhos e suas permissões; criar os endpoints de arquivos.
6. Implementar eventos de tempo real autenticados e adaptar hooks/componentes.
7. Substituir todas as chamadas de dados, auth, storage, functions e canais do
   frontend pela API própria e remover o pacote `@supabase/supabase-js`.
8. Remover do runtime as variáveis, imports, URLs e configurações Supabase e
   Lovable. Atualizar Dockerfile e build da interface para `VITE_API_URL`.
9. Testar os fluxos completos com PostgreSQL isolado, inclusive tentativas de
   acesso sem login e pela equipe sem privilégios administrativos.
10. Ensaiar importação/restauração e backups externos. Coordenar a cópia final e
    a ativação de webhooks e workers sem dois ambientes enviando mensagens.

## Critério de conclusão

O sistema deve funcionar com PostgreSQL comum e API própria, sem SDK, serviços,
chaves ou endpoints Supabase em runtime. Apenas remover o pacote, renomear o
cliente ou trocar a URL não atende à decisão do usuário. Antes da publicação,
devem passar os fluxos de login, chat, mídia, agenda, equipe, WhatsApp, Vetsoft e
automações, além do ensaio de migração dos dados e restauração de backup.
