#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
for user in alice bob charlie; do
  echo "Creating local test user: $user"
  docker compose exec -T synapse register_new_matrix_user \
    --user "$user" --password "$user" --no-admin --exists-ok \
    --config /data/homeserver.yaml http://localhost:8008
done
echo 'Ready: alice/alice, bob/bob and charlie/charlie (local Matrix IDs). Existing accounts/passwords are unchanged.'
