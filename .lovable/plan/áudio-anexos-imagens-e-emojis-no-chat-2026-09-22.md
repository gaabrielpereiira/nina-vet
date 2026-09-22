# Áudio, anexos, imagens e emojis no chat

Objetivo: a atendente humana poder gravar e ouvir áudios, anexar arquivos, ver imagens, vídeos, documentos e figurinhas que os clientes enviam, e usar emojis ao responder.

## Situação atual

- As mensagens recebidas com mídia salvam apenas um texto do tipo "[imagem recebida]"; o link do arquivo fica guardado num campo interno e não no campo que a tela usa para exibir.
- O link original do WhatsApp exige autenticação, então o navegador não consegue mostrar a imagem nem tocar o áudio direto.
- Figurinhas chegam com um tipo que o banco não aceita, então essas mensagens podem falhar ao entrar.
- A tela de chat já sabe exibir imagem e tocar áudio, mas não tem anexo, gravação, emoji, visualização de vídeo/documento nem ampliar imagem.
- O envio para o WhatsApp já aceita anexos; falta a tela e o registro da mensagem enviarem o arquivo.

## O que será feito

**1. Guardar as mídias recebidas em local próprio**
- Criar um espaço de arquivos do chat na nuvem do projeto.
- Ao receber imagem, áudio, vídeo, documento ou figurinha, baixar o arquivo com a autenticação correta e salvá-lo nesse espaço, gravando o endereço final na mensagem.
- Figurinha passa a ser tratada como imagem (com marcação de figurinha), evitando falha no registro.
- Áudio recebido continua sendo transcrito para a Nina entender, mas o áudio original fica disponível para ouvir.

**2. Ouvir áudios recebidos**
- Player já existente passa a usar o arquivo salvo, com duração, barra de progresso e play/pause.
- Quando houver transcrição, mostrar o texto abaixo do player.

**3. Gravar e enviar áudio**
- Botão de microfone no campo de mensagem: gravar, ver o tempo, cancelar ou enviar.
- O áudio gravado é salvo no espaço de arquivos e enviado ao cliente pelo WhatsApp, aparecendo na conversa como áudio enviado.

**4. Anexar arquivos**
- Botão de clipe para escolher imagem, vídeo, documento ou áudio (com limite de tamanho e aviso claro se exceder).
- Pré-visualização antes de enviar, com legenda opcional para imagens e vídeos.
- Também aceitar arrastar-e-soltar e colar imagem no campo de mensagem.

**5. Ver imagens, vídeos, documentos e figurinhas**
- Imagem: clique amplia em tela cheia, com opção de baixar.
- Figurinha: exibida sem moldura, em tamanho pequeno.
- Vídeo: player com controles.
- Documento: cartão com nome do arquivo e botão de baixar.
- Na lista de conversas, a última mensagem mostra o ícone certo (foto, áudio, vídeo, documento, figurinha).

**6. Emojis**
- Seletor de emojis no campo de mensagem, inserindo no texto na posição do cursor.

## Detalhes técnicos

- Bucket `chat-media` (privado) com políticas em `storage.objects`: leitura/escrita para usuários autenticados e acesso total ao service role; URLs assinadas geradas no front para exibição.
- `supabase/functions/zernio-webhook/index.ts`: mapear `sticker` → `image` com `metadata.is_sticker`, e disparar a persistência da mídia; o download usa a API key da Zernio (helper `_shared/zernio.ts`) e grava `messages.media_url` + `media_type` + `metadata.file_name/size`.
- Nova função compartilhada `_shared/media.ts` (download + upload no bucket + retorno do path) usada pelo webhook e pelo `message-grouper` (que já baixa o áudio para transcrever — reaproveitar o buffer em vez de baixar duas vezes).
- `src/services/api.ts`: `sendMessage(conversationId, content, media?)` — upload do arquivo, insert em `messages` com `type`/`media_url`, e `send_queue` com `message_type` + `media_url` (o `whatsapp-sender` já envia `attachmentUrl`/`attachmentName`).
- `src/components/ChatInterface.tsx`: composer com clipe, microfone (MediaRecorder em webm/opus, fallback de mime), seletor de emojis, preview de anexo, drag-and-drop/paste; `renderMessageContent` ganha casos de vídeo, documento e figurinha, e lightbox para imagem.
- `src/types.ts`: `UIMessage` recebe `mediaType`, `fileName`, `isSticker`, `transcription`; `DBMessageType` já cobre os tipos do banco.
- Deploy de `zernio-webhook` e `message-grouper` após as mudanças.
