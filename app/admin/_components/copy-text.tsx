"use client";

import { useState } from "react";

/** A small button that copies `text`, with a moment of "Copied". */
export function CopyText({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn-link-plain"
      aria-label={label}
      title={text}
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        });
      }}
    >
      {done ? "Copied" : "Copy URL"}
    </button>
  );
}
