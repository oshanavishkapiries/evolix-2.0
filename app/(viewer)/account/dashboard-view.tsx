"use client";

import { useEffect, useState } from "react";
import { fetchWithRefresh, postJson, postJsonWithRefresh, navigate } from "@/lib/client/api";
import { setOptOut } from "../_components/feedback-moments";

type User = { id: string; email: string; emailVerifiedAt: string | null };

export function DashboardView() {
  const [user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchWithRefresh("/api/auth/me");
        if (cancelled || res.status === 401) return; // 401 already redirected to /login
        const body = await res.json();
        if (res.ok) {
          setUser(body.user);
          setIsAdmin(body.isAdmin === true);
        }
        else setError(body.message ?? "Could not load profile");
      } catch {
        if (!cancelled) setError("Could not load profile");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function logout() {
    await postJson("/api/auth/logout");
    navigate("/login");
  }

  async function logoutAll() {
    const res = await postJsonWithRefresh("/api/auth/logout-all");
    if (res.status === 401) return; // already redirected
    if (!res.ok) return setError(res.message ?? "Could not log out of all devices");
    navigate("/login");
  }

  return (
    <div className="v-account">
      {error && <p role="alert" className="v-alert">{error}</p>}
      {user ? (
        <dl className="v-panel v-dl">
          <dt>Email</dt>
          <dd>{user.email}</dd>
          <dt>Account ID</dt>
          <dd><code>{user.id}</code></dd>
          <dt>Email verified</dt>
          <dd>{user.emailVerifiedAt ? new Date(user.emailVerifiedAt).toLocaleDateString() : "Not verified"}</dd>
        </dl>
      ) : (
        !error && <div className="v-panel v-skel" style={{ height: "9rem" }} aria-busy="true" aria-label="Loading profile" />
      )}
      {user && <QuestionsPref />}
      <div className="v-actions">
        {isAdmin && <a href="/admin" className="v-btn">Admin</a>}
        <button type="button" className="v-btn" onClick={logout}>Log out</button>
        <button type="button" className="v-btn v-btn-danger" onClick={logoutAll}>Log out of all devices</button>
      </div>
    </div>
  );
}

/** "Don't ask me" from the player's quick questions, and the way back. */
function QuestionsPref() {
  const [optedOut, setOptedOut] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchWithRefresh("/api/me/feedback-prefs")
      .then((r) => (r.ok ? r.json() : null))
      .then((b: { optedOut?: boolean } | null) => !cancelled && setOptedOut(b?.optedOut ?? false))
      .catch(() => !cancelled && setOptedOut(false));
    return () => {
      cancelled = true;
    };
  }, []);
  if (optedOut === null) return null;
  return (
    <label className="v-panel v-pref">
      <input
        type="checkbox"
        checked={!optedOut}
        onChange={async (e) => {
          const next = !e.target.checked;
          setOptedOut(next);
          await setOptOut(next);
        }}
      />
      <span>
        <strong>Quick questions while watching</strong>
        <small>Now and then the player asks a one-tap question, like “Is this subtitle in sync?”, to help us improve. At most twice a week.</small>
      </span>
    </label>
  );
}
