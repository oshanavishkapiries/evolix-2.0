import { Suspense } from "react";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main>
      <h1>Log in</h1>
      <Suspense fallback={<p>Loading...</p>}>
        <LoginForm />
      </Suspense>
      <nav>
        <a href="/register">Register</a> | <a href="/forgot-password">Forgot password?</a>
      </nav>
    </main>
  );
}
