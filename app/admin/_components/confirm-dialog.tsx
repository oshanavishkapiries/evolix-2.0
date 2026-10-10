"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

export type ConfirmOptions = {
  title: string;
  /** What will happen, including what cascades. */
  body?: React.ReactNode;
  confirmLabel?: string;
  /** Destructive styling (default true). */
  danger?: boolean;
};
type Request = ConfirmOptions & { resolve: (ok: boolean) => void };

const Ctx = createContext<(o: ConfirmOptions) => Promise<boolean>>(async () => false);
/** `const confirm = useConfirm(); if (await confirm({...})) ...` */
export const useConfirm = () => useContext(Ctx);

/** One shared modal built on the native <dialog>: showModal() traps focus, Esc cancels. */
export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [req, setReq] = useState<Request | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const current = useRef<Request | null>(null);

  const confirm = useCallback(
    (o: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        const r = { ...o, resolve };
        current.current = r;
        setReq(r);
      }),
    [],
  );

  useEffect(() => {
    if (req && dialog.current && !dialog.current.open) dialog.current.showModal();
  }, [req]);

  function finish(ok: boolean) {
    const r = current.current;
    if (!r) return;
    current.current = null;
    r.resolve(ok);
    dialog.current?.close();
    setReq(null);
  }

  const danger = req?.danger !== false;
  return (
    <Ctx.Provider value={confirm}>
      {children}
      <dialog
        ref={dialog}
        className="confirm-dialog"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-body"
        onClose={() => finish(false)}
        onClick={(e) => {
          if (e.target === dialog.current) finish(false);
        }}
      >
        {req && (
          <div className="space-y-3">
            <h2 id="confirm-title" className="text-lg">
              {req.title}
            </h2>
            <div id="confirm-body" className="text-sm text-gray-700 dark:text-gray-300">
              {req.body}
            </div>
            <div className="toolbar justify-end pt-2">
              <button type="button" className="btn-secondary" autoFocus onClick={() => finish(false)}>
                Cancel
              </button>
              <button type="button" className={danger ? "btn-danger" : undefined} onClick={() => finish(true)}>
                {req.confirmLabel ?? (danger ? "Delete" : "Confirm")}
              </button>
            </div>
          </div>
        )}
      </dialog>
    </Ctx.Provider>
  );
}
