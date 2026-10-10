import { AuthShell } from "@/app/_components/auth-shell";
import { RegisterForm } from "./register-form";

export default function RegisterPage() {
  return (
    <AuthShell
      title="Create your account"
      subtitle="Sign up to start watching"
      links={[{ href: "/login", label: "Already have an account? Log in" }]}
    >
      <RegisterForm />
    </AuthShell>
  );
}
