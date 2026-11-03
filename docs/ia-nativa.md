# Integração nativa de IA — etapa de ensaio

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

## Validação antes da publicação

A suíte completa passou com 130 testes, incluindo permissões, origem exata,
revogação de sessões, quotas, restrição dos dados enviados, respostas malformadas,
timeout e proteção dos segredos. Typecheck e build passaram. A interface foi
exercitada localmente com usuário fictício e provedor simulado. Isso ainda não
comprova a chave Google, a cota ou a disponibilidade do modelo na conta real.

Publicar API e interface a partir da branch `codex/postgres-backend`, mantendo
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
