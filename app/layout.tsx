import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { GATE_SCRIPT } from "@/lib/client/device";
import { PwaGate } from "./_components/pwa-gate";
import "./globals.css";

export const metadata: Metadata = {
  title: "Evolix 2.0",
  description: "Family media library",
  appleWebApp: { capable: true, title: "Evolix", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = { themeColor: "#161616" };

const gateOff = process.env.NEXT_PUBLIC_PWA_GATE === "off";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>{!gateOff && <script dangerouslySetInnerHTML={{ __html: GATE_SCRIPT }} />}</head>
      <body>
        {children}
        <Suspense fallback={null}>
          <PwaGate />
        </Suspense>
      </body>
    </html>
  );
}
