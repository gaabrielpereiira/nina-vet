# Criação e edição clínica na VPS

## Comportamento

A interface permite criar e editar tutores e animais, criar/editar/cancelar
agendamentos e administrar procedimentos. Cancelar um atendimento preserva seu
histórico. Não há exclusão definitiva de registros.

Contas ativas `user` ou `admin` trabalham com cadastros e agenda compartilhados
pela clínica. Somente `admin` administra procedimentos, com verificação tanto
na API quanto nas políticas do banco. Não há criação de contas nem mudança de
funções nessa etapa.

A agenda altera somente a Nina. A sincronização com VetSoft e o envio de
mensagens continuam desligados; o formulário informa essa limitação. IDs e
metadados importados, identificadores externos e relacionamentos não editados
são preservados.

## Contrato da API

POSTs usam a origem exata do frontend, cookie HttpOnly e JSON:

```json
{
  "operation_id": "UUID gerado por edição",
  "version": 1,
  "data": {"name": "Nome corrigido"}
}
```

O campo `version` é obrigatório para edição e não é enviado na criação.
Rotas POST: `/v1/clinic/contacts[/:id]`,
`/v1/clinic/contacts/:contact/animals[/:id]`,
`/v1/clinic/appointments[/:id]`, `/v1/clinic/procedures[/:id]`.
GETs de detalhe também existem para animais, agendamentos e procedimentos.

Cada edição bloqueia a linha e compara a revisão. Um conflito retorna 409 e
não sobrescreve o registro. Uma tentativa repetida com a mesma operação e os
mesmos dados retorna o resultado anterior. Alterar o conteúdo de uma operação
já concluída retorna conflito. Dados, auditoria e recibo são gravados na mesma
transação; se a auditoria falhar, nada é salvo. O recibo armazena somente id e
revisão do resultado; a auditoria guarda autor, entidade e nomes dos campos,
sem copiar os valores clínicos para logs ou tabelas de auditoria.

Há validação de campos permitidos, formatos e tamanhos, telefone duplicado,
intervalos de preço e vínculos entre tutor/animal/procedimento. Um animal não
pode ser transferido silenciosamente a outro tutor por essas rotas.

## Banco e publicação coordenada

1. Guardar um backup PostgreSQL completo no volume persistente, com acesso 600.
2. Conferir as três migrações existentes e seus checksums.
3. Aplicar `0004_clinical_writes.sql` e `server/sql/clinic-write-role.sql` em uma
   transação administrativa, após aprovação para ativar gravação. Não mudar
   credenciais. O papel HTTP continua sem propriedade de schema/banco, criação
   de funções ou acesso de exclusão às tabelas clínicas.
4. Publicar imediatamente `nina-api` usando `server/Dockerfile`, contexto `.`,
   stage `production`, porta 3000. A API antiga exige três migrações e seu
   readiness deixa de passar ao aplicar a quarta; coordenar essa janela com
   a publicação. Não deixar a migração aplicada sem concluir o deploy da API.
5. Conferir `/readyz`, sessão anônima e CORS. Só então publicar `nina-web` com
   Dockerfile da raiz, porta 8080, e conferir rotas/HTTPS/assets.
6. Validar o primeiro uso real com o titular. Testes automáticos usam somente
   dados sintéticos; o teste de privilégios na VPS usa transação com rollback.

A migração adiciona revisões às quatro tabelas e tabelas privadas de auditoria
/recibos. Os grants são por coluna. Mensagens, conversas e identidades não
recebem novas permissões de escrita. Os recibos devem acompanhar o backup do
banco; uma política futura de retenção deve respeitar a janela de repetição de
operações, em vez de apagá-los durante um atendimento.

## Interrupção ou reversão

Se a migração falhar, a transação inteira deve ser revertida. Não reexecutar
sem verificar primeiro a tabela de migrações e o resultado do deploy.

Depois de ativar escrita, não restaurar um backup antigo nem remover a quarta
migração para voltar a uma interface anterior: isso perderia dados novos e
incompatibilizaria o backend. Para suspender edição, revogar os grants de
INSERT/UPDATE por coluna concedidos nesta etapa, mantendo a API compatível
com a migração 0004. A interface anterior de consulta (`2fd56a9`) pode ser
republicada com essa API. Qualquer correção precisa preservar dados e recibos.
