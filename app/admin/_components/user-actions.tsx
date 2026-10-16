"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { adminApi, errorText } from "@/lib/client/admin";
import { useToast } from "./toast";

/** Approve / revoke buttons for one user row. */
export function UserActions({ id, approved }: { id: string; approved: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const set = async (next: boolean) => {
    setBusy(true);
    const res = await adminApi("PATCH", `/api/admin/users/${id}`, { approved: next });
    setBusy(false);
    if (!res.ok) return toast.error(errorText(res));
    toast.success(next ? "User approved" : "Approval revoked");
    router.refresh();
  };
  return (
    <button type="button" className={approved ? "btn-secondary rounded-md border px-3 py-1.5 text-sm" : "rounded-md border px-3 py-1.5 text-sm"} disabled={busy} onClick={() => set(!approved)}>
      {approved ? "Revoke" : "Approve"}
    </button>
  );
}
