#!/bin/sh
set -eu

DATA_DIR="${DATA_DIR:-./data}"
REDI_ROOT=$(pwd)
case "$DATA_DIR" in
  /*) ;;
  *) DATA_DIR="$REDI_ROOT/${DATA_DIR#./}" ;;
esac
export DATA_DIR
sh scripts/bootstrap-env.sh

if [ ! -f .next/standalone/server.js ]; then
  echo 'Production build missing. Run `npm run build` first.' >&2
  exit 1
fi

install -d .next/standalone/public .next/standalone/.next/static
cp -R public/. .next/standalone/public/
cp -R .next/static/. .next/standalone/.next/static/

export HOSTNAME="${REDI_HOST:-127.0.0.1}"
export PORT="${PORT:-3000}"
exec node .next/standalone/server.js
