# Migração completa da Nina para Dokploy

> **Direção substituída em 22/10/2026:** o usuário decidiu eliminar o Supabase
> também do código. As instruções deste documento para instalar Supabase na
> VPS são históricas e não devem ser executadas. O plano atual está em
> [migracao-postgresql-nativo.md](./migracao-postgresql-nativo.md).
> O inventário, o backup e os registros de DNS continuam úteis.

Atualizado em 22/10/2026. Escopo confirmado: mover interface, banco, login,
arquivos e funções para a VPS. Dokploy já está instalado. O acesso ao backend
de origem está disponível somente pelo Lovable.

## Estado desta preparação

O repositório inclui Dockerfile, configuração Nginx, Compose da interface e
exemplo das variáveis públicas. Esses arquivos **não instalam o backend** e
não concluem a migração. A stack Supabase, a restauração e a troca dos serviços
Lovable ainda precisam ser preparadas e verificadas no destino.

Nenhuma implantação da aplicação ou troca do domínio de produção foi executada. A solicitação de
exportação do banco foi concluída após autorização explícita do usuário, e o
backup foi baixado para inspeção local.
O design system aguarda os arquivos de identidade da Vet+.

Validação local: `npm ci`, `npm run build`, `npm run typecheck` e os 43 testes de
`npm test` passaram. O lockfile estava incompleto e foi sincronizado com as
dependências declaradas, sem mudar versões dos pacotes já registrados. O YAML
do Compose foi analisado com sucesso. Docker não está disponível neste ambiente;
o build da imagem e a configuração Nginx ainda precisam de execução real.

O build atual gera um JavaScript principal de aproximadamente 1,89 MB sem gzip
(503 KB com gzip). A divisão por rotas é uma oportunidade a medir na etapa de
fluidez; mudar o servidor por si só não reduz esse bundle.

Consulta ao Dokploy em 22/10/2026: painel autenticado em
`https://painel.sharkassessoria.tech`, versão v0.30.8. O monitor mostrava
1,93 GiB usados de 15,62 GiB de RAM e 9,61 GB usados de 192,69 GB de disco.
CPU estava em aproximadamente 7% naquele instante; número de núcleos e
arquitetura ainda não foram confirmados. Métricas instantâneas não substituem
a medição de uso real da Nina e dos outros serviços.

Consulta ao Lovable na mesma data: projeto **Nina Vet**, ID
`20ea22c4-daef-41a1-bf9d-bbf4b934d01c`, site publicado em
`crm.clinicavetmaisguaiba.com.br`. Banco em US East (Ohio), PostgreSQL
17.6.1.147, com aproximadamente 0,35 GB de 2 GB usados. Isso deve orientar a
escolha de versões compatíveis no destino. O painel exibia 92.065 animais,
21.719 agendamentos e 7.151 mensagens; são contagens do instante da consulta,
não uma validação de integridade.

O usuário autorizou explicitamente gerar o backup no Storage do projeto e enviar
o link temporário ao e-mail cadastrado no Lovable. O arquivo
`copycat-courier-hub_261022.backup` foi gerado no bucket privado
`database_export_22_10_26` e baixado (6.155.469 bytes, aproximadamente 5,9 MiB).
O download veio dentro de um ZIP. Uma cópia do ZIP e o arquivo extraído foram
guardados fora do repositório, em `work/backups/nina-2026-10-22/`, com acesso
restrito. O envio efetivo do e-mail não foi verificado.

Inspeção local confirmou formato PostgreSQL custom (`PGDMP`), catálogo com
1.138 entradas e 84 entradas de dados de tabelas. Entre elas estão
`auth.users`, `auth.identities`, `public.contacts`, `public.conversations`,
`public.messages`, `public.animals`, `public.appointments`, `storage.buckets`
e `storage.objects`. Isso confirma presença no catálogo, não a integridade
dos registros ou a presença dos arquivos de mídia.

SHA-256 do arquivo extraído:
`eaa59f4673818fd95ba531967e496911f801d60a6b3688e439be5b186c8354de`.

A restauração e a descompressão integral **ainda não foram validadas**.
O `pg_restore` padrão local é 16.15 e não reconhece a versão do arquivo;
`/opt/homebrew/opt/libpq/bin/pg_restore` é 18.6 e lista o catálogo, mas foi
compilado sem Zstandard. O destino precisa de um cliente PostgreSQL compatível
com o formato e com suporte zstd antes do ensaio de restauração. Nenhum dado
operacional, segredo ou configuração de produção foi modificado.

## Inventário encontrado no código

| Parte | Implementação atual | Trabalho no destino |
| --- | --- | --- |
| Interface | React 18, Vite 6, Tailwind, Radix, React Router | Compilar e servir com Nginx; configurar domínio e HTTPS |
| Dados | Supabase/PostgREST, SQL em `supabase/migrations/` e `drizzle/migrations/` | Restaurar conteúdo e comparar estrutura, RLS, gatilhos e sequências |
| Login | Supabase Auth | Restaurar contas quando compatíveis; configurar e testar recuperação e convites |
| Tempo real | Canais Supabase em conversas, contatos e outros módulos | Validar publicação e conexão WebSocket pelo gateway |
| Arquivos | Supabase Storage, incluindo mídias de mensagens | Copiar objetos, preservar caminhos e revisar URLs gravadas |
| Backend | 32 diretórios de funções, além de `_shared` | Publicar no Edge Runtime com arquivos compartilhados e dependências |
| WhatsApp | Zernio, webhooks e fila de envio | Configurar credenciais e alternar callbacks de forma coordenada |
| Vetsoft | Conexão, importação e sincronização | Conferir credenciais, agendamentos e permissões de rede |
| Automações | Workers, filas, pg_cron/pg_net e Vault | Inventariar tarefas da origem e recriar as necessárias no destino |
| IA | Gateway Lovable em orquestrador, análise e geração de prompt | Escolher e integrar provedor com conta própria |
| Transcrição | Gateway Lovable em `message-grouper` | Trocar endpoint, autenticação e contrato conforme o provedor |
| E-mails de login | `auth-email-hook` com `@lovable.dev/email-js` | Configurar SMTP/serviço próprio e adaptar o hook |
| Ambiente de desenvolvimento | `lovable-tagger` e bridge de sessão de preview | Remover após validar desenvolvimento fora do Lovable |

O inventário reflete arquivos locais; não confirma quais versões e tarefas estão
efetivamente publicadas no Lovable. Comparar com o ambiente ativo antes de migrar.

## Informações que faltam

- Número de núcleos e arquitetura da VPS; confirmar o uso previsto dos outros
  serviços. O painel Dokploy e as métricas de RAM/disco já foram consultados.
- Espaço para backups fora da VPS. Os domínios da aplicação e da API já foram
  definidos e seus registros DNS estão cadastrados na Hostinger.
- Ensaio de restauração do backup já baixado e inventário/cópia dos arquivos e
  tarefas em produção.
- Provedores e credenciais de IA, transcrição, SMTP, Zernio, Vetsoft e demais
  integrações ativas. Reconfigurar nos serviços de destino, fora do Git.
- Logos, cores, fontes e referências visuais da Vet+.

## Domínio e serviço da aplicação configurados

Em 22/10/2026, o usuário definiu **nina.sharkassessoria.tech** como endereço da
aplicação. Foi criado na Hostinger o registro A `nina`, com IP
`179.198.99.136` e TTL de 300 segundos. O IP foi confirmado nas configurações
do próprio Dokploy. A consulta ao DNS autoritativo
`horizon.dns-parking.com` confirmou o registro após a criação.

Foi reutilizado o projeto existente **Nina - Vet mais**, ambiente `production`,
e criado o serviço Application **nina-web**, ainda sem implantação:

- Projeto: `3u20McG_VAjARJaSgc-eH`.
- Ambiente: `EZghFxW4uEYrPleJXT7ql`.
- Aplicação: `5IbF8rDFnmrSlAMrP3uF3`.
- Domínio cadastrado: `nina.sharkassessoria.tech`, caminho `/`, porta 8080.
- HTTPS configurado com Let's Encrypt; emissão e acesso HTTPS ainda não testados.
- Build configurado como Dockerfile, arquivo `Dockerfile`, contexto `.`,
  estágio `production`.
- Autodeploy desativado durante a preparação da migração.

O serviço ainda precisa do repositório/branch contendo os arquivos Docker
preparados localmente e das variáveis públicas do backend de destino. Nenhum
deploy foi disparado. O Compose da interface continua disponível como
alternativa; não criar outro serviço para a mesma interface sem revisar o
Application já existente.

O usuário confirmou também **api.nina.sharkassessoria.tech** para o backend.
Foi criado na Hostinger o registro A `api.nina`, com IP `179.198.99.136` e TTL
de 300 segundos. A listagem atualizada da zona DNS confirmou ambos os registros,
`nina` e `api.nina`. A propagação pública do novo registro não foi verificada
nesta etapa. O serviço de backend e sua rota HTTPS no Dokploy ainda precisam
ser montados; o novo registro DNS não implica que a API já esteja funcionando.

## Extração quando o acesso é somente pelo Lovable

Conferir a interface atual em **More → Database → Manage → Settings → Export
project data** e solicitar a exportação. Baixar o arquivo quando estiver pronto;
os arquivos de Storage precisam de cópia separada. A documentação atual descreve
um arquivo PostgreSQL custom-format `.backup`, possivelmente dentro de um ZIP,
com contas e hashes de senha. Inspecionar o arquivo real antes de decidir como
restaurar. Não presumir que seja um SQL para colar no editor.

Inventariar à parte configurações de autenticação, segredos e agendamentos.
Esses itens exigem conferência/reconfiguração; código de funções vem do Git.
Referências: [exportação do banco](https://docs.lovable.dev/features/database-backups)
e [migração para infraestrutura própria](https://docs.lovable.dev/tips-tricks/external-deployment-hosting).

## Arquitetura proposta

Usar a distribuição oficial do Supabase com Docker para Postgres, Auth,
PostgREST, Storage, Realtime, Edge Runtime e gateway, gerenciada pelo Dokploy.
Escolher uma revisão oficial, registrar commit e imagens utilizadas e adaptar
domínios, volumes e segredos à VPS. Não substituir essa stack por um contêiner
Postgres isolado: o cliente da Nina usa os outros serviços diretamente.

O Compose da interface fica separado do backend para permitir publicar telas
sem reiniciar os serviços de dados. O navegador usa a URL HTTPS pública da API;
funções e tarefas internas devem usar endereços e chaves adequados ao gateway
da stack escolhida. Conferir chaves JWT legadas e novas chaves opacas antes de
reutilizar chamadas que montam `Authorization: Bearer` manualmente.

Na stack self-hosted, montar as funções deste repositório mantendo `_shared`
e os arquivos `deno.json`, além do dispatcher `main` da distribuição oficial.
O `supabase/config.toml` local não deve ser tratado como configuração automática
do dispatcher self-hosted: revisar autenticação por rota, HMAC dos webhooks e
autorização dos workers antes de expor os endpoints.

Referências: [Supabase com Docker](https://supabase.com/docs/guides/self-hosting/docker),
[funções self-hosted](https://supabase.com/docs/guides/self-hosting/functions),
[Compose no Dokploy](https://docs.dokploy.com/docs/core/docker-compose).

## Interface no Dokploy

1. Criar uma aplicação Docker Compose ligada a este repositório e selecionar
   `compose.dokploy.yml`, em modo Docker Compose (o arquivo usa `build`).
2. Definir `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY` do **destino** no
   ambiente do Dokploy. O Compose repassa esses valores como argumentos do build.
   Usar somente chave pública/anon, nunca `service_role` ou `sb_secret_`.
3. Adicionar um domínio de teste no Dokploy para o serviço `nina-web`, porta
   interna **8080**, e ativar HTTPS. O Compose não publica porta no host.
4. Publicar e verificar `/healthz`, acesso direto a `/chat`, login e recuperação
   de senha. `/healthz` mede somente o servidor da interface, não o backend.
5. Recompilar quando mudar URL ou chave: Vite incorpora esses valores no build.

O Docker exclui `.env` do contexto para evitar usar a configuração da origem.
Há um `.env` já rastreado pelo Git neste repositório; a regra adicionada ao
`.gitignore` não remove arquivos já rastreados. Revisar seu conteúdo antes de
alterar o rastreamento ou publicar novas credenciais.

Para validar onde Docker estiver disponível:

```sh
docker compose --env-file .env.local -f compose.dokploy.yml config --quiet
docker compose --env-file .env.local -f compose.dokploy.yml build
```

Depois de subir a aplicação, conferir fallback das rotas, cache do HTML,
assets existentes e 404 para assets inexistentes. O Nginx aplica compressão e
cache longo somente à pasta de assets gerada pelo Vite.

## Sequência de migração do backend

1. Confirmar recursos e preparar stack isolada, volumes persistentes, domínio
   de API, HTTPS e backup externo. Registrar as versões de todos os serviços.
2. Exportar a origem e ensaiar restauração em destino descartável. Usar
   `pg_restore --list` para inspecionar arquivos custom-format; conferir versão
   do cliente e suporte à compressão antes de restaurar.
3. Escolher objetos/dados de restauração considerando os schemas gerenciados já
   existentes. Não aplicar cegamente dump completo e ambas as pastas de migração:
   isso pode duplicar objetos e seeds. Comparar com o catálogo de origem/dump e
   seguir o journal do Drizzle apenas para migrações ainda ausentes.
4. Comparar registros, usuários, relacionamentos, sequências, RLS, grants,
   triggers e publicação Realtime. Testar também criação de novos registros.
5. Copiar objetos de Storage preservando bucket/caminho e comparar contagens e
   integridade. Identificar URLs absolutas antigas no banco; preparar sua troca
   após conhecer os hosts reais. Validar downloads públicos e privados.
6. Publicar funções e substituir IA, transcrição e e-mails do Lovable. Ajustar
   remetente, SMTP, URLs de redirecionamento e eventuais provedores de login.
7. Conferir todas as tarefas da origem. `supabase/setup/automations-cron.sql`
   cobre runner, scheduler e limpeza; **não** cobre todos os disparos necessários
   de Nina, sender e Vetsoft. Configurar Vault no destino com seus novos valores.
8. Testar com contas migradas: login, convite, senha, conversas em tempo real,
   mídia, atendimento humano, resposta automática, WhatsApp, agenda, Vetsoft e
   automações. Manter tarefas de envio inativas no ensaio e usar contatos de teste.
9. Definir janela final conforme tempos medidos de exportação/restauração e
   limite de frequência informado pelo Lovable. Coordenar suspensão de escritas
   e tarefas na origem, fazer cópia final, restaurar, conferir e alternar domínio
   e webhooks. Só um ambiente deve processar as filas reais.
10. Acompanhar envios, erros e filas. Manter backup verificado e plano de retorno.
    Se houver novas escritas no destino, reconciliá-las antes de voltar à origem;
    só trocar DNS de volta pode descartar alterações.

## Critério de conclusão

Migração completa exige fluxo real validado no destino, sem chamadas de runtime
ao Lovable, com backups restauráveis e apenas uma instância ativa dos workers.
O build da interface sozinho não confirma esses requisitos.
