import { AuthShell } from "@/app/_components/auth-shell";
import { Suspense } from "react";
import { ResetPasswordForm } from "./reset-password-form";

export default function ResetPasswordPage() {
  return (
    <AuthShell
      title="Reset password"
      subtitle="Enter the code we emailed you and choose a new password"
      links={[{ href: "/login", label: "Back to log in" }]}
    >
      <Suspense fallback={null}>
        <ResetPasswordForm />
      </Suspense>
    </AuthShell>
  );
}
