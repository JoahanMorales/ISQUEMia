# ISQUEMIA — imagen para Cloud Run (Fase 7).
#
# El proceso mantiene la corrida en memoria y sirve un stream AG-UI abierto
# durante minutos, así que se despliega como un servicio siempre encendido, con
# una sola instancia: dos réplicas serían dos simulaciones distintas y el panel
# saltaría entre ellas. Ver `scripts/desplegar.sh`.

FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# La suite de diez semillas corre dentro del build: si M5, M6 o M9 caen de meta,
# la imagen no se construye (§14.4). El JSON resultante viaja con la imagen y es
# lo que P5 muestra.
RUN npx tsx scripts/evals.ts
RUN npm run build

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=8080
RUN groupadd --system --gid 1001 nodejs && useradd --system --uid 1001 --gid nodejs isquemia

COPY --from=build /app/public ./public
COPY --from=build --chown=isquemia:nodejs /app/.next/standalone ./
COPY --from=build --chown=isquemia:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=isquemia:nodejs /app/evals ./evals

USER isquemia
EXPOSE 8080
CMD ["node", "server.js"]
