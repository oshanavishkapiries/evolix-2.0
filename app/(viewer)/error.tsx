"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function ViewerError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="v-empty v-status" role="alert">
      <p className="v-status-code" aria-hidden="true">500</p>
      <h1>Something went wrong</h1>
      <p className="v-muted">We could not load this page. Try again in a moment.</p>
      {error.digest && <p className="v-status-ref">Reference: {error.digest}</p>}
      <div className="v-status-actions">
        <button type="button" className="v-btn v-btn-primary" onClick={retry}>Try again</button>
        <Link href="/dashboard" className="v-btn">Home</Link>
      </div>
    </div>
  );
}
