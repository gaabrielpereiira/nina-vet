#!/usr/bin/env bash
# Recria do zero o ambiente LOCAL descartável da Nina:
#   banco "nina" + papéis nina_* no PostgreSQL desta máquina, migrações,
#   permissões, usuários, conversas fictícias e arquivos de ambiente locais.
#   O WhatsApp é simulado (dev-local/api.mjs); nada sai desta máquina.
#
# Uso (na raiz do repositório):  bash server/scripts/dev-local/reset.sh
#
# ATENÇÃO: apaga o banco "nina" e os papéis nina_* do PostgreSQL LOCAL.
# Recusa rodar se o servidor não for local. Nunca usar contra a VPS.
set -euo pipefail
cd "$(dirname "$0")/../../.."

PG_BIN=${PG_BIN:-/opt/homebrew/opt/postgresql@16/bin}
NODE=${NODE:-node}
API_PORT=${API_PORT:-3010}
WEB_PORT=${WEB_PORT:-8090}
PSQL="$PG_BIN/psql"
SECRETS=server/.env.local-dev
RUNTIME=server/.env
WEB_ENV=.env.local
MEDIA_DIR="$PWD/server/dev-media.local"
DEV_ACCOUNT=dededededededededededede
DEV_PROFILE=fefefefefefefefefefefefe
MARK='# gerado por server/scripts/dev-local'

# Só aceita o PostgreSQL local (socket Unix ou loopback).
server_addr=$("$PSQL" -d postgres -Atc "select coalesce(host(inet_server_addr()),'socket')")
case "$server_addr" in
  socket|127.0.0.1|::1) ;;
  *) echo "Recusado: o PostgreSQL conectado não é local ($server_addr)." >&2; exit 1 ;;
esac

# Não sobrescreve arquivos de ambiente escritos à mão.
for f in "$RUNTIME" "$WEB_ENV"; do
  if [ -f "$f" ] && ! grep -qF "$MARK" "$f"; then
    echo "Recusado: $f já existe e não foi gerado por este script." >&2; exit 1
  fi
done

# Mantém a senha dos usuários de teste entre resets; gera as do banco a cada vez.
DEV_LOGIN_PASSWORD=""
if [ -f "$SECRETS" ]; then
  DEV_LOGIN_PASSWORD=$(sed -n 's/^DEV_LOGIN_PASSWORD=//p' "$SECRETS")
fi
[ -n "$DEV_LOGIN_PASSWORD" ] || DEV_LOGIN_PASSWORD=$(openssl rand -base64 18 | tr -d '/+=')
OWNER_PW=$(openssl rand -hex 24)
APP_PW=$(openssl rand -hex 24)
OWNER_URL="postgres://nina_owner:${OWNER_PW}@localhost:5432/nina"

echo "• Apagando banco e papéis locais antigos"
"$PSQL" -d postgres -v ON_ERROR_STOP=1 -q <<'SQL'
DROP DATABASE IF EXISTS nina WITH (FORCE);
DROP ROLE IF EXISTS nina_app;
DROP ROLE IF EXISTS nina_channel_processor;
DROP ROLE IF EXISTS nina_owner;
SQL

echo "• Criando dono e banco"
# Na VPS o dono é superusuário; aqui ele só cria papéis e vira membro deles
# (SET + INHERIT), o que basta para os ALTER ... OWNER TO e GRANT dos arquivos.
"$PSQL" -d postgres -v ON_ERROR_STOP=1 -q -v pw="$OWNER_PW" <<'SQL'
CREATE ROLE nina_owner LOGIN CREATEROLE NOSUPERUSER NOCREATEDB NOREPLICATION NOBYPASSRLS PASSWORD :'pw';
ALTER ROLE nina_owner SET createrole_self_grant = 'set, inherit';
CREATE DATABASE nina OWNER nina_owner;
SQL
"$PSQL" -d nina -v ON_ERROR_STOP=1 -q -c "REVOKE ALL ON DATABASE nina FROM PUBLIC; REVOKE CREATE ON SCHEMA public FROM PUBLIC;"

umask 077
cat > "$SECRETS" <<EOF
$MARK
# Ambiente LOCAL descartável (PostgreSQL em localhost). Ignorado pelo Git.
MIGRATION_DATABASE_URL=$OWNER_URL
DEV_LOGIN_EMAILS=admin@nina-dev.test,equipe@nina-dev.test
DEV_LOGIN_PASSWORD=$DEV_LOGIN_PASSWORD
EOF

echo "• Aplicando migrações"
MIGRATION_DATABASE_URL="$OWNER_URL" "$NODE" server/scripts/migrate.mjs

echo "• Aplicando permissões"
for f in runtime-role clinic-runtime-role clinic-write-role zernio-inbox-role \
         channel-processing-role whatsapp-pilot-role staff-inbox-role \
         staff-inbox-write-role chat-role chat-write-role agent-settings-role; do
  "$PSQL" "$OWNER_URL" -v ON_ERROR_STOP=1 -q -f "server/sql/$f.sql" >/dev/null
done
"$PSQL" "$OWNER_URL" -v ON_ERROR_STOP=1 -q -v pw="$APP_PW" <<'SQL'
ALTER ROLE nina_app PASSWORD :'pw';
SQL

echo "• Escrevendo $RUNTIME e $WEB_ENV"
cat > "$RUNTIME" <<EOF
$MARK
# API local de desenvolvimento. Integrações externas desligadas.
NODE_ENV=development
PORT=$API_PORT
API_ORIGIN=http://localhost:$API_PORT
FRONTEND_ORIGIN=http://localhost:$WEB_PORT
DATABASE_URL=postgres://nina_app:${APP_PW}@localhost:5432/nina
DATABASE_SSL=disable
AI_TESTS_ENABLED=false
VETSOFT_READ_ONLY_ENABLED=false
EMAIL_ENABLED=false
WHATSAPP_PILOT_ENABLED=false
# WhatsApp SIMULADO: identificadores e chaves sintéticos, sem conta real.
ZERNIO_WEBHOOK_ENABLED=true
ZERNIO_ACCOUNT_ID=$DEV_ACCOUNT
ZERNIO_PROFILE_ID=$DEV_PROFILE
ZERNIO_WEBHOOK_SECRET=$(openssl rand -hex 24)
ZERNIO_API_KEY=dev-local-$(openssl rand -hex 24)
EMAIL_ENCRYPTION_KEY=$(openssl rand -hex 32)
CHANNEL_PROCESSING_ENABLED=true
MEDIA_ENABLED=true
MEDIA_STORAGE_DIR=$MEDIA_DIR
MEDIA_MIN_FREE_BYTES=0
WHATSAPP_INBOX_ENABLED=true
WHATSAPP_INBOX_WRITES_ENABLED=true
EOF
cat > "$WEB_ENV" <<EOF
$MARK
VITE_API_URL=http://localhost:$API_PORT
EOF

echo "• Criando usuários de teste fictícios"
MIGRATION_DATABASE_URL="$OWNER_URL" DEV_LOGIN_PASSWORD="$DEV_LOGIN_PASSWORD" \
  "$NODE" server/scripts/dev-local/users.mjs

echo "• Criando conversas fictícias pelo WhatsApp simulado"
"$PSQL" "$OWNER_URL" -v ON_ERROR_STOP=1 -q -c "INSERT INTO nina_channels.processor_scope(account_id,profile_id) VALUES('$DEV_ACCOUNT','$DEV_PROFILE')"
# Só os arquivos gerados pelo simulador; a pasta inteira é descartável.
rm -rf "$MEDIA_DIR"
MIGRATION_DATABASE_URL="$OWNER_URL" "$NODE" --env-file="$RUNTIME" server/scripts/dev-local/seed.mjs

echo "Pronto. Logins e senha de teste em $SECRETS."
