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

Na amostra inicial, cinco arquivos (166.424 bytes) foram copiados e conectados
em transação, após backup validado. As 694 referências incluem uma mensagem sem
ID da plataforma; o utilitário usa seu UUID nativo para o arquivo sem criar outra
mensagem. Os testes completos chegaram a 199 aprovações.

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
   inventário não importou mensagens; a cópia de mídias legadas segue o procedimento separado acima.

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
