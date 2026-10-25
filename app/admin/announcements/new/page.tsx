import Link from "next/link";
import { AnnouncementForm, EMPTY_ANNOUNCEMENT } from "../../_components/announcement-form";
import { PageHeader } from "../../_components/page-header";

export const metadata = { title: "New announcement" };

export default function NewAnnouncementPage() {
  return (
    <>
      <PageHeader title="New announcement" actions={<Link href="/admin/announcements">All announcements</Link>} />
      <AnnouncementForm initial={EMPTY_ANNOUNCEMENT} />
    </>
  );
}
