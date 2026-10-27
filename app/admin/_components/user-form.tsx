"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { adminApi, errorText } from "@/lib/client/admin";
import { useConfirm } from "./confirm-dialog";
import { useToast } from "./toast";

type U = { id: string; email: string; verified: boolean; approved: boolean; admin: boolean };

/** Create a user (no `user`) or edit one: email, password reset, verified, approved, sign out everywhere, delete. */
export function UserForm({ user }: { user?: U }) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [email, setEmail] = useState(user?.email ?? "");
  const [password, setPassword] = useState("");
  const [verified, setVerified] = useState(user?.verified ?? true);
  const [approved, setApproved] = useState(user?.approved ?? true);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => ReturnType<typeof adminApi>, ok: string, then?: () => void) => {
    setBusy(true);
    const res = await fn();
    setBusy(false);
    if (!res.ok) return toast.error(errorText(res));
    toast.success(ok);
    then?.();
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!user)
      return run(
        () => adminApi<{ user: { id: string } }>("POST", "/api/admin/users", { email, password, verified, approved }),
        "User created",
        () => router.push("/admin/users"),
      );
    const body: Record<string, unknown> = { verified, approved };
    if (email !== user.email) body.email = email;
    if (password) body.password = password;
    return run(() => adminApi("PATCH", `/api/admin/users/${user.id}`, body), "User saved", () => {
      setPassword("");
      router.refresh();
    });
  };

  const signOut = async () => {
    if (!user || !(await confirm({ title: "Sign out everywhere?", body: "Every device this user is signed in on is logged out.", confirmLabel: "Sign out" }))) return;
    run(() => adminApi("PATCH", `/api/admin/users/${user.id}`, { revokeSessions: true }), "Signed out everywhere", () => router.refresh());
  };

  const remove = async () => {
    if (!user) return;
    const ok = await confirm({ title: `Delete ${user.email}?`, body: "Their sessions, watch history and bookmarks are deleted too. This cannot be undone.", confirmLabel: "Delete user" });
    if (ok) run(() => adminApi("DELETE", `/api/admin/users/${user.id}`), "User deleted", () => router.push("/admin/users"));
  };

  return (
    <form onSubmit={submit}>
      <div className="fields">
        <p className="wide">
          <label>
            Email
            <input type="email" value={email} required disabled={user?.admin} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
          </label>
        </p>
        <p className="wide">
          <label>
            {user ? "New password" : "Password"} <small>{user ? "leave empty to keep the current one; changing it signs the user out" : "at least 8 characters"}</small>
            <input type="password" value={password} required={!user} minLength={8} maxLength={128} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
          </label>
        </p>
        <p>
          <label>
            <input type="checkbox" checked={verified} onChange={(e) => setVerified(e.target.checked)} /> Email verified
          </label>
        </p>
        <p>
          <label>
            <input type="checkbox" checked={approved || Boolean(user?.admin)} disabled={user?.admin} onChange={(e) => setApproved(e.target.checked)} /> Approved to watch
          </label>
        </p>
      </div>
      <div className="action-bar">
        <span className="text-sm" aria-live="polite">{busy ? "Working..." : ""}</span>
        <span className="toolbar">
          {user && (
            <button type="button" className="btn-secondary" disabled={busy} onClick={signOut}>Sign out everywhere</button>
          )}
          {user && !user.admin && (
            <button type="button" className="btn-secondary" disabled={busy} onClick={remove}>Delete user</button>
          )}
          <button type="submit" disabled={busy}>{user ? "Save changes" : "Create user"}</button>
        </span>
      </div>
    </form>
  );
}
