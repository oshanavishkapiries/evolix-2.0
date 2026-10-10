"use client";

import { FormEvent, useState } from "react";
import { useSearchParams } from "next/navigation";
import { safeNext } from "@/lib/auth/redirect";
import { postJson, navigate } from "@/lib/client/api";

const STATUS: Record<string, string> = {
  verified: "Email verified. You can now log in.",
  reset: "Password updated. Log in with your new password.",
};

export function LoginForm() {
  const params = useSearchParams();
  const status = STATUS[params.get("status") ?? ""];
  const [error, setError] = useState("");
  const [unverified, setUnverified] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email")).trim();
    setBusy(true);
    setError("");
    setUnverified("");
    const res = await postJson("/api/auth/login", { email, password: form.get("password") });
    setBusy(false);
    if (res.ok) return navigate(safeNext(params.get("next")));
    if (res.status === 403 && res.code === "EMAIL_NOT_VERIFIED") setUnverified(email);
    setError(res.message ?? "Login failed");
  }

  return (
    <form onSubmit={onSubmit}>
      {status && <p role="status">{status}</p>}
      <p>
        <label>
          Email <input type="email" name="email" autoComplete="email" required />
        </label>
      </p>
      <p>
        <label>
          Password <input type="password" name="password" autoComplete="current-password" required />
        </label>
      </p>
      <button type="submit" disabled={busy}>Log in</button>
      {error && <p role="alert">{error}</p>}
      {unverified && (
        <p>
          <a href={`/verify-email?email=${encodeURIComponent(unverified)}`}>Verify your email</a>
        </p>
      )}
    </form>
  );
}
