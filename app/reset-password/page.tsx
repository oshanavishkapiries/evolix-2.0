import { Suspense } from "react";
import { ResetPasswordForm } from "./reset-password-form";

export default function ResetPasswordPage() {
  return (
    <main>
      <h1>Reset password</h1>
      <Suspense fallback={<p>Loading...</p>}>
        <ResetPasswordForm />
      </Suspense>
      <p>
        <a href="/login">Back to log in</a>
      </p>
    </main>
  );
}
