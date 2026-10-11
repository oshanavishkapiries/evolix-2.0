"use client";

import { useEffect } from "react";
import { StatusScreen } from "./_components/status-screen";

/** Last resort: replaces the root layout, so it brings its own <html> and <body>. */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#161616" }}>
        <StatusScreen
          code="500"
          title="Evolix hit a problem"
          message="Something broke while loading the app. Try again in a moment."
          reference={error.digest}
          actions={[
            { label: "Try again", onClick: retry, primary: true },
            { label: "Reload", href: "/dashboard" },
          ]}
        />
      </body>
    </html>
  );
}
