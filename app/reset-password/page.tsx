import { Suspense } from "react";
import { ResetPasswordForm } from "./reset-password-form";

export default function ResetPasswordPage() {
  return (
    <main className="auth card">
      <h1>Reset password</h1>
      <Suspense fallback={<p>Loading...</p>}>
        <ResetPasswordForm />
      </Suspense>
      <p className="text-sm">
        <a href="/login">Back to log in</a>
      </p>
    </main>
  );
}
