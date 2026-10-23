# Nina Vet

Plataforma da clínica Vet+ com interface React/Vite. A migração para a VPS com
Dokploy está sendo preparada na branch `codex/postgres-backend`.

## Estado da migração

A pasta `server/` contém a base da API própria em Node.js e PostgreSQL, sem
dependências Supabase/Lovable: login, sessões revogáveis, recuperação de senha
e integração Resend com fila criptografada. As duas migrações iniciais já foram
aplicadas no banco novo da VPS e o acesso limitado `nina_app` foi preparado.

**A migração completa ainda não terminou.** A interface e as funções antigas
continuam usando Supabase. Dados, mídias, regras de negócio, IA, WhatsApp,
Vetsoft e tempo real ainda precisam ser portados e verificados antes de
substituir o sistema em produção. Uma publicação da API base serve apenas
para testar o container, a conexão com o banco e o domínio novo.

## Desenvolvimento

Requer Node.js 22 ou superior.

```sh
npm ci
npm ci --prefix server
npm run dev
```

A interface atual ainda depende da configuração pública Supabase da origem.
Não apontar essas variáveis para a API própria: os contratos são diferentes.
As instruções do backend e de suas variáveis estão em [server/README.md](server/README.md).

Chaves de IA, Resend, senhas de banco e a chave de criptografia pertencem
somente ao servidor. Nunca colocá-las em variáveis `VITE_`, no Git ou no chat.

## Testes e publicação

```sh
npm test
npm run typecheck
npm run build
```

Os 84 testes passaram com dados sintéticos e PostgreSQL embarcado. O build e
o typecheck da interface continuam pendentes nesta etapa; as últimas tentativas
não concluíram. O primeiro deploy da API na VPS foi validado em 23/10/2026:
HTTPS, `/healthz` e `/readyz` responderam normalmente. Isso confirma a base
do servidor e sua conexão com o banco, sem concluir a migração da clínica.

O verificador também aceita o bcrypt de custo 10 encontrado nas contas antigas,
mantendo scrypt para senhas novas. A importação dessas contas foi preparada e
simulada localmente; ainda não foi aplicada na VPS.

Para testar exclusivamente a API no Dokploy, usar o contexto `.`, Dockerfile
`server/Dockerfile`, stage `production` e porta `3000`. Manter o autodeploy
desligado e `EMAIL_ENABLED=false` durante a preparação. O Dockerfile da raiz
é da interface antiga e ainda não representa a migração concluída.

O acompanhamento e os critérios de conclusão estão em
[docs/migracao-postgresql-nativo.md](docs/migracao-postgresql-nativo.md).
