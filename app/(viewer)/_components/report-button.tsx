"use client";

import { useRef, useState } from "react";
import { postJsonWithRefresh } from "@/lib/client/api";
import { MESSAGE_MAX, OTHER_MIN, REPORT_REASONS, type ReportKind, type ReportReason } from "@/lib/reports";
import { CloseIcon, FlagIcon } from "./icons";

export type ReportTarget = { kind: ReportKind; id: string; title: string };

/** Flag button plus a dialog: pick a predefined reason, add a message (required for "Something else"). */
export function ReportButton({ target, className = "v-round", iconSize = 20 }: { target: ReportTarget; className?: string; iconSize?: number }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState<ReportReason | "">("");
  const [message, setMessage] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState("");

  const open = () => {
    setReason("");
    setMessage("");
    setError("");
    setState("idle");
    dialog.current?.showModal();
  };
  const close = () => dialog.current?.close();
  const needsMessage = reason === "other";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason) return setError("Choose a reason.");
    if (needsMessage && message.trim().length < OTHER_MIN) return setError("Please describe the problem.");
    setError("");
    setState("sending");
    const r = await postJsonWithRefresh("/api/reports", { kind: target.kind, id: target.id, reason, message: message.trim() });
    if (r.ok) setState("sent");
    else {
      setState("idle");
      setError(r.message ?? "Could not send the report. Try again.");
    }
  };

  return (
    <>
      <button type="button" className={className} aria-label="Report a problem" title="Report a problem" onClick={open}>
        <FlagIcon size={iconSize} />
      </button>
      <dialog
        ref={dialog}
        className="v-report"
        aria-label="Report a problem"
        onClick={(e) => {
          if (e.target === dialog.current) close();
        }}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <div className="v-report-head">
          <div>
            <h2>Report a problem</h2>
            <p className="v-muted">{target.title}</p>
          </div>
          <button type="button" className="v-bar-icon" aria-label="Close" onClick={close}>
            <CloseIcon size={20} />
          </button>
        </div>
        {state === "sent" ? (
          <div className="v-report-done" role="status">
            <p><strong>Thanks for letting us know.</strong></p>
            <p className="v-muted">We will look into it.</p>
            <button type="button" className="v-btn v-btn-primary" onClick={close}>Close</button>
          </div>
        ) : (
          <form onSubmit={submit}>
            <fieldset>
              <legend className="v-sr">Reason</legend>
              {REPORT_REASONS.map((r) => (
                <label key={r.key} className="v-report-opt">
                  <input type="radio" name="reason" value={r.key} checked={reason === r.key} onChange={() => setReason(r.key)} />
                  <span>{r.label}</span>
                </label>
              ))}
            </fieldset>
            <label className="v-report-msg">
              <span>{needsMessage ? "Tell us what is wrong" : "More details (optional)"}</span>
              <textarea value={message} onChange={(e) => setMessage(e.target.value)} maxLength={MESSAGE_MAX} rows={3} required={needsMessage} />
            </label>
            {error && <p className="v-report-error" role="alert">{error}</p>}
            <div className="v-report-actions">
              <button type="button" className="v-btn" onClick={close}>Cancel</button>
              <button type="submit" className="v-btn v-btn-primary" disabled={state === "sending"}>
                {state === "sending" ? "Sending…" : "Send report"}
              </button>
            </div>
          </form>
        )}
      </dialog>
    </>
  );
}
