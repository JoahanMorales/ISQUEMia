# public/

Activos estáticos servidos tal cual en la raíz del sitio.

La carpeta se mantiene aunque esté vacía porque el `Dockerfile` la copia a la
imagen (`COPY --from=build /app/public ./public`) y el build falla si no existe.
Vercel también la espera cuando no reconoce el proyecto como Next.js.
