"use client";

import { FormEvent, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ResendButton } from "@/app/_components/resend-button";
import { postJson, navigate } from "@/lib/client/api";

export function VerifyEmailForm() {
  const initial = useSearchParams().get("email") ?? "";
  const [email, setEmail] = useState(initial);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const otp = String(new FormData(e.currentTarget).get("otp")).trim();
    setBusy(true);
    setError("");
    const res = await postJson("/api/auth/verify-email", { email: email.trim(), otp });
    setBusy(false);
    if (!res.ok) return setError(res.message ?? "Verification failed");
    navigate("/login?status=verified");
  }

  return (
    <>
      <form onSubmit={onSubmit}>
        <p>
          <label>
            Email{" "}
            <input type="email" name="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
        </p>
        <p>
          <label>
            Code{" "}
            <input type="text" name="otp" inputMode="numeric" autoComplete="one-time-code" required pattern="\d{6}" minLength={6} maxLength={6} />
          </label>
        </p>
        <button type="submit" disabled={busy}>Verify</button>
        {error && <p role="alert">{error}</p>}
      </form>
      <ResendButton email={email.trim()} purpose="verify_email" />
    </>
  );
}
