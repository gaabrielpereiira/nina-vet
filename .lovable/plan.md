# Sincronização automática do VetSoft

## O que vai acontecer

A cada 6 horas o sistema se conecta sozinho ao VetSoft e atualiza três áreas:

- **Procedimentos e valores** — novos itens entram e preços mudados são atualizados automaticamente. Descrição, duração e observações escritas à mão continuam intactas.
- **Contatos (tutores) e pets** — tutores novos são criados, dados atualizados, e os pets ligados a cada tutor são trazidos. Nada é excluído; notas e tags escritas por aqui são preservadas.
- **Agenda** — agendamentos de hoje até 30 dias à frente, já vinculados ao tutor e ao pet. Agendamentos criados dentro da Nina nunca são alterados.

Rodar de novo só atualiza o que mudou, sem duplicar.

## Onde você acompanha

Em Configurações, um painel "Sincronização VetSoft" mostra:

- data e hora da última sincronização de cada área;
- quantos itens entraram/foram atualizados;
- se houve falha (por exemplo, bloqueio temporário do VetSoft), com a mensagem do erro;
- um botão "Sincronizar agora" para rodar na hora, sem esperar o próximo horário.

Se o VetSoft bloquear temporariamente o acesso, a rodada registra o erro e a próxima tentativa acontece no ciclo seguinte — nada fica pela metade nem duplicado.

Frequência escolhida: a cada 6 horas, ou seja 4 vezes por dia. É um bom equilíbrio: mantém tudo atualizado sem manter o banco ativo o tempo todo, o que aumentaria o custo. O atraso máximo entre uma mudança no VetSoft e ela aparecer aqui é de cerca de 6 horas.

## Detalhes técnicos

**Banco**
- Nova tabela `vetsoft_sync_runs`: `area` ('procedures' | 'clients' | 'pets' | 'agenda'), `status`, `started_at`, `finished_at`, `created`, `updated`, `skipped`, `error`, `triggered_by` ('cron' | 'manual'). RLS: leitura para `authenticated`, escrita apenas `service_role` (GRANTs explícitos).
- Extensões `pg_cron` e `pg_net` habilitadas; job `vetsoft-auto-sync` com cadência `0 */6 * * *` chamando a função via `net.http_post` (SQL executado com run_sql, não migration, por conter URL/chave do projeto).

**Edge function nova: `vetsoft-auto-sync`**
- Aceita chamada do cron (sem JWT de usuário) ou manual (com JWT). Usa service role.
- Resolve um `user_id` de dono: primeiro `user_roles` com role `admin`, senão o primeiro perfil existente — necessário para gravar `appointments`/`deals`.
- Executa em sequência, cada etapa protegida por try/catch e registrada em `vetsoft_sync_runs`:
  1. catálogo → reaproveita `listCatalog` + a lógica de `applyItems` de `vetsoft-import-procedures` (extraída para `_shared/`), aplicando todos os itens automaticamente;
  2. tutores → `listTutors` + `applyTutors` de `vetsoft-import-clients` (também extraído para `_shared/`);
  3. pets → `syncPetsOnly`;
  4. agenda → mesma lógica de `vetsoft-import-agenda` com `from = hoje`, `to = hoje + 30`.
- Login VetSoft feito uma vez (`getVetsoftAccessToken`) e reutilizado; erro de login encerra a rodada com status `failed` nas etapas restantes.
- Para não bater no limite de 150s da função, cada etapa é disparada em subrequisição própria (`fetch` para a função de importação correspondente com a chave de serviço), mantendo os lotes de 200 já existentes.

**Refactor**
- Mover `applyItems` (procedures) e `applyTutors`/`syncPetsOnly` (clients) e o corpo de sincronia da agenda para `supabase/functions/_shared/vetsoft-sync.ts`, para que as funções manuais e a automática compartilhem exatamente o mesmo código.

**Frontend**
- `src/hooks/useVetsoftSyncStatus.ts`: lê `vetsoft_sync_runs` (última rodada por área) e invoca `vetsoft-auto-sync` no modo manual.
- Novo card `src/components/settings/VetsoftSyncStatus.tsx` em `Settings.tsx`, com status por área e botão "Sincronizar agora".
- Botões manuais atuais (Procedimentos, Contatos, Importar pets, Sincronizar VetSoft na Agenda) continuam funcionando.
