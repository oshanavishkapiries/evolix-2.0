import { Suspense } from "react";
import { VerifyEmailForm } from "./verify-email-form";

export default function VerifyEmailPage() {
  return (
    <main>
      <h1>Verify your email</h1>
      <Suspense fallback={<p>Loading...</p>}>
        <VerifyEmailForm />
      </Suspense>
      <p>
        <a href="/login">Back to log in</a>
      </p>
    </main>
  );
}
