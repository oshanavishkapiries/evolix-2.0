import { PageHeader } from "../_components/page-header";
import { SupportInbox } from "@/app/_components/support/inbox";
import { uuid } from "@/lib/support/http";

export default async function SupportPage({ searchParams }: { searchParams: Promise<{ user?: string | string[] }> }) {
  const { user } = await searchParams;
  const id = typeof user === "string" && uuid(user) ? user : undefined;
  return <><PageHeader title="Support" /><p className="support-intro">Private conversations with your users.</p><SupportInbox initialUserId={id} /></>;
}
