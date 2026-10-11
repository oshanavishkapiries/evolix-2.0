"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteJsonWithRefresh } from "@/lib/client/api";
import { CloseIcon } from "./icons";

/** Round button on a Continue Watching card that clears the saved progress for that title. */
export function RemoveProgress({ target, title }: { target: { kind: "movie" | "show"; id: string }; title: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [gone, setGone] = useState(false);
  if (gone) return null;
  return (
    <button
      type="button"
      className="v-card-bm"
      disabled={pending}
      aria-label={`Remove ${title} from Continue Watching`}
      title="Remove from Continue Watching"
      onClick={async () => {
        const r = await deleteJsonWithRefresh("/api/me/progress", target);
        if (!r.ok) return;
        setGone(true);
        start(() => router.refresh());
      }}
    >
      <CloseIcon size={16} />
    </button>
  );
}
