# Nina Vet

Plataforma da Clínica Vet+ em migração para uma VPS com Dokploy. O trabalho está
na branch `codex/postgres-backend`; a branch `main` permanece independente.

## Estado da migração

Em 02/11/2026, as cinco contas e 125.174 registros de cadastros e histórico foram
importados na VPS. Veja [o procedimento desta etapa](docs/migracao-historico.md).

A pasta `server/` contém a base da API própria em Node.js e PostgreSQL, sem
dependências Supabase/Lovable: login, sessões revogáveis, recuperação de senha
e integração Resend com fila criptografada. As três migrações já foram aplicadas
na VPS, com acesso limitado `nina_app` e consultas clínicas autenticadas.

A interface nativa em `src/native/` oferece login, busca e paginação de tutores,
animais, agenda, procedimentos e histórico de mensagens. O ponto de entrada e
o bundle de produção usam somente a API própria e não carregam Supabase/Lovable.

**A migração completa ainda não terminou.** Esta interface permite consulta.
Edição, envio de mensagens, IA, WhatsApp, VetSoft, mídias, tempo real e gestão da
equipe ainda precisam ser portados e verificados. O código antigo permanece no
repositório como referência, fora do ponto de entrada da interface publicada;
suas dependências ainda não foram eliminadas do repositório.

O envio de recuperação de senha depende de `EMAIL_ENABLED=true` na API. Durante
a preparação ele permanece desativado; a interface informa a indisponibilidade.
Não há cadastro público de usuários.

## Desenvolvimento

Requer Node.js 22 ou superior.

```sh
npm ci
npm ci --prefix server
npm run dev
```

A interface usa `VITE_API_URL`, origem pública sem segredo, com padrão
`https://api.nina.sharkassessoria.tech`. Para testes locais, usar uma API local
com banco descartável e dados sintéticos.
As instruções do backend e de suas variáveis estão em [server/README.md](server/README.md).

Chaves de IA, Resend, senhas de banco e a chave de criptografia pertencem
somente ao servidor. Nunca colocá-las em variáveis `VITE_`, no Git ou no chat.

## Testes e publicação

```sh
npm test
npm run typecheck
npm run build
```

Os 104 testes passaram com dados sintéticos, incluindo o contrato do cliente
nativo. A interface foi também verificada no navegador com API local e dados
sintéticos. O titular deve validar seu acesso real digitando a senha diretamente
no site. A API publicada respondeu normalmente em HTTPS nos testes da VPS.

O verificador também aceita o bcrypt de custo 10 encontrado nas contas antigas,
mantendo scrypt para senhas novas. As cinco contas foram importadas na VPS.

Para publicar a API no Dokploy, usar o contexto `.`, Dockerfile
`server/Dockerfile`, stage `production` e porta `3000`. Manter o autodeploy
desligado e `EMAIL_ENABLED=false` durante a preparação. A aplicação `nina-web`
usa o Dockerfile da raiz, contexto `.`, stage `production` e porta `8080`.
Ela não precisa de variáveis Supabase. Veja [a publicação da interface nativa](docs/frontend-nativo.md).

O acompanhamento e os critérios de conclusão estão em
[docs/migracao-postgresql-nativo.md](docs/migracao-postgresql-nativo.md).
