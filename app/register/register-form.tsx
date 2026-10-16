"use client";

import { FormEvent, useState } from "react";
import { postJson, navigate } from "@/lib/client/api";

export function RegisterForm() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email")).trim();
    setBusy(true);
    setError("");
    const res = await postJson("/api/auth/register", { email, password: form.get("password") });
    setBusy(false);
    if (!res.ok) return setError(res.message ?? "Registration failed");
    if ((res as { autoLogin?: boolean }).autoLogin) return navigate("/dashboard");
    navigate(`/verify-email?email=${encodeURIComponent(email)}`);
  }

  return (
    <form onSubmit={onSubmit}>
      <p>
        <label>
          Email <input type="email" name="email" autoComplete="email" required />
        </label>
      </p>
      <p>
        <label>
          Password{" "}
          <input type="password" name="password" autoComplete="new-password" required minLength={8} maxLength={128} />
        </label>
      </p>
      <button type="submit" disabled={busy}>Register</button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
