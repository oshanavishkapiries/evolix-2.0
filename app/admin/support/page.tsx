import { SupportInbox } from "@/app/_components/support/inbox";
import { uuid } from "@/lib/support/http";

export default async function SupportPage({ searchParams }: { searchParams: Promise<{ user?: string | string[] }> }) {
  const { user } = await searchParams;
  const id = typeof user === "string" && uuid(user) ? user : undefined;
  return <section className="support-admin-page"><header className="support-admin-heading"><h1>Support</h1><p>Private conversations with your users</p></header><SupportInbox initialUserId={id} /></section>;
}
