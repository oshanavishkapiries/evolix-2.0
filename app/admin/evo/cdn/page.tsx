import { redirect } from "next/navigation";

/** The CDN manager moved to its own section. */
export default async function EvoCdnPage({ searchParams }: { searchParams: Promise<{ engine?: string }> }) {
  const { engine } = await searchParams;
  redirect(engine ? `/admin/cdn?engine=${encodeURIComponent(engine)}` : "/admin/cdn");
}
