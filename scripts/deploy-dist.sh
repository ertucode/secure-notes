#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DIST_DIR="$ROOT_DIR/dist"
REMOTE_HOST="hostinger"
REMOTE_DIR="/caddy/apps/secure-notes"

if [ ! -d "$DIST_DIR" ]; then
  printf 'Missing dist directory: %s\n' "$DIST_DIR" >&2
  exit 1
fi

ssh "$REMOTE_HOST" "mkdir -p '$REMOTE_DIR'"
tar cf - -C "$DIST_DIR" . | gzip -3 | ssh "$REMOTE_HOST" "cd '$REMOTE_DIR' && gunzip | tar xf -"
