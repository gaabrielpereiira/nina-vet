# WhatsApp na VPS — processamento passivo e arquivos privados

## Estado confirmado em 04/11/2026

A etapa foi publicada com autorização explícita na VPS. API e frontend executam
`2fb7cf86557dbe45225147ca35df9c0345f98c56`, da branch
`codex/zernio-message-processing`, com autodeploy desligado. A migração 0006 e os
grants foram aplicados em uma transação após backup completo, cuja leitura
integral foi verificada sem restaurar dados. O banco agora tem seis migrações.

O volume privado `/app/media` foi conferido com UID 1000 e modo 700. Uma prova
sintética permaneceu após recriar o container; o marcador de inicialização foi
criado somente depois dessa verificação. Recebimento, processamento e arquivos
estão ligados. As cinco funções pertencem ao papel NOLOGIN, sem EXECUTE público;
a conexão real `nina_app` não pode assumir esse papel nem ler ciphertext direto.

O usuário criou a assinatura **Nina VPS - Recebimento**, com os cinco eventos de
mensagens e filtro da conta/perfil corretos. O segredo foi preenchido e submetido
pelo usuário; o teste assinado do próprio Zernio retornou HTTP 200/sucesso. As
assinaturas anteriores e o atendimento da equipe/CRM foram preservados.

Uma mensagem e uma imagem de teste enviadas pelo usuário chegaram ao histórico.
A imagem abriu no navegador autenticado pela API privada; tamanho e SHA-256 do
arquivo salvo foram conferidos. No checkpoint das 19:01 UTC, havia 19 eventos
processados, nenhum pendente/em processamento e nenhum para conferência. Nenhum
envio de WhatsApp ou chamada de IA foi feito pelo novo backend.

O histórico posterior ao backup de 22/10 ainda precisa ser sincronizado antes da
virada definitiva. Respostas automáticas, transcrição, demais integrações e
identidade visual permanecem em etapas posteriores.

## Comportamento publicado

O recebedor mantém a validação HMAC dos bytes originais, escopo assinado, fila
criptografada e deduplicação por UUID do evento. O alias documentado `account.id`
é aceito quando `accountId` não existe; todos os identificadores presentes
precisam concordar, assim como o perfil assinado. A capacidade de 5.000 passa a
contar eventos ainda não processados, incluindo os que aguardam conferência.
Os recibos processados e seus corpos criptografados são preservados.

Um worker adquire uma concessão de 120 segundos, renova a cada 30 segundos e
processa uma mensagem por vez. Faz no máximo cinco tentativas com espera para
falhas transitórias. Erros permanentes, identidades ambíguas ou tentativas
esgotadas ficam em `needs_review`, sem descartar o corpo recebido. Uma instância
que perder a concessão não pode concluir nem falhar o trabalho de outra.

Antes de registrar uma mensagem, baixa todos os anexos para o volume privado.
Somente depois grava mensagem, vínculos, arquivos e conclusão do recibo em uma
transação. Falhas não deixam mensagem clínica parcial. Arquivos já completos
são reutilizados por conta/ID da mensagem/posição e conferidos por SHA-256.
Arquivos órfãos de uma falha são mantidos privados; não há exclusão automática.

Contatos são resolvidos por âncoras verificáveis: BSUID, identidade da plataforma,
telefone explícito e vínculos legados de conversa/mensagem. Identidades
conflitantes exigem conferência; não há fusão automática. IDs numéricos não são
tratados como telefones. Um contato novo pode ter telefone NULL; formulários
manuais continuam exigindo telefone para cadastros novos e não permitem apagar
um telefone conhecido. A atividade de mensagens não invalida uma edição aberta.

Conversas pausadas/arquivadas preservam seu estado. Conversas novas ficam no
atendimento humano, com IA pausada. Ecos de envio somente recebem autoria
`human` quando o provedor informa `sentVia=human`; os demais aparecem como
**WhatsApp / CRM**. Confirmações de entrega/leitura podem chegar antes da mensagem;
a leitura não é rebaixada por uma confirmação atrasada. Nenhuma rotina deste
estágio envia mensagem, chama IA, transcreve áudio ou muda o atendimento do CRM.

## Permissões novas da migração 0006

O papel `nina_channel_processor` não tem login, superpoderes, BYPASSRLS, criação de
bancos/papéis nem associação da API. Ele é dono de cinco funções com
`SECURITY DEFINER`, `search_path=pg_catalog,pg_temp` e EXECUTE público revogado.
Somente essas funções são concedidas à API para consultar contagens, adquirir,
renovar, concluir ou falhar eventos da conta/perfil fixados pelo operador.

O papel tem os grants necessários a contatos, conversas, mensagens e tabelas
internas; não recebe animais, agendamentos, procedimentos, escrita de observações,
exclusão nem criação de usuários. A API continua sem SELECT direto no ciphertext
ou nos vínculos privados e não pode assumir o papel do processador. O retorno do
claim contém o evento criptografado somente enquanto o trabalho é adquirido.

Metadados de arquivos e vínculos recebem SELECT protegido pela mesma conta de
equipe ativa usada no histórico clínico. `GET/HEAD /v1/files/{uuid}` autentica a
sessão, consulta metadados com RLS e entrega um fluxo privado com `no-store`,
`nosniff`, CSP sandbox e intervalos de bytes para áudio/vídeo. Outros tipos são
entregues como download. Não existem URL pública de arquivo, token de download
na URL, caminhos arbitrários ou uso do URL temporário do provedor no navegador.
A página de situação do WhatsApp é restrita a administradores.

## Arquivo de mídias

- Volume persistente exclusivo montado em `/app/media`; diretório 700, arquivos 600,
  usuário `node` (UID/GID 1000 na imagem). Nenhum volume público ou porta nova.
- Criar o marcador `.nina-volume-initialized` com o texto `nina-media-v1` **somente
  depois de confirmar a montagem persistente**. A imagem não contém esse marcador;
  produção recusa iniciar o arquivo de mídias se ele faltar.
- Limite padrão 100 MiB por arquivo, até 10 anexos por mensagem e reserva de 2 GiB
  livres. Sem espaço ou com arquivo incompleto, o evento permanece para revisão
  ou nova tentativa; não é confirmado como processado.
- Downloads HTTPS usam DNS IPv4 público validado e fixado na conexão, certificado
  verificado e destino original no TLS. Endereços privados/reservados, IPv6,
  credenciais no URL, compressão e redirecionamento autenticado são recusados.
- A chave do Zernio só é enviada ao endpoint exato `zernio.com/api/v1/whatsapp/media/{id}`,
  com `accountId` vinculado à conta configurada. URLs de CDN não recebem a chave.
- A documentação do provedor informa retenção de sete dias, com algumas mídias
  recebidas expirando antes. Não ativar a recepção sem o arquivo de mídias pronto.
- O volume guarda os bytes privados originais; a proteção em disco é por
  permissões do sistema, não criptografia própria por arquivo. Incluir volume,
  banco e raiz de criptografia no plano de backup protegido. Não afirmar que
  um backup só do PostgreSQL restaura os arquivos.

## Registro do procedimento de primeira ativação

**Procedimento já executado. Não repetir o SQL de ativação em produção:** ele
exige exatamente as cinco migrações anteriores e ausência do papel novo. Para
novas versões, manter migrações/checksums e revisar o rollback compatível.

1. Preservar a configuração atual, commit e backup. Desligar os três flags na
   preparação: `ZERNIO_WEBHOOK_ENABLED=false`, `CHANNEL_PROCESSING_ENABLED=false`,
   `MEDIA_ENABLED=false`. Autodeploy continua desligado.
2. Publicar primeiro a API desta branch com todos os flags desligados. Essa
   versão aceita cinco ou seis migrações nesse modo; versões antigas que não
   conhecem 0006 rejeitam o novo histórico. Conferir saúde, readiness, login e
   edição clínica antes de prosseguir.
3. Fazer novo backup completo no PostgreSQL 17, verificar permissões e leitura
   integral do dump. Gerar o SQL revisável com
   `server/scripts/prepare-channel-activation.mjs`, recebendo os IDs pelo ambiente
   privado e redirecionando stdout a arquivo 600. O gerador não conecta ao banco.
   O SQL verifica os cinco checksums existentes, banco `nina`, papel da API,
   trava e ausência do papel novo; aplica migração, papel/grants, conta/perfil e
   registro do checksum em uma única transação. Executar com psql ON_ERROR_STOP,
   somente como manutenção após a autorização específica.
4. Conferir seis checksums, dono NOLOGIN das cinco funções, EXECUTE público
   revogado, ausência de associação/SET ROLE pela conexão real `nina_app` e
   proibição de SELECT direto no ciphertext. Rodar um ensaio com dados fictícios
   e rollback. PGlite não substitui esta verificação no PostgreSQL real.
5. Criar e montar o volume privado no Dokploy, conferir UID/permissões, espaço e
   persistência através de recriação do container com arquivo sintético. Só então
   criar o marcador. Manter o recebimento desligado durante a preparação.
6. Salvar `MEDIA_STORAGE_DIR=/app/media`, `MEDIA_ENABLED=true` e
   `CHANNEL_PROCESSING_ENABLED=true`. A chave Zernio já foi salva pelo usuário;
   validar acesso de leitura aos arquivos sem exibi-la. Reimplantar e verificar
   readiness, escopo, fila vazia, proteção de arquivos e edição clínica.
7. Publicar o frontend desta branch. Conferir sessão, cadastros, novo menu
   WhatsApp (admin) e histórico com refresh independente dos formulários.
8. Com a aprovação para cópia passiva real, ligar `ZERNIO_WEBHOOK_ENABLED=true`
   e reimplantar. O usuário deve colar o mesmo segredo no rascunho do Zernio e
   concluir a criação da assinatura limitada à conta/perfil já conferidos.
   Não criar nem desativar assinaturas antigas por engano.
9. Exercitar primeiro o teste sintético do provedor. Para uma mensagem real de
   ensaio, combinar o envio com o usuário; não disparar WhatsApp pela API.
   Conferir contagens e processamento sem imprimir conteúdo, telefones ou URLs.
10. Acompanhar falhas e espaço. Sincronizar o intervalo após o backup de 22/10,
    com deduplicação, e conferir mídias antigas disponíveis antes da virada final.
    Conectar/retirar o atendimento automático é uma etapa posterior.

Rollback funcional: pausar somente a assinatura nova e desligar os três flags,
mantendo esta versão compatível com 0006. Não apagar filas, papéis, arquivos,
recibos ou histórico da migração, nem voltar à imagem 624caea após aplicar 0006.
Restauração integral deve considerar banco e volume no mesmo ponto de backup.

## Verificação

Os testes cobrem HMAC, normalização, RLS/grants, deduplicação, legado, eventos fora
de ordem, concessões vencidas, tentativas esgotadas, erro/recuperação de mídias,
SSRF/DNS/TLS, permissões e integridade de arquivos, sessões revogadas, CORS,
HTTP real, HEAD e intervalos de bytes. A demonstração no navegador usa somente
dados e bytes fictícios e não consulta provedores reais. TypeScript e build
passaram antes da publicação (187 testes). Os ensaios com Node 22/PostgreSQL 17
na VPS e rollback também passaram, incluindo dois anexos fictícios, leitura
privada parcial, confirmações de leitura/entrega, concessões e edição clínica.
Nenhuma dependência de produção nova.

Referências primárias:
[webhooks](https://docs.zernio.com/webhooks),
[eventos de mensagens](https://docs.zernio.com/webhooks/inbox),
[download privado e retenção de mídias](https://docs.zernio.com/whatsapp/get-whatsapp-media),
[funções e SECURITY DEFINER](https://www.postgresql.org/docs/17/sql-createfunction.html),
[HTTPS do Node](https://nodejs.org/api/https.html),
[IPv4 reservados](https://www.iana.org/assignments/iana-ipv4-special-registry).
