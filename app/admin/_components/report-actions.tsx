"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { adminApi, errorText } from "@/lib/client/admin";
import type { ReportStatus } from "@/lib/reports";
import { useToast } from "./toast";

const ACTIONS: Record<ReportStatus, { to: ReportStatus; label: string }[]> = {
  open: [
    { to: "resolved", label: "Resolve" },
    { to: "dismissed", label: "Dismiss" },
  ],
  resolved: [{ to: "open", label: "Reopen" }],
  dismissed: [{ to: "open", label: "Reopen" }],
};

/** Resolve / dismiss / reopen buttons for one report row. */
export function ReportActions({ id, status }: { id: string; status: ReportStatus }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const move = async (to: ReportStatus) => {
    setBusy(true);
    const res = await adminApi("PATCH", `/api/admin/reports/${id}`, { status: to });
    setBusy(false);
    if (!res.ok) return toast.error(errorText(res));
    toast.success(to === "open" ? "Report reopened" : `Report ${to}`);
    router.refresh();
  };

  return (
    <div className="toolbar">
      {ACTIONS[status].map((a) => (
        <button key={a.to} type="button" className="btn-secondary rounded-md border px-3 py-1.5 text-sm" disabled={busy} onClick={() => move(a.to)}>
          {a.label}
        </button>
      ))}
    </div>
  );
}
