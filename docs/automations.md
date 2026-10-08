# Automações da Nina

Módulo portado de `gaabrielpereiira/sdrgrazing`, commit
`60eeb14ced993fe41309029b9861b6d60b4c92a4`, e adaptado ao CRM, permissões,
configurações e envio via Zernio da Nina. Nenhuma credencial, configuração de
projeto ou prompt do repositório de origem foi importado.

## Recursos

- Menu **Automações** em `/automations`: regras, painel, eventos e histórico.
- Gatilhos WooCommerce de pedidos, clientes e produtos; negócio ganho no pipeline.
- Filtros AND/OR, comparações, mudança de valor e primeiro pedido.
- Ações de template WhatsApp, tags/etapa do CRM, notificação interna e webhook externo.
- Intervalo por contato/regra, execução com atraso e cancelamento quando o pedido
  muda de status ou o negócio deixa de estar ganho.
- Sincronização dos templates WhatsApp aprovados, notificações no menu e link para a conversa.
- Simulador: por padrão apenas testa regras e registra os resultados. A opção
  **Executar ações reais** precisa ser marcada para enviar ou modificar dados.

Administradores gerenciam regras, simulam/reprocessam eventos e sincronizam
templates. A equipe autenticada consulta os dados. As notificações são
compartilhadas pela clínica, como no módulo de origem.

## Instalação no projeto Supabase da Nina

1. Aplicar `drizzle/migrations/0000_import_automations_module.sql`.
   Ela cria as tabelas, índices, RLS, publicação Realtime e o gatilho de negócio ganho.
2. Publicar `automation-runner`, `automation-scheduler`, `wc-receiver`,
   `simulate-wc-webhook`, `webhook-cleanup` e `sync-whatsapp-templates`.
   Publicar também as versões atualizadas de `whatsapp-sender` e `nina-orchestrator`.
3. Manter os agendamentos existentes do sender/orchestrator. Habilitar `pg_cron`
   e `pg_net`, criar os dois segredos indicados em
   `supabase/setup/automations-cron.sql` no Vault e executar esse script.
   Runner e scheduler rodam a cada minuto; a limpeza roda diariamente às 06h UTC.
4. Publicar o frontend. Em Automações, definir o segredo WooCommerce e cadastrar
   no WooCommerce a URL exibida e o mesmo segredo para assinar os webhooks.
5. Configurar a conta e chave Zernio nas configurações já existentes da Nina.
   No formulário da automação, sincronizar e selecionar um template aprovado.
6. Testar primeiro pelo simulador, sem marcar execução real. Conferir evento,
   condições e histórico antes de ativar uma regra que envia mensagens.

Os workers usam as variáveis nativas `SUPABASE_URL` e
`SUPABASE_SERVICE_ROLE_KEY`. Apesar de `verify_jwt=false`, há autenticação
explícita: chave de serviço ou usuário administrador. O receiver WooCommerce
valida HMAC-SHA256 do corpo original. O navegador nunca recebe a chave de serviço.

## Comportamento de envio

A chave geral de atendimento humano bloqueia as respostas da Nina e os envios
WhatsApp das automações, inclusive atrasados. Conversas em atendimento humano,
com IA pausada ou arquivadas também bloqueiam envio automático. As demais ações
de CRM, notificações e webhooks continuam disponíveis. Envios bloqueados são
registrados como ignorados; reativar a Nina não os dispara retroativamente.

O runner enfileira mensagens no sender existente. Um log de sucesso de
enfileiramento não confirma entrega ao WhatsApp: acompanhar também `send_queue`.
O sender verifica novamente a chave geral imediatamente antes do envio.
Templates usam `templateName`, `templateLanguage` e `templateParams` da API
Zernio, em vez de enviar o texto de prévia como mensagem comum.
O editor herdado suporta variáveis posicionais no corpo do template; templates
que exigem parâmetros de mídia/cabeçalho ou botões dinâmicos precisam de extensão.

Eventos repetidos são deduplicados e há proteção contra processamento
concorrente. Falhas liberam a regra para nova tentativa com backoff. Como em
qualquer integração externa, uma interrupção depois da execução remota e antes
da confirmação local pode repetir uma ação; endpoints de webhook devem aceitar
idempotência. Eventos são retidos por 90 dias e logs por 30 dias.

## Verificação local

Executar `npm test`, `npm run typecheck` e `npm run build`.
Os testes usam PostgreSQL isolado via PGlite para executar a migração, RLS,
gatilhos e processadores reais. Os testes do sender usam transporte simulado.
Nenhum teste envia mensagens ou altera o banco de produção.
O fluxo visual de criação foi conferido com os componentes reais e dados de teste.

A aplicação da migração, publicação das funções e instalação dos agendamentos
no ambiente remoto são etapas separadas; a implementação local não as executa.

Referências da adaptação: [templates WhatsApp da Zernio](https://docs.zernio.com/platforms/whatsapp/templates)
e [agendamento de funções no Supabase](https://supabase.com/docs/guides/functions/schedule-functions).
