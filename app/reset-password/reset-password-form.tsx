"use client";

import { FormEvent, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ResendButton } from "@/app/_components/resend-button";
import { postJson, navigate } from "@/lib/client/api";

export function ResetPasswordForm() {
  const initial = useSearchParams().get("email") ?? "";
  const [email, setEmail] = useState(initial);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    const res = await postJson("/api/auth/reset-password", {
      email: email.trim(),
      otp: String(form.get("otp")).trim(),
      newPassword: form.get("newPassword"),
    });
    setBusy(false);
    if (!res.ok) return setError(res.message ?? "Reset failed");
    navigate("/login?status=reset");
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
        <p>
          <label>
            New password{" "}
            <input type="password" name="newPassword" autoComplete="new-password" required minLength={8} maxLength={128} />
          </label>
        </p>
        <button type="submit" disabled={busy}>Reset password</button>
        {error && <p role="alert">{error}</p>}
      </form>
      <ResendButton email={email.trim()} purpose="reset_password" />
    </>
  );
}
