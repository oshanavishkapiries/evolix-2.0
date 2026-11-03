"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { adminApi, errorText } from "@/lib/client/admin";
import { useConfirm } from "../../../_components/confirm-dialog";
import { useToast } from "../../../_components/toast";

type Reveal = { token: string; envLine: string };
function TokenReveal({ value, dismiss }: { value: Reveal; dismiss: () => void }) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  return <aside className="engine-registry-reveal" aria-label="One-time engine token">
    <h3>Copy this token now</h3>
    <p>This is shown once. Paste this exact line into the engine’s .env, then restart that engine. Calls fail until its token matches.</p>
    <code>{value.envLine}</code>
    <div className="toolbar"><button type="button" className="btn-secondary" onClick={async () => {
      try { await navigator.clipboard.writeText(value.envLine); setCopied(true); setCopyError(false); } catch { setCopyError(true); }
    }}>{copied ? "Copied" : "Copy .env line"}</button><button type="button" className="btn-secondary" onClick={dismiss}>I saved it — hide token</button></div>
    {copyError && <p role="alert">Clipboard unavailable. Select and copy the line above.</p>}
  </aside>;
}
const endpoint = "/api/admin/evo/engines";
export function AddEngineForm() {
  const router = useRouter(), toast = useToast();
  const [name, setName] = useState(""), [url, setUrl] = useState(""), [token, setToken] = useState("");
  const [busy, setBusy] = useState(false), [reveal, setReveal] = useState<Reveal | null>(null), [test, setTest] = useState("");
  const generate = () => {
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    setToken(Array.from(bytes, (n) => n.toString(16).padStart(2, "0")).join("")); setTest("");
  };
  return <section className="evo-section engine-registry">
    <h2>Add engine</h2>
    <p className="evo-sub">Adding the first managed engine replaces the entire EVO_ENGINES list. Add each engine you want to keep.</p>
    <form onSubmit={async (event) => {
      event.preventDefault(); setBusy(true); setTest("");
      const res = await adminApi<Reveal>("POST", endpoint, { name, url, ...(token ? { token } : {}) });
      setBusy(false);
      if (!res.ok) return toast.error(errorText(res));
      setReveal({ token: res.token, envLine: res.envLine }); setToken(""); setName(""); setUrl(""); router.refresh();
    }}>
      <label>Name<input required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} /></label>
      <label>Engine URL<input required type="url" placeholder="http://10.0.0.2:8000" value={url} onChange={(e) => { setUrl(e.target.value); setTest(""); }} /></label>
      <label>Token<input type="password" autoComplete="new-password" value={token} placeholder="Leave empty to generate when adding" onChange={(e) => { setToken(e.target.value); setTest(""); }} /></label>
      <div className="toolbar">
        <button type="button" className="btn-secondary" disabled={busy} onClick={generate}>Generate token</button>
        <button type="button" className="btn-secondary" disabled={busy || !url || !token} onClick={async () => {
          setBusy(true); setTest("");
          const res = await adminApi<{ reachable: boolean; authOk: boolean; latency: number; version: string | null }>("POST", `${endpoint}/test-connection`, { url, token });
          setBusy(false);
          setTest(!res.ok ? errorText(res) : `${res.reachable ? "Reachable" : "Unreachable"} · ${res.authOk ? "authentication OK" : "authentication not confirmed"} · ${res.latency} ms · version ${res.version ?? "not reported"}`);
        }}>Test connection</button>
        <button type="submit" className="btn-primary" disabled={busy || !!reveal}>{busy ? "Working…" : "Add engine"}</button>
      </div>
      <p className="evo-sub">To test first, use the token already in the engine’s .env. A newly generated token will work after you install it there.</p>
      {test && <p role="status">{test}</p>}
    </form>
    {reveal && <TokenReveal value={reveal} dismiss={() => setReveal(null)} />}
  </section>;
}
export function EngineRegistryActions({ id, initialName, initialUrl }: { id: string; initialName: string; initialUrl: string }) {
  const router = useRouter(), toast = useToast(), confirm = useConfirm();
  const [name, setName] = useState(initialName), [url, setUrl] = useState(initialUrl);
  const [busy, setBusy] = useState(false), [reveal, setReveal] = useState<Reveal | null>(null);
  const path = `${endpoint}/${encodeURIComponent(id)}`;
  return <section className="evo-section engine-registry">
    <h2>Manage engine</h2>
    <form onSubmit={async (e) => {
      e.preventDefault(); setBusy(true);
      const res = await adminApi("PATCH", path, { name, url }); setBusy(false);
      if (!res.ok) return toast.error(errorText(res));
      toast.success("Engine updated"); router.refresh();
    }}>
      <label>Name<input required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} /></label>
      <label>URL<input required type="url" value={url} onChange={(e) => setUrl(e.target.value)} /></label>
      <button className="btn-secondary" disabled={busy}>Save name / URL</button>
    </form>
    <div className="toolbar">
      <button type="button" className="btn-secondary" disabled={busy || !!reveal} onClick={async () => {
        if (!(await confirm({ title: "Rotate engine token?", body: "Update EVO_SECRET_TOKEN in this engine’s .env and restart it after rotation. All app calls to this engine fail until the tokens match. The new token is shown only once.", confirmLabel: "Rotate token" }))) return;
        setBusy(true); const res = await adminApi<Reveal>("POST", `${path}/rotate-token`); setBusy(false);
        if (!res.ok) return toast.error(errorText(res));
        setReveal({ token: res.token, envLine: res.envLine }); router.refresh();
      }}>Rotate token</button>
      <button type="button" className="btn-danger" disabled={busy} onClick={async () => {
        if (!(await confirm({ title: "Remove engine?", body: "Drain the engine first and let its jobs finish. Its task history stays. Removing the last managed engine restores the env fallback list, except removed addresses.", confirmLabel: "Remove engine" }))) return;
        setBusy(true); let res = await adminApi("DELETE", path);
        if (res.status === 409 && await confirm({ title: "Force remove engine?", body: `${errorText(res)}. Viewers and in-flight tasks on this engine may fail. Force removal keeps task history but prevents further calls to this engine.`, confirmLabel: "Force remove" })) res = await adminApi("DELETE", `${path}?force=1`);
        setBusy(false);
        if (!res.ok) return toast.error(errorText(res));
        router.push("/admin/evo/engines"); router.refresh();
      }}>Remove engine</button>
    </div>
    {reveal && <TokenReveal value={reveal} dismiss={() => setReveal(null)} />}
  </section>;
}
