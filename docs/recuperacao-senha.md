# Recuperação de senha na VPS

## Estado em 03/11/2026

A recuperação nativa está ativa em `https://nina.sharkassessoria.tech/auth/recuperar`,
com `EMAIL_ENABLED=true` na API. O domínio remetente `nina.sharkassessoria.tech`
está verificado no Resend; o remetente é `Nina Vet <acesso@nina.sharkassessoria.tech>`.
O TLS do domínio está em **Enforced**. Nenhum subdomínio de tracking foi configurado.

Após autorização explícita do titular, foi enviada uma única solicitação pela
interface publicada. A interface confirmou a solicitação e a lista de e-mails
do Resend mostrou **Delivered** para o assunto **Redefinir sua senha — Nina Vet**.
O link e seu token não foram abertos nem registrados pelo agente. O titular
confirmou o recebimento e optou por manter a senha atual. A troca real e o
login com uma nova senha não foram executados neste teste.

A ativação foi uma alteração somente de ambiente seguida de deploy manual da
API, concluído como Done para `af927cda7beac796b651ea7abe6b7055fcfeeefc`.
Não houve nova migração, alteração de grants ou deploy da interface.

## Validação

- 20 testes de recuperação/e-mail passaram.
- Ensaio no PostgreSQL real da VPS com provedor simulado e rollback integral:
  `NINA_RECOVERY_PREFLIGHT_OK_ROLLED_BACK_NO_EMAIL_SENT`.
- O ensaio validou a conta ativa, o remetente, a fila criptografada, o hash do
  token, o link HTTPS com token no fragmento, a validade, o descarte do conteúdo
  após envio simulado e a ausência de envio duplicado.
- O teste real acima confirmou o caminho interface → API → fila → Resend →
  servidor de e-mail destinatário. Delivered não confirma leitura pelo usuário.

## Uso e operação

1. Na tela de login, escolher **Esqueci minha senha** e informar o e-mail.
2. Abrir o e-mail e o link em até 20 minutos. O link é de uso único.
3. O próprio usuário deve digitar, confirmar e salvar a nova senha no site.
   A senha deve ter pelo menos 12 caracteres. Ao concluir, as sessões e os
   demais links da conta são revogados; entrar novamente com a nova senha.

O pedido mantém resposta genérica para contas existentes ou inexistentes.
Há limite de três solicitações por endereço e vinte globais por 15 minutos.
Chaves e conteúdo dos links não devem aparecer no Git, screenshots ou logs.

Para interromper novos pedidos, definir `EMAIL_ENABLED=false` no Dokploy e
republicar somente a API; a interface informa a indisponibilidade. Não alterar
as chaves, os outros valores de ambiente ou as permissões do banco para isso.

Convites, gestão da equipe e as demais integrações da migração continuam pendentes.
