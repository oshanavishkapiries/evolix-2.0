import { AuthShell } from "@/app/_components/auth-shell";
import { Suspense } from "react";
import { VerifyEmailForm } from "./verify-email-form";

export default function VerifyEmailPage() {
  return (
    <AuthShell
      title="Verify your email"
      subtitle="Enter the 6-digit code we emailed you"
      links={[{ href: "/login", label: "Back to log in" }]}
    >
      <Suspense fallback={null}>
        <VerifyEmailForm />
      </Suspense>
    </AuthShell>
  );
}
