"use client";

import { useEffect } from "react";
import { reportError } from "@/lib/client/error-reporter";
import { StatusScreen } from "./_components/status-screen";

export default function RootError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
    reportError(error, { mechanism: "root error boundary" });
  }, [error]);
  return (
    <StatusScreen
      code="500"
      title="Something went wrong"
      message="An unexpected error occurred. Try again, or head back to Evolix."
      reference={error.digest}
      actions={[
        { label: "Try again", onClick: retry, primary: true },
        { label: "Back to Evolix", href: "/dashboard" },
      ]}
    />
  );
}
