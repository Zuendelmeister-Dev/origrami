#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
for user in alice bob; do
  echo "Creating local test user: $user"
  docker compose exec -T synapse register_new_matrix_user \
    --user "$user" --password "$user" --no-admin --exists-ok \
    --config /data/homeserver.yaml http://localhost:8008
done
echo 'Ready: alice/alice and bob/bob (@alice:localhost and @bob:localhost). Existing accounts/passwords are unchanged.'
