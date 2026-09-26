#!/bin/sh
# Railway mounts volumes owned by root. Fix ownership of the data dir, then drop to the
# unprivileged "node" user so the app never runs as root.
set -e
DATA_DIR="$(dirname "${DATABASE_PATH:-/data/app.db}")"
if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR"
  chown -R node:node "$DATA_DIR"
  chmod 700 "$DATA_DIR"
  exec setpriv --reuid=node --regid=node --init-groups "$@"
fi
exec "$@"
