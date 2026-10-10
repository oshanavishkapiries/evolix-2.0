import { AuthShell } from "@/app/_components/auth-shell";
import { Suspense } from "react";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <AuthShell
      title="Log in"
      subtitle="Welcome back to Evolix"
      links={[
        { href: "/forgot-password", label: "Forgot password?" },
        { href: "/register", label: "New here? Create an account" },
      ]}
    >
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </AuthShell>
  );
}
