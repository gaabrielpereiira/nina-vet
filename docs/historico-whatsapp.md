# Recuperação do histórico do WhatsApp

## Levantamento em 04/11/2026

O recebimento passivo na VPS já está publicado e validado; veja
[whatsapp-processamento.md](whatsapp-processamento.md). A branch
`codex/zernio-history-migration` prepara a recuperação dos dados anteriores à
ativação, preservando as gravações clínicas feitas na VPS e o atendimento atual.

Uma consulta autenticada de leitura ao Zernio retornou HTTP 200 e confirmou
conta/plataforma, sem falhas de contas. O inventário completo percorreu nove
páginas: 719 conversas ativas, nenhuma arquivada. Dessas, 260 têm atualização
desde o dia do backup. Nenhuma apresentou data desconhecida ou duplicação entre
páginas. O levantamento foi iniciado em 04/11 às 22:28 UTC; as contagens são uma
fotografia desse momento.

O início conservador é `2026-10-22T03:00:00Z` (00h do dia 22 no fuso de São Paulo),
para incluir todo o dia do backup. A quantidade de mensagens a recuperar deve
ser calculada por identificador da plataforma, com sobreposição à cópia já
existente e ao recebimento ativo. Os 260 itens representam conversas atualizadas.

O código antigo contém a rotina `persistIncomingMedia`, que copiava a primeira
mídia de cada mensagem para o bucket `audio-messages` e guardava o URL em
`messages.media_url`. O banco já importado na VPS tem 694 referências desse
Storage. Essas cópias devem ser conferidas como fonte das mídias antigas, em
conjunto com o histórico mais recente. O código anterior tratava apenas o
primeiro anexo; o receptor novo preserva todos os anexos do evento.

## Comando de inventário

Executar somente no servidor, usando o ambiente privado já configurado da API:

```sh
NINA_HISTORY_SINCE=2026-10-22T03:00:00Z node server/scripts/inventory-zernio-history.mjs
```

O script faz apenas GETs ao endpoint de conversas do Zernio. Consulta status
ativo e arquivado, fixa conta/perfil/WhatsApp, pede até 100 itens por página e
repassa o cursor opaco do provedor. O limite de 30 requisições impede varredura
ilimitada. Resultado parcial, conta/plataforma divergente, cursor ausente ou
repetido, erro HTTP e limite de páginas interrompem a execução sem declarar
sucesso. Datas de atualização desconhecidas entram na conferência.

A saída contém contagens e datas. Nomes, telefones, corpos, URLs de arquivos,
chaves e cursores não são registrados. A função interna devolve somente IDs e
datas das conversas candidatas; a CLI imprime apenas o resumo. Não grava banco,
não baixa mídias, não envia mensagens, não marca conversas como lidas e não
altera quem atende. A documentação do endpoint de mensagens confirma que a
leitura por GET não marca mensagens como lidas nem envia recibos.

## Cópia das mídias já referenciadas no banco

`server/scripts/copy-legacy-media.mjs` prepara arquivos e metadados; a aplicação
no banco é uma etapa separada de manutenção, após backup completo verificado.
O download usa a conta limitada da API apenas para leitura do banco e reutiliza
o arquivo privado existente (HTTPS/DNS verificados, tamanho limitado, diretório
700, arquivos 600, integridade e cache imutável). O projeto e o bucket públicos
antigos ficam fixados explicitamente por `NINA_LEGACY_STORAGE_ORIGIN`; nenhuma
chave Supabase é usada e a chave Zernio não é enviada ao Storage.

Começar com uma amostra pequena:

```sh
NINA_LEGACY_STORAGE_ORIGIN=https://PROJECT_REF.supabase.co NINA_LEGACY_LIMIT=5 node server/scripts/copy-legacy-media.mjs
```

A origem deve corresponder ao projeto antigo conhecido, sem barra final. O
limite aceita de 1 a 5.000 mensagens. Um arquivo de origem com todos os URLs de
restauração fica criptografado em `source-plan.enc`, dentro do volume privado,
com subchave HKDF da chave já derivada da fila. Não trocar a raiz de criptografia.
O manifesto de aplicação contém somente identificadores, tipos, tamanhos e
digests. O SQL não contém nomes, corpos, telefones nem URLs originais.

O SQL só é preparado se todos os arquivos da seleção forem copiados. Sua
transação exige dono de manutenção, banco `nina`, seis checksums exatos, conta
fixada, registros existentes e valores de origem ainda correspondentes. Usa a
mesma trava de conta do processador; referências ou arquivos conflitantes abortam
a transação. A atualização cria os vínculos de arquivo e troca somente
`media_url`/`media_type`. Não concede acesso novo à API e não modifica conteúdo,
autoria, notas ou estado das conversas. A mesma aplicação é idempotente.

Os arquivos antigos ficam na origem até a conferência final. Uma nova execução
seleciona apenas referências que ainda apontam ao Storage; cópias completas em
cache são verificadas e reutilizadas. Não registrar falhas como concluídas, não
apagar a origem e não apresentar a cópia como recuperação de anexos que o sistema
antigo nunca guardou.

Em 04/11, a amostra de cinco arquivos (166.424 bytes) e o lote restante de 689
arquivos (293.052.483 bytes) foram copiados e conectados em transações separadas,
cada uma após backup PostgreSQL com leitura integral validada. Os 694 arquivos
passaram na comparação de SHA-256/tamanho e na leitura privada por intervalo.
A consulta final encontrou zero referências ao Storage antigo nas mensagens já
importadas. O acesso anônimo a um arquivo recuperado retornou HTTP 401.

As 694 referências incluem uma mensagem sem ID da plataforma; o utilitário usa
seu UUID nativo para o arquivo sem criar outra mensagem. O lote restante tem 297
imagens. Nenhum arquivo da origem foi excluído. Os testes completos chegaram a
199 aprovações. Na conferência posterior da interface, o receptor estava ligado,
com 216 eventos registrados e zero pendentes, em processamento ou para revisão.
Essas contagens são um retrato da verificação, não um total permanente.

## Diferença confirmada no banco de origem

Uma consulta `SELECT count(*)` pelo editor SQL do Lovable, sem gravações, confirmou
123.041 animais, 44.505 agendamentos, 3.256 contatos, 437 conversas, 15.077 mensagens
e 919 procedimentos. São contagens superiores às do backup de 22/10. A origem
continuou acumulando dados; isso não comprova qual integração foi responsável.

A nova exportação completa foi autorizada, gerada no Storage privado e baixada.
O arquivo custom format tem 9.497.867 bytes, SHA-256
`07965688f11ed0433e877afb72be7fd4f83c37664e458200b1baa6a287fc2f3f`.
A extração integral contém 85 blocos COPY e 202.617 linhas. As seis tabelas
clínicas mantêm as colunas esperadas e não têm referências clínicas órfãs.
O snapshot tem 3.257 contatos, 438 conversas e 15.119 mensagens; as demais
contagens coincidem com a consulta anterior. A origem continua recebendo dados.

A comparação por identidade com a VPS encontrou, no checkpoint, 212 contatos e
7.730 mensagens da origem ainda ausentes. Identificou 8 contatos e 215 mensagens
já presentes pela recepção ativa; um contato e duas mensagens nativos não estão
nesse snapshot da origem e precisam ser preservados. A comparação usa o backup
original importado e os registros criados desde a ativação. Contagens mudam; a
mesclagem deverá deduplicar novamente dentro da transação.

Os conjuntos exatos de IDs VetSoft da VPS e da origem apontam 115 novos IDs de
animais, 244 de agendamentos e 4 de procedimentos. O crescimento em UUIDs de linha
é muito maior: a origem tem 123.041 animais para 1.906 IDs VetSoft distintos,
com 121.134 repetições dentro do mesmo tutor. Os 44.505 agendamentos têm 1.541
IDs VetSoft distintos. Há duplicações também no backup inicial e já importadas.
Não tratar cada novo UUID como outra entidade, nem consolidar ou apagar registros
sem conferir notas, alterações e referências. Um ID de animal aparece com tutores
diferentes e exige tratamento explícito. O código antigo consulta registros
existentes sem paginação antes de inserir; o limite de consulta é uma hipótese
compatível com o padrão observado, ainda não reproduzida.

O inventário comparou IDs e a serialização das linhas, não resolveu conflitos de
valores tipados por campo. A recepção segue ativa e o banco da VPS não foi
alterado nesta análise. O relatório operacional privado guarda contagens e
checksums; os dumps permanecem fora do repositório, com diretório 700/arquivos600.
A próxima etapa depende da transferência privada do backup para staging e da
reconciliação, preservando senhas, notas, mídia privada, atendimento humano e
registros exclusivos da VPS. A recuperação das 694 mídias cobre referências já
importadas e não substitui a recuperação das mensagens e anexos adicionais.

## Preparação da recuperação

1. Conferir a relação entre os IDs do REST do Zernio, os IDs da plataforma já
   salvos e os vínculos de conversas. Preservar autoria desconhecida como externa.
2. Separar mensagens que faltam e anexos antigos ainda referenciados pelo
   Storage. Conferir disponibilidade, limites de tamanho e integridade.
3. Preparar cópia privada e um manifesto de migração com identificadores e
   digests; manter texto e arquivos clínicos dentro da VPS. Contabilizar falhas
   para conferência explícita.
4. Fazer novo backup validado antes da aplicação. Usar transações, comparação
   dos valores de origem e deduplicação por mensagem/posição. Preservar notas,
   identidades, status humano/pausado/arquivado e alterações feitas na VPS.
5. Conferir registros e arquivos pelo acesso autenticado da Nina antes de
   aposentar qualquer origem. A recuperação ainda está em preparação; o
   inventário não importou mensagens; as 694 mídias legadas já importadas foram copiadas e conferidas conforme o registro acima.

## Verificação

Seis testes com dados fictícios cobrem paginação ativa/arquivada, fronteira de
datas, datas desconhecidas, deduplicação, isolamento de conta/plataforma,
respostas parciais, ciclos/ausência de cursor, limites e erros sem exposição de
conteúdo. O inventário foi depois exercitado na VPS com somente leituras.

Referências primárias:
[conversas](https://docs.zernio.com/messages/list-inbox-conversations),
[mensagens e estado de leitura](https://docs.zernio.com/messages/get-inbox-conversation-messages),
[download de mídias no Zernio](https://docs.zernio.com/whatsapp/get-whatsapp-media),
[Storage e URLs públicas](https://supabase.com/docs/guides/storage/serving/downloads).

## Transferência e comparação tipada na VPS — 05/11

O upload pelo formulário do Dokploy falhou com `spawn E2BIG`; a cópia foi
concluída pelo terminal autenticado, em fluxo de blocos com eco desligado, após
teste sintético e com SHA-256/tamanho conferidos. O arquivo está em diretório
privado (700), com modo 600, e passou na leitura integral pelo `pg_restore` 17.11
para `/dev/null`, sem restauração sobre o banco em uso.

Depois de novo backup nativo validado, foram carregados somente os seis blocos
COPY clínicos validados em dois schemas de análise: `nina_source_20261022`
(125.174 linhas) e `nina_source_20261104` (187.279). Os tipos vieram das tabelas
nativas confiáveis; nenhum DDL, auth, job, papel ou segredo original foi executado.
Os seis checksums de migração, as contagens e a ausência de acesso da API aos
schemas e tabelas foram conferidos dentro das transações. As tabelas clínicas
em uso continuam intactas.

A comparação tipada em transação somente leitura encontrou, nesse checkpoint,
209 contatos e 7.730 mensagens ainda ausentes, com 910 anexos no Storage antigo.
Os novos IDs distintos VetSoft seguem em 115 animais, 244 agendamentos e
4 procedimentos. Não há conflitos de identidade de contatos nem versões finais
empatadas e divergentes nesses grupos de entidades novas. Há 33 preços alterados
na origem; a versão nativa desses campos continua igual ao backup inicial.
A atividade de 22 contatos/conversas já avançou na VPS e deverá ser preservada.
A análise não aplicou mudanças clínicas, não consolidou duplicações nem ativou
respostas. `healthz`/`readyz` retornaram `ok`/`ready`.

A próxima etapa é preparar a mesclagem guardada e a cópia dos 910 anexos antes
de publicar os registros adicionais. As contagens mudam com o atendimento ativo;
revalidar as identidades na transação final.

## Histórico adicional publicado e verificado — 05/11

A etapa descrita acima foi concluída. Os 910 anexos adicionais foram copiados
para o volume privado da VPS (280.934.443 bytes, nenhuma falha), com tamanho e
SHA-256 conferidos. O plano de origem ficou criptografado e o manifesto privado
foi validado antes de vincular os arquivos às mensagens.

Antes da publicação, um backup nativo foi restaurado de fato em banco isolado,
com conexão da API negada. A restauração verificou schema e dados; não restaurou
ACLs. A mesclagem completa também foi executada contra o banco ativo terminando
em `ROLLBACK`, seguida de novo backup integral validado. A versão final utilizou
o mesmo núcleo SQL e terminou em `COMMIT`, com deduplicação e comparação de
alterações refeitas sob bloqueios na própria transação.

Foram inseridos 208 contatos, 115 animais, 244 agendamentos, 4 procedimentos,
149 conversas e 7.730 mensagens. Foram atualizados 146 agendamentos, 33 preços,
34 recibos monotônicos de mensagens e somente a atividade de 57 contatos e
77 conversas. As alterações nativas, os registros exclusivos da VPS e as
duplicações preexistentes foram preservados. As novas conversas permanecem com
atendimento humano e IA pausada. Não houve exclusão, novos grants ou envio de
mensagens. O ledger privado `nina_delta_20261104` impede reaplicação.

Após o commit, os 910 descritores e leituras privadas parciais foram conferidos
pelo handler de arquivos com identidade administrativa existente. Quatro
amostras também passaram com identidade da equipe sem administração. Esses
testes operacionais não criaram sessões de login. O acesso HTTP anônimo a um
arquivo real retornou 401 e `healthz`/`readyz` retornaram 200. As referências de
mídia de mensagens e fotos de perfil ao Storage de origem ficaram em zero.
Os seis testes locais de mídia legada também passaram.

A tela autenticada do WhatsApp confirmou recebimento e registro ligados,
arquivos privados disponíveis e zero eventos aguardando, em processamento ou
precisando de conferência (644 registrados naquele checkpoint). O recebimento
prosseguiu durante e depois da importação. Não foi aberta individualmente uma
conversa histórica e seu anexo pelo navegador nesta conferência.

Os backups, o banco de restauração e as origens continuam preservados. A migração
completa ainda depende da orquestração de IA, integrações restantes, operação de
backup externo e demais recursos do produto. Não desativar Lovable/Supabase com
base somente na conclusão deste histórico.
