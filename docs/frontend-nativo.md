# Interface nativa de consulta

## Escopo

O ponto de entrada `src/main.tsx` carrega `src/native/NativeApp.tsx`. A interface
permite consultar tutores, animais, agendamentos, procedimentos e mensagens
importadas. Não oferece escrita clínica, envio de mensagens, cadastro público
ou integrações ainda não portadas. O código antigo é referência e não deve ser
religado ao ponto de entrada como atalho para disponibilizar funções.

## Autenticação e dados

Todas as chamadas incluem `credentials: include`. A API mantém a sessão no
cookie HttpOnly; o navegador não guarda tokens em localStorage. Uma resposta
401 encerra a visualização protegida; falhas de rede mostram erro e nova
tentativa. Busca e paginação são feitas no servidor; requisições anteriores
são canceladas ao trocar filtros ou sair da conta.

A recuperação usa a API nativa e informa indisponibilidade quando o envio está
desativado. O token de redefinição é aceito apenas no fragmento de
`/auth/set-password#token=...`, removido do endereço na abertura. Não testar
alterações de senha de contas reais de forma automatizada.

## Dokploy

Configurar **somente `nina-web`**:

1. Provedor Generic Git, repositório público
   `https://github.com/gaabrielpereiira/nina-vet.git`.
2. Branch `codex/postgres-backend`, caminho de build `/`.
3. Build Dockerfile: `Dockerfile`, contexto `.`, stage `production`.
4. Domínio `nina.sharkassessoria.tech`, HTTPS Let's Encrypt, porta `8080`, caminho `/`.
5. Manter autodeploy desligado enquanto a migração está em validação.

O único argumento público de build é `VITE_API_URL`, cujo padrão é
`https://api.nina.sharkassessoria.tech`. Não colocar segredos no frontend.
Para outro domínio de API, atualizar também o `connect-src` da política CSP em
`deploy/security-headers.conf` e a origem permitida na API.

Nginx oferece fallback das rotas da aplicação, `no-store` para HTML e cache
imutável dos assets com hash. Assets inexistentes retornam 404. Os cabeçalhos
limitam scripts e estilos à própria origem e conexões à API configurada.

## Verificação e reversão

Antes de publicar, executar testes, typecheck e build. Verificar no navegador
login, falha de login, busca, paginação, detalhe do tutor/animal, histórico,
filtro de datas, atualização da página e saída com dados sintéticos.
Depois da publicação, verificar HTTPS, HTML, assets, rotas diretas, cabeçalhos
e disponibilidade da API. O titular valida seu acesso com a senha existente.

Esta publicação não exige nova migração do banco. Em caso de falha, interromper
o uso da interface e republicar o último commit validado de `nina-web` (quando
houver). Não restaurar o banco ou redeployar `nina-api` para corrigir apenas a
interface. A origem antiga permanece parada durante a migração.
