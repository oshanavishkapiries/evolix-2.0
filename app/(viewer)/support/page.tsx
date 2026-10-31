import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentUserId } from "@/lib/viewer/user";
import { SupportChat } from "@/app/_components/support/chat";

export const metadata: Metadata = { title: "Support" };
export const instant = false;
export default async function SupportPage() {
  if (!(await currentUserId())) redirect("/login?next=/support");
  return <div className="support-page"><SupportChat /></div>;
}
