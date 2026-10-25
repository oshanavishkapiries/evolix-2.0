"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  ANNOUNCEMENT_AUDIENCES,
  ANNOUNCEMENT_PRIORITIES,
  BODY_MAX,
  RECIPIENTS_MAX,
  TITLE_MAX,
  type AnnouncementAudience,
  type AnnouncementPriority,
  type AnnouncementState,
} from "@/lib/announcements";
import { adminApi, errorText } from "@/lib/client/admin";
import { useConfirm } from "./confirm-dialog";
import { useToast } from "./toast";

export type AnnouncementFormData = {
  id?: string;
  title: string;
  body: string;
  linkUrl: string;
  imageUrl: string;
  bannerImageUrl: string;
  audience: AnnouncementAudience;
  priority: AnnouncementPriority;
  /** ISO strings; the inputs show them in the browser's time zone. */
  publishAt: string | null;
  expiresAt: string | null;
  recipients: string;
  state?: AnnouncementState;
};

export const EMPTY_ANNOUNCEMENT: AnnouncementFormData = {
  title: "",
  body: "",
  linkUrl: "",
  imageUrl: "",
  bannerImageUrl: "",
  audience: "everyone",
  priority: "inbox",
  publishAt: null,
  expiresAt: null,
  recipients: "",
};

const pad = (n: number) => String(n).padStart(2, "0");
const toLocal = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fromLocal = (v: string) => (v ? new Date(v).toISOString() : null);
const emails = (text: string) => [...new Set(text.split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean))];

/** Create or edit an announcement; the buttons shown follow its lifecycle state. */
export function AnnouncementForm({ initial }: { initial: AnnouncementFormData }) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [v, setV] = useState(initial);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof AnnouncementFormData>(k: K, val: AnnouncementFormData[K]) => setV((x) => ({ ...x, [k]: val }));

  const isNew = !initial.id;
  const state = initial.state;
  const isDraft = isNew || state === "draft";
  const archived = state === "archived";
  const body = () => ({
    title: v.title,
    body: v.body,
    linkUrl: v.linkUrl,
    imageUrl: v.imageUrl,
    bannerImageUrl: v.bannerImageUrl,
    audience: v.audience,
    priority: v.priority,
    publishAt: v.publishAt,
    expiresAt: v.expiresAt,
    recipients: v.audience === "users" ? emails(v.recipients) : [],
  });

  async function run<T>(label: string, call: () => Promise<{ ok: boolean } & T & { message?: string; issues?: { path: string; message: string }[]; status: number }>, after?: (res: T) => void) {
    setBusy(true);
    const res = await call();
    setBusy(false);
    if (!res.ok) return toast.error(errorText(res as never));
    toast.success(label);
    after?.(res);
    router.refresh();
  }

  const save = (publish: boolean) =>
    isNew
      ? run(publish ? "Announcement published" : "Draft saved", () => adminApi<{ announcement: { id: string } }>("POST", "/api/admin/announcements", { ...body(), publish }), (res) =>
          router.push(`/admin/announcements/${res.announcement.id}`),
        )
      : run("Saved", () => adminApi("PATCH", `/api/admin/announcements/${initial.id}`, body()));

  async function publishDraft() {
    // Save edits first so what is published is what is on screen.
    setBusy(true);
    const saved = await adminApi("PATCH", `/api/admin/announcements/${initial.id}`, body());
    setBusy(false);
    if (!saved.ok) return toast.error(errorText(saved));
    await run("Announcement published", () => adminApi("POST", `/api/admin/announcements/${initial.id}/publish`));
  }

  async function archive(to: boolean) {
    if (to && !(await confirm({ title: "Archive this announcement?", body: "Users no longer see it. Its read statistics are kept and you can restore it.", confirmLabel: "Archive", danger: false }))) return;
    await run(to ? "Archived" : "Restored", () => adminApi("POST", `/api/admin/announcements/${initial.id}/archive`, { archived: to }));
  }

  const duplicate = () =>
    run("Copied to a new draft", () => adminApi<{ announcement: { id: string } }>("POST", `/api/admin/announcements/${initial.id}/duplicate`), (res) =>
      router.push(`/admin/announcements/${res.announcement.id}`),
    );

  async function remove() {
    if (!(await confirm({ title: "Delete this draft?", body: "It was never sent, so nothing is lost for users." , confirmLabel: "Delete" }))) return;
    await run("Draft deleted", () => adminApi("DELETE", `/api/admin/announcements/${initial.id}`), () => router.push("/admin/announcements"));
  }

  const scheduled = isDraft && v.publishAt && new Date(v.publishAt) > new Date();

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save(false);
      }}
    >
      <div className="fields">
        <p className="wide">
          <label>
            Title <small>({v.title.length}/{TITLE_MAX})</small>
            <input value={v.title} maxLength={TITLE_MAX} required onChange={(e) => set("title", e.target.value)} />
          </label>
        </p>
        <p className="wide">
          <label>
            Message <small>({v.body.length}/{BODY_MAX})</small>
            <textarea rows={5} value={v.body} maxLength={BODY_MAX} onChange={(e) => set("body", e.target.value)} />
          </label>
        </p>
        <p className="wide">
          <label>
            Link (optional) <small>a page such as /movies, or an https:// address</small>
            <input value={v.linkUrl} placeholder="/movies" onChange={(e) => set("linkUrl", e.target.value)} />
          </label>
        </p>
        <p className="wide">
          <label>
            Inbox image (optional) <small>https:// picture shown in the notification list</small>
            <input type="url" value={v.imageUrl} placeholder="https://example.com/inbox.jpg" onChange={(e) => set("imageUrl", e.target.value)} />
          </label>
          {v.imageUrl.trim().startsWith("https://") && (
            // eslint-disable-next-line @next/next/no-img-element -- admin preview of an arbitrary address
            <img className="ann-preview" src={v.imageUrl.trim()} alt="" referrerPolicy="no-referrer" onError={(e) => (e.currentTarget.style.display = "none")} onLoad={(e) => (e.currentTarget.style.display = "")} />
          )}
        </p>
        {v.priority === "banner" && (
        <p className="wide">
          <label>
            Banner image (optional) <small>https:// picture shown in the banner; separate from the inbox image</small>
            <input type="url" value={v.bannerImageUrl} placeholder="https://example.com/banner-wide.jpg" onChange={(e) => set("bannerImageUrl", e.target.value)} />
          </label>
          {v.bannerImageUrl.trim().startsWith("https://") && (
            // eslint-disable-next-line @next/next/no-img-element -- admin preview of an arbitrary address
            <img className="ann-preview" src={v.bannerImageUrl.trim()} alt="" referrerPolicy="no-referrer" onError={(e) => (e.currentTarget.style.display = "none")} onLoad={(e) => (e.currentTarget.style.display = "")} />
          )}
        </p>
        )}
        <p>
          <label>
            Audience
            <select value={v.audience} onChange={(e) => set("audience", e.target.value as AnnouncementAudience)}>
              {ANNOUNCEMENT_AUDIENCES.map((a) => (
                <option key={a.key} value={a.key}>{a.label}</option>
              ))}
            </select>
          </label>
        </p>
        <p>
          <label>
            Priority
            <select value={v.priority} onChange={(e) => set("priority", e.target.value as AnnouncementPriority)}>
              {ANNOUNCEMENT_PRIORITIES.map((a) => (
                <option key={a.key} value={a.key}>{a.label}</option>
              ))}
            </select>
          </label>
        </p>
        {v.audience === "users" && (
          <p className="wide">
            <label>
              Recipients <small>email addresses separated by commas or new lines (max {RECIPIENTS_MAX}); each must have an account</small>
              <textarea rows={4} value={v.recipients} onChange={(e) => set("recipients", e.target.value)} />
            </label>
          </p>
        )}
        <p>
          <label>
            Publish at <small>blank = when you publish</small>
            <input type="datetime-local" value={toLocal(v.publishAt)} disabled={!isDraft} onChange={(e) => set("publishAt", fromLocal(e.target.value))} />
          </label>
        </p>
        <p>
          <label>
            Expires at <small>blank = never</small>
            <input type="datetime-local" value={toLocal(v.expiresAt)} onChange={(e) => set("expiresAt", fromLocal(e.target.value))} />
          </label>
        </p>
      </div>
      <p className="mt-2 text-xs">Times use your browser’s time zone.</p>

      <div className="action-bar">
        <span className="text-sm" aria-live="polite">{busy ? "Working..." : ""}</span>
        <span className="toolbar">
          {!isNew && !isDraft && (
            <>
              <button type="button" className="btn-secondary" disabled={busy} onClick={duplicate}>Duplicate</button>
              <button type="button" className="btn-secondary" disabled={busy} onClick={() => archive(!archived)}>{archived ? "Restore" : "Archive"}</button>
            </>
          )}
          {!isNew && isDraft && <button type="button" className="btn-secondary" disabled={busy} onClick={remove}>Delete draft</button>}
          {isDraft ? (
            <>
              <button type="button" className="btn-secondary" disabled={busy} onClick={() => save(false)}>Save draft</button>
              <button type="button" disabled={busy || !v.title.trim()} onClick={() => (isNew ? save(true) : publishDraft())}>{scheduled ? "Schedule" : "Publish"}</button>
            </>
          ) : (
            <button type="submit" disabled={busy || !v.title.trim()}>Save changes</button>
          )}
        </span>
      </div>
    </form>
  );
}
