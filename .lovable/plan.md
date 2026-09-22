# Arquivamento de conversas + filtros na aba do chat

## Objetivo

Organizar a aba de conversas: poder arquivar conversas finalizadas, ver filtros claros de quem está atendendo (Nina ou humano) e garantir que, se o lead voltar a falar, a conversa desarquiva sozinha e a Nina assume novamente.

## O que você vai ver na tela

1. **Filtros no topo da lista de conversas** (ao lado da busca):
   - **Todas** — conversas ativas (padrão)
   - **Com a Nina** — só as que a IA está respondendo
   - **Com humano** — só as que um atendente assumiu
   - **Arquivadas** — só as finalizadas/arquivadas
2. **Botão de arquivar** no cabeçalho da conversa aberta (ícone de caixa/arquivo) e ação de arquivar ao passar o mouse sobre a conversa na lista.
3. **Conversas arquivadas** ficam fora da lista principal e aparecem com marcador próprio na aba "Arquivadas", com botão **Restaurar**.
4. Ao arquivar, a Nina é pausada naquela conversa.
5. **Comportamento automático:** se o lead mandar mensagem nova em uma conversa arquivada, ela volta sozinha para a lista de ativas e a Nina volta a responder.

## Mudanças técnicas

### Banco de dados (migration)
- Tabela `conversations`: novos campos `archived_at` (data do arquivamento) e `archived_by` (quem arquivou), com índice.
- Novo gatilho no banco: quando chegar mensagem nova do lead (`from_type = 'user'`) em conversa arquivada, limpa o arquivamento, reativa a Nina (`status = 'nina'`, `ai_paused = false`) — funciona mesmo com a tela fechada.

### Frontend
- `src/types.ts` / transformadores: incluir `archivedAt` na conversa.
- `src/services/api.ts`: `fetchConversations` passa a trazer `archived_at`; novas ações `archiveConversation` e `unarchiveConversation`.
  - Arquivar: `archived_at = agora`, `status = 'paused'`, `ai_paused = true`.
  - Restaurar (manual): limpa arquivamento, `status = 'nina'`, `ai_paused = false`.
- `src/hooks/useConversations.ts`: expor `archiveConversation`/`unarchiveConversation`; incluir `archived_at` nas atualizações em tempo real.
- `src/components/ChatInterface.tsx`:
  - Chips de filtro (Todas / Nina / Humano / Arquivadas) abaixo da busca, com contagem.
  - Lista principal passa a esconder arquivadas; filtro "Arquivadas" mostra apenas elas.
  - Botão de arquivar/restaurar no cabeçalho da conversa e no item da lista (hover).
  - Badge de status já existente (Nina/Humano/Pausado) continua, agora combinado ao filtro.

### Validação
- Build do frontend sem erros.
- Teste no navegador: arquivar uma conversa, conferir que sai da lista e aparece em "Arquivadas"; restaurar; simular mensagem nova do lead e confirmar que a conversa desarquiva com a Nina ativa.

## Pendência fora deste plano
- A chave da API da Zernio ainda precisa ser preenchida em **Configurações > APIs** (campo novo "API Key da Zernio" já está na tela).
