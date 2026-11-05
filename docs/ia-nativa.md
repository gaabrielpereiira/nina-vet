# Integração nativa de IA — etapa de ensaio

## Decisões do atendimento — 05/11/2026

O núcleo nativo de decisão foi acrescentado aos exemplos existentes, em
`/v1/ai/rehearsals` e na seção **Ensaio do atendimento** de `/nina/testes`.
Há dez cenários fixos: histórico com nomes já informados, preço conhecido,
intervalo incompleto, reagendamento ambíguo, reagendamento identificado,
cancelamento, pedido de humano, possível urgência, pausa e bloqueio.
Nomes, preços, consultas, datas e mensagens são fictícios e definidos no servidor.
O cliente envia somente `case_id`; texto livre, IDs clínicos, configurações e
parâmetros de URL são rejeitados. Somente administradores têm acesso.

O módulo `nina-decision.mjs` contém política de pausa/bloqueio, contexto limitado
a vinte mensagens e validação das decisões. Conversas inativas, arquivadas,
pausadas ou atribuídas à equipe não permitem geração. Flags ausentes também
bloqueiam. Preços desconhecidos ou intervalos incompletos permanecem sem valor,
sem conversão de `null` para zero. A implementação usa os campos nativos
`assigned_user_id`, `assigned_team`, `is_active`, `ai_paused` e `archived_at`.

O Gemini é chamado diretamente pelo endpoint `generateContent`, com ferramentas
de proposta de agendamento, reagendamento, cancelamento e encaminhamento.
Uma ferramenta de resposta comum completa o contrato: `mode: ANY` solicita uma
decisão estruturada, inclusive quando a Nina apenas precisa responder ou perguntar.
As ferramentas de alteração só ficam disponíveis quando há uma única consulta
fictícia identificada; IDs, campos, datas, horários e ações retornados são
validados novamente no servidor. A saída aceita no máximo uma proposta e nunca
é executada. Quando há proposta, a mensagem exibida é composta pelo servidor
para não apresentar a ação como concluída. Respostas truncadas ou inválidas são
rejeitadas. Não há segundo turno automático, retry pago ou executor de ferramentas.

Pausa, bloqueio e a identificação da consulta em pedidos ambíguos de alteração
são conferidos localmente, sem chamar o provedor. Os demais
ensaios usam o mesmo modelo, chave e limites persistidos dos exemplos originais:
três chamadas por minuto, vinte por dia na clínica e dez por administrador.
Os endpoints compartilham os contadores; não há ampliação da cota nem novos
grants ou migrações. O histórico real e as configurações privadas antigas não
são consultados ou enviados ao Google nesta etapa. Os resultados não são salvos
nas conversas nem enviados ao WhatsApp.

Esta entrega é a primeira parte da orquestração, ainda sem equivalência completa
com o sistema antigo. A migração do prompt/configurações reais, memória, escolha
de procedimentos, contexto real, ações na agenda, VetSoft, áudio, envio e rotinas
de análise continua pendente. O atendimento permanece com a equipe/CRM.

Referência do protocolo consultada em 05/11:
[function calling no generateContent](https://ai.google.dev/gemini-api/docs/generate-content/function-calling?hl=en).
O contrato é validado também localmente; o uso de ferramentas pelo modelo não
constitui autorização para executar ações.

## Estado em 03/11/2026

A página está publicada e `AI_TESTS_ENABLED=true` está salvo na API. Os três
exemplos foram executados pela conta de administrador na interface real: consulta
em 1,2 s, valor em 2,9 s e possível urgência em 1,1 s. A conta Gemini respondeu
sem uso do gateway Lovable. Esta validação cobre a conexão e os exemplos fixos;
não comprova equivalência com o orquestrador antigo nem atendimento clínico real.

API publicada: `dbedf0927f3a985868e0b41c0963330bb2ec8b02`.
Interface publicada: `d0558f7826953bdd065ced788947e9e9dcfab4ea`.
Autodeploy desligado em ambos. As primeiras chamadas atingiram o prazo de 15 s;
foi ampliado para 45 s e os três exemplos acima passaram pela interface.
Nenhuma mensagem foi enviada ao WhatsApp.

## Escopo

A página `/nina/testes` permite a administradores conferir três exemplos fictícios:
pedido de consulta, consulta de valor e possível urgência. Nesta etapa, a IA é
usada somente nesse ensaio; o atendimento automático de clientes continua pendente.

A API `GET /v1/ai/tests` lista os exemplos e informa se a conexão está habilitada.
`POST /v1/ai/tests` aceita somente `{ "case_id": "agendamento" }`, `preco` ou
`urgencia`. Campos extras, texto livre, IDs clínicos, modelos, URLs e parâmetros
de consulta são rejeitados. O servidor envia apenas o exemplo escolhido e as
instruções fixas de recepção. A resposta não grava prontuários ou mensagens.

## Configuração

- `AI_TESTS_ENABLED=false` por padrão; habilitar com `true` somente em `nina-api`.
- `GEMINI_API_KEY` fica no ambiente do servidor, fora do Git e do navegador.
- Provedor direto: Google Gemini, modelo `gemini-3.5-flash-lite`.
- Endpoint fixo HTTPS `generativelanguage.googleapis.com`, sem redirecionamentos.
- Chave no header `x-goog-api-key`; nenhuma chave em URL, log ou resposta pública.
- Uma chamada por teste, sem retries automáticos; até 512 tokens de saída e
  45 segundos de espera. Saídas truncadas, bloqueadas ou inválidas não são exibidas.
- Limites persistidos no PostgreSQL: três tentativas por minuto na clínica;
  vinte por dia na clínica e dez por administrador. As janelas diárias usam UTC.
  Falhas do provedor também consomem tentativas. Esses limites controlam chamadas,
  não substituem o orçamento/configuração de cobrança da conta Google.
- Falhas registram somente categoria, código HTTP e duração; sem chave, prompts
  ou respostas. O prazo foi ampliado após timeouts observados no teste da VPS.

A ativação não requer nova migração nem grants adicionais. Reutiliza somente a
sessão e as permissões existentes da API. Para desligar os testes, definir
`AI_TESTS_ENABLED=false` e publicar novamente apenas a API. Login, recuperação
por e-mail e edição clínica são independentes dessa opção.

## Validação

A suíte completa passou com 130 testes, incluindo permissões, origem exata,
revogação de sessões, quotas, restrição dos dados enviados, respostas malformadas,
timeout e proteção dos segredos. Typecheck e build passaram. A interface foi
exercitada localmente com usuário fictício e provedor simulado. A chave e a disponibilidade do modelo foram depois confirmadas na VPS e os
três exemplos acima responderam pela interface real.

Para futuras publicações, usar API e interface a partir da branch `codex/postgres-backend`, mantendo
os autodeploys desligados. Conferir HTTPS, `/readyz`, rejeição anônima e um teste
fictício autenticado; registrar o resultado real antes de considerar esta etapa
ativada. Não habilitar callbacks ou workers de envio como parte deste ensaio.

## Próximas partes da migração

1. Conferir a conta e a conexão do WhatsApp/Zernio e preparar recebimento seguro,
   fila e envio manual com destinatário de teste autorizado.
2. Migrar as regras e configurações reais da Nina, o contexto do atendimento e
   as ações permitidas; validar antes de conectar IA a conversas reais.
3. Portar transcrição, mídias, VetSoft, automações, atualização de conversas e
   gestão da equipe. Testar cada fluxo na VPS.
4. Remover código/SDKs antigos depois da equivalência dos fluxos e aplicar a
   identidade Vet+ quando os arquivos da marca estiverem disponíveis.

Referências consultadas em 03/11/2026: [generateContent](https://aistudio.google.com/api-reference/generate-content/generate-content),
[modelo](https://aistudio.google.com/docs/models/gemini-3.5-flash-lite),
[preços e uso de dados por plano](https://aistudio.google.com/docs/pricing).
Antes de usar dados reais, conferir o plano e as condições da conta Google.

## Publicação e validação real desta etapa — 05/11/2026

API e interface publicadas no commit
`7cdbd9cea1f0a234c07fdf2d7f03ead4cf79d7f8`, pela branch
`codex/zernio-message-processing`, com autodeploy desligado. A suíte passou com
217 testes, typecheck e build. Migrations, grants, recepção e escrita clínica
não foram alterados. `healthz`/`readyz` responderam 200; o endpoint de ensaio
sem autenticação respondeu 401; a interface respondeu 200.

Pela conta administrativa existente na tela real, foram conferidos pausa,
bloqueio, encaminhamento para a equipe e proposta de horário com nomes do
histórico fictício. Duas chamadas ao provedor para o pedido ambíguo atingiram
45 s (`TIMEOUT`, sem diagnóstico privado ou retry automático). O pedido de
identificação passou a ser uma regra local anterior ao provedor. O contrato de
resposta comum também passou a utilizar decisão estruturada. Esses ajustes não
comprovam a causa dos timeouts do provedor.

Na versão final, a conferência pela tela confirmou:

- Preço fictício conhecido: R$ 120,00, resposta em 1,0 s.
- Intervalo incompleto: resposta sob consulta, em 1,6 s.
- Proposta para Luna em 10/11 às 14h, em 0,9 s, sem executar reserva.
- Pedido ambíguo: pergunta qual das duas consultas alterar, sem chamar a IA.

Foram sete chamadas reais nesta etapa (cinco respostas e dois timeouts), todas
com dados fictícios. Não houve envio de dados clínicos reais ao Gemini, mensagens
ao WhatsApp, reserva de horário ou gravação de resultados em conversas. Os dez
cenários estão disponíveis, mas nem todos foram executados contra o provedor
real nesta conferência. Os testes automatizados usam provedores simulados.

Após as publicações, a tela do WhatsApp mostrou recebimento e histórico ligados,
arquivos privados disponíveis e zero pendências (842 eventos registrados naquele
checkpoint). Configurações reais antigas, ações e integrações continuam pendentes.
