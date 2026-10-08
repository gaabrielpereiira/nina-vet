# Chave geral de atendimento da Nina

A chave fica no topo da lista de Conversas e em Configurações do Agente.
Administradores podem alternar entre **Nina automática** e **Somente humanos**.
O estado é salvo imediatamente, sem depender do botão Salvar das configurações.
Todos os operadores veem o estado; outras sessões o atualizam a cada 5 segundos
ou ao voltar à janela.

Esta instalação é single-tenant. A configuração compartilhada é o primeiro
registro de `nina_settings`, ordenado por `created_at` e `id`, tanto na interface
quanto nas verificações do backend. A chave utiliza os campos existentes
`is_active` e `auto_response_enabled`; não requer alteração de schema.

Ao desligar, todas as conversas atuais e novas ficam disponíveis para atendimento
humano. Não são alterados os estados individuais das conversas. Ao religar, as
conversas pausadas, arquivadas ou assumidas por humanos continuam protegidas.
Os filtros e indicadores da tela mostram o modo efetivo durante a pausa geral.

O orquestrador consulta a chave antes de iniciar cada item. O sender consulta
novamente imediatamente antes do envio de cada texto, áudio ou trecho de
resposta. Respostas automáticas bloqueadas recebem status `failed` na fila,
sem reagendamento automático. Mensagens humanas continuam sendo enviadas.
Uma requisição já enviada ao provedor de WhatsApp não pode ser recolhida.
Itens que ainda não chegaram ao sender poderão ser enviados se a Nina for
reativada antes de serem processados; a chave não apaga as filas.

## Validação

```sh
npm ci
npm run build
npx tsc --noEmit
node --test tests/nina-automation.test.mjs
```

Os testes executam a função real de envio com banco e transporte simulados:
pausa, reativação, áudio, atendimento humano, pausas individuais, arquivamento,
falha na consulta e releitura da chave entre trechos.

## Publicação

Publicar o frontend e as Edge Functions `nina-orchestrator` e `whatsapp-sender`
com o arquivo compartilhado `_shared/nina-automation.ts`. A publicação apenas
do frontend não garante o bloqueio das respostas que já estão na fila.

Depois da publicação, validar com uma conta de administrador e um contato de
teste: desligar a chave, receber uma mensagem de WhatsApp, responder manualmente,
religar e verificar uma nova resposta automática. Validar também uma conversa
pausada individualmente. Nenhuma mensagem real é enviada pelos testes locais.
