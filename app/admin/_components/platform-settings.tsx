"use client";

import { useState } from "react";
import { adminApi, errorText } from "@/lib/client/admin";
import { Switch } from "./switch";
import { useToast } from "./toast";

/** Platform switches. Verification OFF = anyone can register and use the app at once. */
export function PlatformSettings({ requireEmailVerification }: { requireEmailVerification: boolean }) {
  const toast = useToast();
  const [required, setRequired] = useState(requireEmailVerification);

  const toggle = async (next: boolean) => {
    const res = await adminApi("PUT", "/api/admin/settings", { requireEmailVerification: next });
    if (!res.ok) {
      toast.error(errorText(res));
      return false;
    }
    setRequired(next);
    toast.success(next ? "Email verification is required again" : "Sign-ups are open: no email verification");
    return true;
  };

  return (
    <section className="mt-4">
      <h2>Sign-up</h2>
      <p className="mt-2 text-sm">
        <strong>Require email verification</strong>: when off, people can create an account and use the platform immediately, logged in automatically,
        without the emailed code. Accounts waiting for a code can log in too. Admin addresses (<code>ADMIN_EMAILS</code>) always need the code.
      </p>
      <div className="mt-3">
        <Switch checked={required} onToggle={toggle} label="Require email verification" onLabel="Verification required" offLabel="Open sign-up (no verification)" />
      </div>
    </section>
  );
}
