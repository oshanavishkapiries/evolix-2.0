import { Suspense } from "react";
import { VerifyEmailForm } from "./verify-email-form";

export default function VerifyEmailPage() {
  return (
    <main className="auth card">
      <h1>Verify your email</h1>
      <Suspense fallback={<p>Loading...</p>}>
        <VerifyEmailForm />
      </Suspense>
      <p className="text-sm">
        <a href="/login">Back to log in</a>
      </p>
    </main>
  );
}
