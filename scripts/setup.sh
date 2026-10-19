#!/bin/sh
set -eu
umask 077
cd "$(dirname "$0")/.."
if [ -f .env ]; then
  echo '.env already exists, NOT overwritten.'
  exit 0
fi
printf 'ORIGRAMI_DB_PASSWORD=%s\n' "$(openssl rand -hex 32)" > .env
chmod 600 .env
echo 'Created .env with a unique password.'
