"use client";

import { useState } from "react";
import { adminApi, errorText } from "@/lib/client/admin";
import { Switch } from "./switch";
import { useToast } from "./toast";

/** Platform switches. */
export function PlatformSettings({ requireApproval }: { requireApproval: boolean }) {
  const toast = useToast();
  const [on, setOn] = useState(requireApproval);

  const toggle = async (next: boolean) => {
    const res = await adminApi("PUT", "/api/admin/settings", { requireApproval: next });
    if (!res.ok) {
      toast.error(errorText(res));
      return false;
    }
    setOn(next);
    toast.success(next ? "Only approved users can watch" : "Everyone can watch");
    return true;
  };

  return (
    <section className="mt-4">
      <h2>Watching</h2>
      <p className="mt-2 text-sm">
        <strong>Require admin approval to watch</strong>: when on, new accounts (after the normal email verification) can sign in and browse, but cannot
        watch movies or TV shows until you approve them in <em>Users</em>. When off, every signed-in user can watch. Accounts that existed before this
        feature are already approved.
      </p>
      <div className="mt-3">
        <Switch checked={on} onToggle={toggle} label="Require admin approval to watch" onLabel="Approval required" offLabel="Everyone can watch" />
      </div>
    </section>
  );
}
