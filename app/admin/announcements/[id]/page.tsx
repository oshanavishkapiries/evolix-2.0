import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { audienceLabel } from "@/lib/announcements";
import { isUuid } from "@/lib/cms/api";
import { getAnnouncement } from "@/lib/cms/announcements";
import { AnnouncementForm } from "../../_components/announcement-form";
import { AnnouncementReaders } from "../../_components/announcement-readers";
import { PageHeader } from "../../_components/page-header";

export default function AnnouncementPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<div className="skeleton mt-4 h-32" aria-busy="true" />}>
      <Detail params={params} />
    </Suspense>
  );
}

async function Detail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const a = isUuid(id) ? await getAnnouncement(id) : null;
  if (!a) notFound();
  const unread = Math.max(0, a.recipientCount - a.readCount);
  const rate = a.recipientCount ? Math.round((a.readCount / a.recipientCount) * 100) : 0;
  const sent = a.state !== "draft";
  return (
    <>
      <PageHeader title={a.title} actions={<Link href="/admin/announcements">All announcements</Link>} />
      <p className="mt-1 text-sm">
        {a.state[0].toUpperCase() + a.state.slice(1)} · {audienceLabel(a.audience)}
        {a.priority === "banner" ? " · Banner" : a.priority === "popup" ? " · Popup" : ""}
      </p>
      {sent && (
        <dl className="mt-4 flex flex-wrap gap-6" aria-label="Read statistics">
          <div><dt className="text-xs">Recipients</dt><dd className="text-lg font-semibold">{a.recipientCount}</dd></div>
          <div><dt className="text-xs">Read</dt><dd className="text-lg font-semibold">{a.readCount}</dd></div>
          <div><dt className="text-xs">Not read</dt><dd className="text-lg font-semibold">{unread}</dd></div>
          <div><dt className="text-xs">Read rate</dt><dd className="text-lg font-semibold">{rate}%</dd></div>
        </dl>
      )}
      <div className="mt-4">
        <AnnouncementForm
          key={a.updatedAt.toISOString()}
          initial={{
            id: a.id,
            title: a.title,
            body: a.body,
            linkUrl: a.linkUrl ?? "",
            imageUrl: a.imageUrl ?? "",
            bannerImageUrl: a.bannerImageUrl ?? "",
            audience: a.audience,
            priority: a.priority,
            publishAt: a.publishAt?.toISOString() ?? null,
            expiresAt: a.expiresAt?.toISOString() ?? null,
            recipients: a.recipientEmails.join("\n"),
            state: a.state,
          }}
        />
      </div>
      {sent && <AnnouncementReaders id={a.id} />}
    </>
  );
}
