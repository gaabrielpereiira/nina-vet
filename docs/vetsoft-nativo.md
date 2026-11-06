# VetSoft nativo — conferência de conexão

A API nativa tem uma etapa administrativa de conexão somente para consulta,
desligada por padrão. Não usa Supabase, SDK externo, fila de envio ou gateway
Lovable. Não importa pacientes nem altera agenda. A página de configurações
mostra a preparação e, após ativação explícita, permite iniciar a conferência.

`GET /v1/integrations/vetsoft` retorna apenas o estado da preparação e as
capacidades desativadas. `POST /v1/integrations/vetsoft/check` aceita somente
`{}`, exige administrador ativo e a origem exata da interface. O servidor faz
um `POST https://api.vetsoft.com.br/login` com email/senha e `X-Tenant`, seguido
de um `GET /service-types?per_page=5&status=active` com o Bearer recebido. Cinco
é o mínimo documentado para essa página. Não são consultados cadastros clínicos.

O navegador não escolhe URL, clínica, credencial, filtros ou dados a importar.
Recebe somente sucesso/erro, horário da conferência e tamanho da amostra; nomes,
respostas brutas, senhas e tokens não saem pelo endpoint. Respostas e leituras
de corpo têm limite de 64 KiB e prazo compartilhado de 15 s. Não há redirects,
retry automático, renovação ou persistência de tokens nesta etapa. Links de
paginação recebidos são ignorados. O token existe apenas durante a conferência.

O limite local é de três tentativas por clínica/administrador em 15 minutos,
dez por dia na clínica e cinco por administrador. Falhas também consomem cota.
A documentação de autenticação informa limite de cinco tentativas em 15 minutos;
o cliente nativo fica abaixo dele, sem substituir a limitação da conta no provedor.
Falhas de autenticação no VetSoft não encerram a sessão da Nina. Logs contêm
somente etapa, código, status HTTP e duração.

## Ativação

As variáveis ficam somente no ambiente da `nina-api`:

- `VETSOFT_READ_ONLY_ENABLED=false` por padrão; `true` após autorização explícita.
- `VETSOFT_TENANT`: identificador de clínica da API.
- `VETSOFT_EMAIL`: conta de acesso à API.
- `VETSOFT_PASSWORD_BASE64`: senha UTF-8 codificada em base64 para preservar
  caracteres ao copiar no ambiente. Base64 não é criptografia; continua sendo
  segredo e não pode ser incluído em Git, navegador, logs ou chat.

Sem ativação, nenhuma credencial é necessária e nenhuma chamada é feita ao
VetSoft. Esta entrega não amplia grants ou migrations. As credenciais devem
ser preenchidas pessoalmente no Dokploy e a conexão testada depois da
autorização. A versão da API e da interface é publicada primeiro desativada.
O teste com provedor simulado não comprova o acesso real da conta da clínica.

## Contrato consultado

A documentação pública não pôde ser lida pela ferramenta de pesquisa, mas foi
conferida diretamente no Chrome, sem login ou execução de `Try It`:

- [Autenticação](https://vetsoft.readme.io/reference/authlogin): `email`,
  `password`, header `X-Tenant`; resposta com `access_token`, `token_type`,
  `expires_in` e `refresh_token`.
- [Tipos de atendimento](https://vetsoft.readme.io/reference/indexservicetypes):
  paginação de 5 a 100, estado `active`, resposta em `data`.
- [Modelo e segurança](https://vetsoft.readme.io/reference/bem-vindo).

Foi usado somente o contrato desses dois endpoints. Não há implementação de
criação/edição de tutores, animais, agenda, cancelamentos ou sincronização
automática nesta entrega. A política da Vet+ mantém agendamentos com a equipe.
As próximas partes precisam preservar IDs externos, paginação completa, controles
humanos e alterações nativas, evitando as duplicações encontradas na origem.
