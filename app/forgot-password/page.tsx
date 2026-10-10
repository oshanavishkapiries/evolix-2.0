import { AuthShell } from "@/app/_components/auth-shell";
import { ForgotPasswordForm } from "./forgot-password-form";

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      title="Forgot password"
      subtitle="Enter your email and we will send you a reset code"
      links={[{ href: "/login", label: "Back to log in" }]}
    >
      <ForgotPasswordForm />
    </AuthShell>
  );
}
