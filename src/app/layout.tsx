import type { Metadata } from "next";
import "./globals.css";
import "@copilotkit/react-core/v2/styles.css";
import { Proveedor } from "../ui/proveedor";

export const metadata: Metadata = {
  title: "ISQUEMIA — organ placement console",
  description:
    "Three clocks, one console: referral detection, parallel placement with verified commitments, and multimodal transport routing. Synthetic data only.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Proveedor>{children}</Proveedor>
      </body>
    </html>
  );
}
