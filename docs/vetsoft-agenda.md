# Paciente, tutor e procedimento no calendário

A sincronização `vetsoft-import-agenda` preserva os nomes do paciente, tutor e
procedimento em `appointments.metadata.vetsoft`, com `source: "vetsoft"`.
O título original permanece salvo. Não há alteração no esquema do banco.

O normalizador aceita nomes nos campos diretos ou nos objetos aninhados de
animal, tutor, serviço e tipo de atendimento, incluindo listas de procedimentos.
Quando a agenda só devolve IDs, a importação usa os registros já importados;
se necessário, consulta as listagens de pets/tutores e tipos de atendimento.
Uma falha nessas consultas complementares gera aviso sem descartar a agenda ou
apagar nomes previamente sincronizados. Não são criados contatos fictícios.

No calendário mensal, semanal e diário, eventos do VetSoft mostram
**paciente • tutor**, com o procedimento abaixo quando disponível. Ao clicar ou
ativar o evento pelo teclado, os detalhes mostram paciente, tutor, procedimento,
data, horário, título original e observações. Nomes recebidos da agenda têm
prioridade sobre apelidos locais. Agendamentos manuais mantêm seus títulos.

Para disponibilizar a mudança, publicar o frontend e a função
`vetsoft-import-agenda` (incluindo `_shared/vetsoft.ts`). Depois, usar
**Sincronizar VetSoft** no calendário para preencher os novos dados dos eventos
existentes no intervalo sincronizado. Caso o VetSoft não devolva o procedimento,
a tela informa **Não informado pelo VetSoft**, sem deduzi-lo do nome do evento.

Verificação: `npm test`, `npm run typecheck`, `npm run build`. Há teste com
PostgreSQL isolado para inserção/atualização, preservação de metadata e proteção
de agendamentos manuais; a conferência visual usa dados fictícios.
