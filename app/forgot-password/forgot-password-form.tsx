"use client";

import { FormEvent, useState } from "react";
import { postJson, navigate } from "@/lib/client/api";

export function ForgotPasswordForm() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const email = String(new FormData(e.currentTarget).get("email")).trim();
    setBusy(true);
    setError("");
    const res = await postJson("/api/auth/forgot-password", { email });
    setBusy(false);
    if (!res.ok) return setError(res.message ?? "Request failed");
    navigate(`/reset-password?email=${encodeURIComponent(email)}`);
  }

  return (
    <form onSubmit={onSubmit}>
      <p>
        <label>
          Email <input type="email" name="email" autoComplete="email" required />
        </label>
      </p>
      <button type="submit" disabled={busy}>Send reset code</button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
