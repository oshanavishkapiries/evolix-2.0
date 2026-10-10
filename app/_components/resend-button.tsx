"use client";

import { useEffect, useState } from "react";
import { postJson } from "@/lib/client/api";

export function ResendButton({
  email,
  purpose,
}: {
  email: string;
  purpose: "verify_email" | "reset_password";
}) {
  const [seconds, setSeconds] = useState(0);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (seconds <= 0) return;
    const t = setTimeout(() => setSeconds((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [seconds]);

  async function resend() {
    setBusy(true);
    setMessage("");
    setError("");
    const res = await postJson("/api/auth/resend-otp", { email, purpose });
    setBusy(false);
    if (res.status === 429) {
      setSeconds(res.retryAfter ?? 60);
      setError(res.message ?? "Please wait before requesting another code");
    } else if (res.ok) {
      setMessage(res.message ?? "A new code has been sent.");
    } else {
      setError(res.message ?? "Could not resend the code");
    }
  }

  return (
    <div>
      <button type="button" onClick={resend} disabled={busy || seconds > 0 || !email}>
        {seconds > 0 ? `Resend code (${seconds}s)` : "Resend code"}
      </button>
      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
