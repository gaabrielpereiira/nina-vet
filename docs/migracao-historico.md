# Cadastros e histórico no PostgreSQL próprio

Esta etapa adiciona consultas autenticadas em `/v1/clinic/` e prepara a
importação de seis tabelas do backup. Não substitui ainda o frontend completo.
Não integra novos envios de WhatsApp, IA, arquivos ou tarefas agendadas.

## Dados selecionados

Backup de 22/10/2026, confirmado pelo responsável como a última base utilizada:

| Tabela | Registros |
| --- | ---: |
| contacts | 3.037 |
| animals | 92.065 |
| procedures | 915 |
| appointments | 21.719 |
| conversations | 264 |
| messages | 7.174 |
| Total | 125.174 |

O backup contém notas, animais, procedimentos, agenda e histórico de conversas.
Não há nele uma tabela independente de prontuários clínicos completos. A migração
desses registros não comprova que todos os prontuários externos do VetSoft foram
exportados. O conteúdo dos arquivos de mídia também requer uma etapa própria.

## Estrutura e acesso

`0003_clinical_history.sql` cria `nina_clinic`, preservando identificadores,
colunas, enums e relações das seis tabelas selecionadas. As referências de
identidade apontam para `nina_auth.users`; a importação não altera essas contas.

As políticas antigas concedem acesso compartilhado aos funcionários autenticados
nessas seis tabelas. A API mantém esse escopo de uma única clínica: exige sessão,
conta habilitada e função nativa `admin` ou `user`. Não oferece isolamento entre
clínicas diferentes. `user_id` não pode ser enviado como filtro para escolher uma
identidade ou ampliar acesso.

RLS confere a identidade definida por `SET LOCAL` dentro da transação da API.
A conexão volta sem identidade ao concluir ou desfazer a consulta. O papel
`nina_app` recebe apenas SELECT; não pode escrever, importar nem administrar esse
schema. As credenciais de banco e os tokens de fornecedores não são respostas
da API. O histórico retorna colunas explícitas, sem `client_memory`, contextos
internos ou metadados brutos.

## Consultas

- `GET /v1/clinic/contacts?q=&limit=50&offset=0`
- `GET /v1/clinic/contacts/:id`
- `GET /v1/clinic/contacts/:id/animals`
- `GET /v1/clinic/contacts/:id/appointments?from=2026-10-01&to=2026-10-31`
- `GET /v1/clinic/contacts/:id/messages`
- `GET /v1/clinic/appointments?from=2026-10-01&to=2026-10-31`
- `GET /v1/clinic/procedures?q=`

Listas retornam `{ data, next_offset }`. O limite máximo é 100; a interface deve
seguir `next_offset`, sem supor que a primeira página é a base completa. A busca
é literal. Filtros desconhecidos, repetidos, datas inválidas e offsets negativos
são recusados. O histórico de mensagens inclui todas as conversas do contato.

## Preparação privada da importação

```sh
node server/scripts/prepare-clinic-import.mjs \
  /CAMINHO_PRIVADO/data-only.sql \
  /CAMINHO_PRIVADO/extraction-inventory.json \
  /NOVO_DIRETORIO_PRIVADO
```

O programa valida o SHA-256 da extração, colunas, quantidades, identificadores e
135.496 referências no backup utilizado. Cria `import.sql` e `report.json` com
permissões 600 em diretório 700; não sobrescreve um plano anterior.

Somente os blocos COPY das seis tabelas são transferidos. Nenhum SQL da origem,
schema de plataforma, fila pendente, cron, configuração de integração, senha de
usuário ou token de fornecedor é restaurado por esse programa.

O SQL exige banco `nina`, histórico exato das migrações, tabelas vazias e todas as
identidades nativas referenciadas. Usa transação, lock compartilhado de migração,
verificação das contagens antes do COMMIT e registro de procedência em
`nina_meta.data_imports`. Repetir sobre tabelas preenchidas é recusado.

O plano e seus logs podem conter dados pessoais. Não adicioná-los ao Git, não
publicá-los como artefato público e não enviar mensagens com seu conteúdo.

## Aplicação coordenada na VPS

1. Conferir o banco de destino, as cinco contas existentes e a ausência de uma
   importação anterior. Salvar backup privado do banco nativo antes de alterar.
2. Publicar o código desta etapa na branch configurada, mantendo autodeploy desligado.
3. Aplicar a migração 0003 como proprietário e executar
   `server/sql/clinic-runtime-role.sql` para o papel já existente. Não recriar
   `nina_app` e não alterar sua senha.
4. Implantar a API correspondente e confirmar `/readyz`. A prontidão exige a
   lista exata de migrações; coordenar a atualização do banco e da API.
5. Conferir o checksum do arquivo privado recebido, executar com
   `psql -X -v ON_ERROR_STOP=1 -U nina_owner -d nina -f import.sql`, com log privado.
6. Conferir as seis contagens e a procedência da importação, sem imprimir dados
   pessoais. Confirmar que consultas anônimas continuam recusadas.
7. Adaptar e validar as telas com a autenticação nativa antes de liberar o novo
   site. O frontend antigo ainda consulta Supabase e não serve de validação
   dessas rotas. Finalizar backup externo e migração de mídias/integradores.

## Verificação

Os testes sintéticos de `native-clinic.test.mjs` cobrem sessão, origem, RLS,
papel limitado, paginação, busca, filtros e vínculos do histórico. Os testes de
`clinic-import.test.mjs` recusam alterações no backup, colunas inesperadas,
referências quebradas e extração incompleta, sem copiar instruções ou segredos.

O ensaio privado restaura o backup selecionado em PGlite, confere todas as
contagens e reexporta todas as colunas ordenadas por UUID, comparando SHA-256
contra a origem. O ensaio local não substitui a verificação posterior na VPS.
