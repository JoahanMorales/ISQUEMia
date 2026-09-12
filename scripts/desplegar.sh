#!/usr/bin/env bash
# Despliegue a Cloud Run — Fase 7.
#
# Una sola instancia, siempre encendida: la corrida vive en memoria del proceso
# y el panel se cuelga de un stream que dura minutos. Escalar a dos instancias
# partiría la demo en dos simulaciones distintas.
set -euo pipefail

PROYECTO="${GOOGLE_CLOUD_PROJECT:?exporta GOOGLE_CLOUD_PROJECT}"
REGION="${REGION:-us-central1}"
SERVICIO="${SERVICIO:-isquemia}"

gcloud run deploy "$SERVICIO" \
  --project "$PROYECTO" \
  --region "$REGION" \
  --source . \
  --port 8080 \
  --min-instances 1 \
  --max-instances 1 \
  --cpu 2 \
  --memory 2Gi \
  --no-cpu-throttling \
  --timeout 3600 \
  --allow-unauthenticated \
  --set-env-vars "NODE_ENV=production" \
  ${AMBIGUOUS_API_KEY:+--set-env-vars "AMBIGUOUS_API_KEY=$AMBIGUOUS_API_KEY"} \
  ${AMBIGUOUS_MCP_URL:+--set-env-vars "AMBIGUOUS_MCP_URL=$AMBIGUOUS_MCP_URL"} \
  ${OPENAI_API_KEY:+--set-env-vars "OPENAI_API_KEY=$OPENAI_API_KEY"} \
  ${EXA_API_KEY:+--set-env-vars "EXA_API_KEY=$EXA_API_KEY"}

gcloud run services describe "$SERVICIO" --project "$PROYECTO" --region "$REGION" --format 'value(status.url)'
