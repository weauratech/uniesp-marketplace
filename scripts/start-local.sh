#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
node scripts/infra-prepare.mjs
npm ci --no-audit --no-fund
npm --prefix web ci --no-audit --no-fund
npm run build
node scripts/infra-runtime-bundle.mjs
docker compose --env-file .env.infra up -d --wait identity-db keycloak mailpit
node scripts/setup-identity.mjs
if [ -s data/secrets/stripe-secret-key ] && [ -s data/secrets/stripe-webhook-secret ]; then
  docker compose -f compose.yaml -f compose.local.yaml -f compose.stripe.yaml --env-file .env.infra up -d --build uniesp-marketplace
else
  docker compose -f compose.yaml -f compose.local.yaml --env-file .env.infra up -d --build uniesp-marketplace
fi
