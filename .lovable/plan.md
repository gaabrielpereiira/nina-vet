# Importar procedimentos e valores do VetSoft

Objetivo: puxar do VetSoft tudo que tem preço (serviços/atendimentos, vacinas e produtos) e trazer para a seção Procedimentos, com uma prévia onde você escolhe o que aplicar.

## Como vai funcionar

1. Em Configurações > Procedimentos aparece o botão "Importar do VetSoft".
2. O sistema busca o catálogo no VetSoft e mostra uma prévia em três grupos:
   - Novos: itens que ainda não existem aqui (vêm marcados).
   - Alterados: já existem, mas o preço ou o nome no VetSoft está diferente — mostra "de → para" e você marca quais atualizar.
   - Iguais: sem diferença, apenas listados.
3. Você pode filtrar por tipo (serviço, vacina, produto) e por texto antes de confirmar.
4. Ao confirmar, só os itens marcados são gravados. Nada é excluído automaticamente.
5. O que você escreveu à mão (descrição, requisitos, duração) nunca é sobrescrito pela importação — só nome, preço e categoria vêm do VetSoft.

Cada procedimento importado guarda a origem, então na reimportação o mesmo item é reconhecido em vez de duplicar.

## Detalhes técnicos

**Banco (migration)**
- `procedures`: adicionar `vetsoft_item_id` (integer), `vetsoft_item_type` (text: `service` | `vaccine` | `product`), `vetsoft_synced_at`, `source` (text, default `manual`).
- Índice único parcial em (`vetsoft_item_type`, `vetsoft_item_id`) onde `vetsoft_item_id` não é nulo, para o upsert idempotente.

**Edge function `vetsoft-import-procedures`**
- Valida JWT, usa `_shared/vetsoft.ts` (`vetsoftFetch`) para o token/tenant.
- Modo `preview`: lê o catálogo do VetSoft, paginado (`per_page=100`), normaliza cada item em `{ external_id, type, name, category, price }` e compara com o que já existe em `procedures`, devolvendo `new` / `changed` / `unchanged`.
- Modo `apply`: recebe a lista de itens marcados e faz upsert em `procedures` preenchendo apenas `name`, `category`, `price_type='fixed'`, `price`, campos `vetsoft_*`, `source='vetsoft'`; mantém `description`, `requirements`, `duration_minutes` e `is_active` já existentes.
- Erros do VetSoft são devolvidos com mensagem legível (mesmo padrão de `vetsoft-connect`).

**Descoberta de endpoints (primeiro passo da implementação)**
Os nomes dos endpoints/campos de catálogo do VetSoft não estão confirmados no código atual — só `/service-types` (que traz tipos de agenda, sem preço) está em uso. A função vai começar sondando os candidatos (`/services`, `/products`, `/vaccines`, `/price-tables`) com o token já conectado, logando o formato de resposta, e o mapeamento de campos (`nom_*`, `val_*`/`vlr_*`) é fixado a partir do retorno real. Se algum tipo não existir na API, a importação segue com os que existirem e a tela informa o que não veio.

**Frontend**
- `src/hooks/useVetsoftProcedureImport.ts`: chama a function nos dois modos.
- `src/components/settings/VetsoftImportDialog.tsx`: diálogo com abas Novos/Alterados/Iguais, checkboxes, filtro por tipo e busca, resumo antes de aplicar.
- `src/components/settings/ProceduresSettings.tsx`: botão de importar (desabilitado com aviso quando o VetSoft não está conectado) + badge "VetSoft" nos procedimentos importados.
- `src/hooks/useProcedures.ts`: incluir os novos campos na interface `Procedure`.
