"use client";

import { CopilotKitProvider } from "@copilotkit/react-core/v2";

/**
 * El proveedor de CopilotKit envuelve la app entera. Todo el estado del panel
 * llega por AG-UI desde `IsquemiaAgent`; no hay un segundo canal.
 */
export function Proveedor({ children }: { children: React.ReactNode }) {
  return (
    <CopilotKitProvider runtimeUrl="/api/copilotkit" defaultThrottleMs={120}>
      {children}
    </CopilotKitProvider>
  );
}
