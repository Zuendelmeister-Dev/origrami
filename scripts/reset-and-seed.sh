#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
echo 'WARNING: deleting ALL Origrami local Compose volumes: users, rooms, media, keys.'
if [ "${1:-}" != '--force' ]; then
  printf 'Type RESET to proceed: '
  read -r confirmation
  [ "$confirmation" = 'RESET' ] || { echo 'Canceled.'; exit 0; }
fi
# Compose needs the DB password even for `down`.
sh scripts/setup.sh
if grep -Eq '^ORIGRAMI_DB_PASSWORD=REPLACE_WITH_A_LONG_RANDOM_PASSWORD[[:space:]]*$' .env; then
  echo 'Replace the placeholder database password before resetting.' >&2
  exit 1
fi
docker compose config --quiet
docker compose down -v --remove-orphans
docker compose up --build -d --wait --wait-timeout 180
sh scripts/seed-users.sh
echo 'Origrami is ready: http://localhost:5173'
