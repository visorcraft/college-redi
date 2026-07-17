#!/bin/sh
# Redi first-boot credential & encryption bootstrap (spec §4.6).
# MongrelDB always runs encrypted at rest (AES-256-GCM) with storage-level
# credential enforcement; the credentials + passphrase are generated here, never
# supplied by hand. Idempotent: an existing $DATA_DIR/.env is left untouched.
set -eu

DATA_DIR="${DATA_DIR:-/data}"
ENV_FILE="$DATA_DIR/.env"

mkdir -p "$DATA_DIR"

if [ -f "$ENV_FILE" ]; then
  echo "[redi-bootstrap] $ENV_FILE already exists; leaving it unchanged"
  exit 0
fi

USERNAME="${MONGRELDB_DB_USERNAME:-redi}"
DATABASE_MODE_VALUE="${DATABASE_MODE:-embedded}"
MONGRELDB_URL_VALUE="${MONGRELDB_URL:-http://127.0.0.1:8453}"

gen_secret() {
  # 32 random bytes, base64url-encoded (43 chars, padding stripped)
  head -c 32 /dev/urandom | base64 | tr '+/' '-_' | tr -d '='
}

DB_PASSWORD="$(gen_secret)"
PASSPHRASE="$(gen_secret)"
SETUP_TOKEN="${REDI_SETUP_TOKEN:-$(gen_secret)}"

umask 077
{
  echo "MONGRELDB_DB_USERNAME=$USERNAME"
  echo "MONGRELDB_DB_PASSWORD=$DB_PASSWORD"
  echo "MONGRELDB_PASSPHRASE=$PASSPHRASE"
  echo "REDI_SETUP_TOKEN=$SETUP_TOKEN"
  echo "DATABASE_MODE=$DATABASE_MODE_VALUE"
  echo "MONGRELDB_URL=$MONGRELDB_URL_VALUE"
} > "$ENV_FILE"
chmod 600 "$ENV_FILE"

# Never log the generated values (spec §4.6).
echo "[redi-bootstrap] generated MongrelDB credentials and encryption passphrase in $ENV_FILE (mode 0600)"
