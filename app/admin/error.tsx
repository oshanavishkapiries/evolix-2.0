"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function AdminError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="card" role="alert" style={{ maxWidth: "32rem", margin: "3rem auto", padding: "2rem", textAlign: "center" }}>
      <h1 style={{ fontSize: "1.4rem", fontWeight: 700 }}>Something went wrong</h1>
      <p style={{ marginTop: ".5rem", opacity: 0.75 }}>This admin page failed to load.</p>
      {error.digest && <p style={{ marginTop: ".5rem", fontSize: ".75rem", opacity: 0.6, fontFamily: "ui-monospace, monospace" }}>Reference: {error.digest}</p>}
      <div className="toolbar" style={{ justifyContent: "center", marginTop: "1.25rem" }}>
        <button type="button" onClick={retry}>Try again</button>
        <Link href="/admin" className="btn-secondary rounded-md border px-3 py-2 text-sm no-underline">Overview</Link>
      </div>
    </div>
  );
}
