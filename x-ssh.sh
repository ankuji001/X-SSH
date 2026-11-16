#!/usr/bin/env bash
# Launch X-SSH. --no-sandbox is needed unless chrome-sandbox is root-owned with mode 4755:
#   sudo chown root:root node_modules/electron/dist/chrome-sandbox && sudo chmod 4755 node_modules/electron/dist/chrome-sandbox
DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
SB="$DIR/node_modules/electron/dist/chrome-sandbox"
FLAGS=""; [ "$(stat -c %u:%a "$SB" 2>/dev/null)" = "0:4755" ] || FLAGS="--no-sandbox"
exec "$DIR/node_modules/.bin/electron" $FLAGS "$DIR" "$@"
