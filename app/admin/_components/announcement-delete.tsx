"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { adminApi, errorText } from "@/lib/client/admin";
import { useConfirm } from "./confirm-dialog";
import { useToast } from "./toast";

/** Delete button for one announcement row; sent ones get a stronger warning because read stats go too. */
export function AnnouncementDelete({ id, title, draft }: { id: string; title: string; draft: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const remove = async () => {
    const ok = await confirm(
      draft
        ? { title: `Delete draft "${title}"?`, body: "It was never sent, so nothing is lost for users.", confirmLabel: "Delete" }
        : { title: `Delete "${title}" permanently?`, body: "Users stop seeing it and its read statistics are deleted. This cannot be undone; archive it instead to keep the stats.", confirmLabel: "Delete permanently" },
    );
    if (!ok) return;
    setBusy(true);
    const res = await adminApi("DELETE", `/api/admin/announcements/${id}`);
    setBusy(false);
    if (!res.ok) return toast.error(errorText(res));
    toast.success("Announcement deleted");
    router.refresh();
  };
  return (
    <button type="button" className="btn-danger rounded-md px-3 py-1.5 text-sm" disabled={busy} onClick={remove} aria-label={`Delete ${title}`}>
      Delete
    </button>
  );
}
