"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

type Item = { id: number; text: string };
type Toasts = { success: (text: string) => void; error: (text: string) => void };

const noop = () => {};
const Ctx = createContext<Toasts>({ success: noop, error: noop });
export const useToast = () => useContext(Ctx);

const SUCCESS_MS = 4000;

/**
 * Feedback regions: successes in a polite role="status" region that auto-dismisses after ~4s,
 * errors in a role="alert" region that stays until dismissed (or until the next success).
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [ok, setOk] = useState<Item[]>([]);
  const [err, setErr] = useState<Item[]>([]);
  const nextId = useRef(0);

  const success = useCallback((text: string) => {
    const id = ++nextId.current;
    setOk((l) => [...l, { id, text }]);
    setErr([]);
    setTimeout(() => setOk((l) => l.filter((t) => t.id !== id)), SUCCESS_MS);
  }, []);
  const error = useCallback((text: string) => {
    const id = ++nextId.current;
    setErr((l) => [...l.slice(-2), { id, text }]);
  }, []);
  const value = useMemo(() => ({ success, error }), [success, error]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="toast-region">
        <div role="status" className="space-y-2">
          {ok.map((t) => (
            <div key={t.id} className="toast toast-ok">
              {t.text}
            </div>
          ))}
        </div>
        <div role="alert" className="space-y-2">
          {err.map((t) => (
            <div key={t.id} className="toast toast-err">
              <span className="min-w-0 break-words">{t.text}</span>
              <button type="button" className="btn-secondary shrink-0" onClick={() => setErr((l) => l.filter((x) => x.id !== t.id))}>
                Dismiss
              </button>
            </div>
          ))}
        </div>
      </div>
    </Ctx.Provider>
  );
}
