import { Suspense } from "react";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main className="auth card">
      <h1>Log in</h1>
      <Suspense fallback={<p>Loading...</p>}>
        <LoginForm />
      </Suspense>
      <nav className="flex justify-between text-sm">
        <a href="/register">Register</a>
        <a href="/forgot-password">Forgot password?</a>
      </nav>
    </main>
  );
}
