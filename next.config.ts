import type { NextConfig } from "next";

const config: NextConfig = {
  // Cloud Run necesita el servidor Node autocontenido en .next/standalone para
  // meterlo en la imagen (ver Dockerfile). Vercel hace su propio empaquetado y
  // con "standalone" no encuentra la estructura que espera: cae al modo de
  // sitio estático y falla pidiendo un directorio "public". Se activa solo
  // fuera de Vercel, así los dos despliegues conviven.
  output: process.env.VERCEL ? undefined : "standalone",
  // El motor de simulación vive en memoria del servidor: una sola instancia.
  serverExternalPackages: ["@copilotkit/runtime"],
  typedRoutes: false,
  agentRules: false,
};

export default config;
