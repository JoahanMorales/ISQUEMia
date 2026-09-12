import type { NextConfig } from "next";

const config: NextConfig = {
  // Cloud Run: imagen mínima con el servidor Node autocontenido (Fase 7).
  output: "standalone",
  // El motor de simulación vive en memoria del servidor: una sola instancia.
  serverExternalPackages: ["@copilotkit/runtime"],
  typedRoutes: false,
  agentRules: false,
};

export default config;
