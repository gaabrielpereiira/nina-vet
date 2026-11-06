# Recuperação de vínculo do WhatsApp após importação

Um evento `message.sent` ficou em conferência com
`CHANNEL_AMBIGUOUS_CONVERSATION`. A análise somente leitura encontrou um único
tutor por identidade de plataforma, 18 conversas legadas com o mesmo identificador,
nenhuma rota em `conversation_links` e nenhuma mensagem nativa com o ID do evento.
Escolher a conversa com mais mensagens ou a mais recente não comprovaria o vínculo.

O procedimento preparado preserva todas as conversas e mensagens antigas. Cria
uma nova conversa para a identidade exata do provedor, sempre `human`, com IA
pausada, associa as chaves interna/plataforma e recoloca somente o evento validado
na fila normal. O worker existente deve então registrar a mensagem e os próximos
eventos dessa identidade. Nenhum envio ou ativação de IA faz parte da recuperação.

O pacote criptografado foi conferido dentro da API existente, com AAD, digest e
escopo de conta/perfil validados pelos mesmos módulos do worker. Foram extraídos
apenas identificadores e metadados necessários; texto, nomes e chaves não foram
impressos nem enviados a outro provedor. A comparação do banco usou transação
somente leitura. Planos e evidências com identificadores ficam fora do Git.

`server/scripts/prepare-conversation-recovery.mjs` gera SQL para revisão. O SQL
exige o banco/owner esperados, os sete checksums, o perfil fixado, a fila sem lease,
o digest/evento/código originais, um único tutor por identidade, ausência de rotas
ou mensagem já recebida e a relação exata de todas as conversas antigas. Divergência
aborta integralmente. Usa o mesmo advisory lock de conta que o worker.

Um ledger privado de manutenção guarda os hashes das conversas antigas e o ID
novo. Não há grant adicional, exclusão ou atualização do histórico. Os hashes
são comparados antes de confirmar e o schema privado bloqueia reaplicação.
Apenas o status do recibo selecionado volta a `pending`; a conclusão e a criação
da mensagem cabem ao worker. Não marcar o evento como processado manualmente.

Antes da aplicação: backup nativo validado, ensaio real terminando em ROLLBACK e
conferência de que nenhuma rota/conversa/schema privado permaneceu. A versão
com COMMIT deve ter núcleo idêntico ao ensaio. Depois: conferir o recibo
processado, uma mensagem com conteúdo/digest original, controles humanos, hashes
dos 18 históricos, ausência de duplicação e estado da fila na interface.

Cinco testes com PostgreSQL isolado cobrem reversão, processamento real pelo
worker, deduplicação, preservação de conteúdo/controles, recusa a conflitos e
bloqueio de replay e proteção de atribuições à equipe. A suíte completa, incluindo
a preparação do VetSoft, passou com 240 testes. A ferramenta não requer mudança no código ou nas permissões do processo publicado.

## Resultado da recuperação

O backup nativo validado anterior à aplicação tem 32.837.599 bytes, modo 600.
O ensaio final na VPS terminou em ROLLBACK, sem ledger ou rota novos; o evento
continuou em conferência. O mesmo núcleo com COMMIT foi aplicado uma única vez.
O worker normal processou o recibo, criou uma mensagem e manteve a conversa nova
com atendimento humano e IA pausada. A integridade do texto original de 206 bytes
foi conferida por SHA-256; o conteúdo não foi exposto no relatório.

Os hashes completos das 18 conversas antigas continuaram iguais. Não houve
exclusão, fusão de históricos, novos grants ou envio de mensagens. O ledger
privado permaneceu inacessível à API. A tela autenticada confirmou zero eventos
pendentes, em processamento ou em conferência (1.437 processados no checkpoint).
O código do worker e os sete schemas versionados não precisaram de alteração.
Não reaplicar o SQL; o ledger de manutenção bloqueia replay.
