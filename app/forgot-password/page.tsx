import { ForgotPasswordForm } from "./forgot-password-form";

export default function ForgotPasswordPage() {
  return (
    <main className="auth card">
      <h1>Forgot password</h1>
      <ForgotPasswordForm />
      <p className="text-sm">
        <a href="/login">Back to log in</a>
      </p>
    </main>
  );
}
