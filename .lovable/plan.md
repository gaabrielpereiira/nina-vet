## Objetivo
Criar uma seção "Procedimentos" nas Configurações para cadastrar os serviços da clínica veterinária (ex: castração, vacinação, consulta). A Nina passa a conhecer esses procedimentos automaticamente, e o agendamento pode (opcionalmente) referenciar um deles.

## O que será entregue

### 1. Nova tabela `procedures` no banco
Cada procedimento terá:
- Nome e descrição
- Categoria (ex: Cirurgia, Vacina, Exame, Consulta) e requisitos/pré-requisitos (ex: jejum, idade mínima)
- Preço: valor fixo, ou faixa (mínimo/máximo)
- Duração estimada (min) — campo utilitário para agendamento (mesmo não sendo destacado, é útil manter)
- Ativo/inativo

Acesso compartilhado (single-tenant, mesmo padrão de `deals`/`appointments`): qualquer usuário autenticado pode listar/editar; anônimos não têm acesso.

### 2. UI em Configurações → Procedimentos
- Novo item na aba de configurações (`src/components/Settings.tsx`) chamado "Procedimentos".
- Tela com lista dos procedimentos cadastrados (nome, categoria, preço, status ativo).
- Botão "Novo procedimento" abre modal com os campos acima.
- Ações: editar, ativar/desativar, excluir.
- Toggle de preço: "Valor fixo" ou "Faixa (mín–máx)".

### 3. Integração com a Nina (injeção no prompt)
- A edge function `nina-orchestrator` lê os procedimentos ativos de `procedures` e monta um bloco de contexto:
  ```
  ## Procedimentos disponíveis
  - <Nome> (<Categoria>) — R$ <preço ou faixa> · ~<duração> min
    <descrição>
    Requisitos: <requisitos>
  ```
- Esse bloco é concatenado ao `system_prompt_override` antes de chamar o modelo, para que a Nina possa responder sobre valores, requisitos e categorias sem alucinar.
- Se a lista estiver vazia, nada é injetado (comportamento atual preservado).

### 4. Vínculo opcional em Agendamentos
- Adicionar coluna `procedure_id` (opcional) em `appointments`.
- No modal/tela de agendamento (`src/components/Scheduling.tsx` e/ou `CreateDealModal`), incluir um seletor "Procedimento" que lista procedimentos ativos — não obrigatório.
- Ao selecionar, pré-preenche `duration` com a duração estimada do procedimento (usuário pode sobrescrever).

## Detalhes técnicos

**Migration**
```sql
CREATE TABLE public.procedures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  category text,
  requirements text,
  price_type text NOT NULL DEFAULT 'fixed', -- 'fixed' | 'range'
  price numeric,
  price_min numeric,
  price_max numeric,
  duration_minutes integer,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.procedures TO authenticated;
GRANT ALL ON public.procedures TO service_role;
ALTER TABLE public.procedures ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can access all procedures"
  ON public.procedures FOR ALL TO authenticated
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');
CREATE TRIGGER update_procedures_updated_at
  BEFORE UPDATE ON public.procedures
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.appointments
  ADD COLUMN procedure_id uuid REFERENCES public.procedures(id) ON DELETE SET NULL;

ALTER PUBLICATION supabase_realtime ADD TABLE public.procedures;
ALTER TABLE public.procedures REPLICA IDENTITY FULL;
```

**Arquivos novos/alterados**
- `src/components/settings/ProceduresSettings.tsx` — lista + modal CRUD.
- `src/components/Settings.tsx` — nova aba "Procedimentos".
- `src/hooks/useProcedures.ts` — fetch/CRUD + realtime.
- `src/components/Scheduling.tsx` — seletor de procedimento (opcional).
- `supabase/functions/nina-orchestrator/index.ts` — buscar procedimentos ativos e injetar no system prompt.
- `src/integrations/supabase/types.ts` — regenerado automaticamente após a migration.

## Fora do escopo (para pedir depois se quiser)
- Fotos por procedimento.
- Preço por porte do animal (P/M/G).
- Vínculo de procedimento com estágio do pipeline.
