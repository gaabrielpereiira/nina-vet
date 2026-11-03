# Nina Vet

Plataforma da Clínica Vet+ em migração para uma VPS com Dokploy. O trabalho está
na branch `codex/postgres-backend`; a branch `main` permanece independente.

## Estado da migração

Em 02/11/2026, as cinco contas e 125.174 registros de cadastros e histórico foram
importados na VPS. Veja [o procedimento desta etapa](docs/migracao-historico.md).

A pasta `server/` contém a base da API própria em Node.js e PostgreSQL, sem
dependências Supabase/Lovable: login, sessões revogáveis, recuperação de senha
e integração Resend com fila criptografada. As quatro migrações foram aplicadas na
VPS, com acesso limitado `nina_app`, consultas e gravações clínicas autenticadas.

A interface nativa em `src/native/` oferece login, busca e paginação de tutores,
animais, agenda, procedimentos e histórico de mensagens. O ponto de entrada e
o bundle de produção usam somente a API própria e não carregam Supabase/Lovable.

**A migração completa ainda não terminou.** Em 03/11/2026 foram ativadas na VPS
a criação e edição de tutores, animais e agendamentos, com procedimentos
restritos a administradores. Há revisão, auditoria e proteção contra duplicação.
Envio de mensagens, IA, WhatsApp, VetSoft, mídias, tempo real e gestão da
equipe ainda precisam ser portados e verificados. O código antigo permanece no
repositório como referência, fora do ponto de entrada da interface publicada;
suas dependências ainda não foram eliminadas do repositório.

A recuperação de senha está ativa na VPS desde 03/11/2026, com
`EMAIL_ENABLED=true`. Um único teste autorizado pela interface recebeu status
**Delivered** no Resend. A troca real de senha fica a cargo do titular. Veja
[o procedimento de recuperação](docs/recuperacao-senha.md). Não há cadastro público de usuários.

A etapa seguinte de IA está preparada em `/nina/testes`, com exemplos fictícios
e acesso de administrador. A conexão real ainda precisa de ativação e validação.
Veja [o ensaio de IA e as próximas partes](docs/ia-nativa.md).

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

Os 115 testes passaram com dados sintéticos, incluindo o contrato do cliente
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

A etapa de gravação, suas permissões e a publicação coordenada estão em
[edição nativa](docs/edicao-nativa.md). Essa etapa exige a quarta migração
e os grants de gravação por coluna; ambos já estão aplicados na VPS.
