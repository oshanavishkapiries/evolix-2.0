"use client";

import { useEffect, useState } from "react";
import { fetchWithRefresh, postJson, postJsonWithRefresh, navigate } from "@/lib/client/api";

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
    <>
      {error && <p role="alert">{error}</p>}
      {user ? (
        <dl>
          <dt>Email</dt>
          <dd>{user.email}</dd>
          <dt>ID</dt>
          <dd>{user.id}</dd>
          <dt>Verified</dt>
          <dd>{user.emailVerifiedAt ?? "Not verified"}</dd>
        </dl>
      ) : (
        !error && <p>Loading...</p>
      )}
      {isAdmin && (
        <p>
          <a href="/admin">Admin</a>
        </p>
      )}
      <button type="button" onClick={logout}>Log out</button>{" "}
      <button type="button" onClick={logoutAll}>Log out of all devices</button>
    </>
  );
}
